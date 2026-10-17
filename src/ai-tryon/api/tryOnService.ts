import axios from "axios";

// Use the Vite proxy by default (empty base -> same origin, /api proxied to
// backend) so cookies work and it functions from LAN devices too.
const API_URL = import.meta.env.VITE_API_URL || "";

/** Poll cadence while a job runs. The server throttles its own provider
 *  polling, so a status read here is a cheap database read. */
const POLL_INTERVAL_MS = 3000;
/** Give up waiting a little after the server's own job deadline (10 min by
 *  default); the server reports "expired" itself, this is only a backstop. */
const MAX_WAIT_MS = 12 * 60 * 1000;

/** Error carrying a message that is safe and useful to show in the UI. */
export class TryOnRequestError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "TryOnRequestError";
    this.status = status;
    this.code = code;
  }
}

export type TryOnJobStatus = "queued" | "processing" | "succeeded" | "failed" | "canceled" | "expired";

/** A try-on job as the server reports it — always bound to one product. */
export interface TryOnJob {
  jobId: string;
  productId: number;
  status: TryOnJobStatus;
  resultAvailable: boolean;
  expiresAt: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

/** Whether a product can be tried on (server-decided). */
export interface TryOnEligibility {
  productId: number;
  enabled: boolean;
  eligible: boolean;
  reason: string | null;
}

export const isFinished = (status: TryOnJobStatus) =>
  status === "succeeded" || status === "failed" || status === "canceled" || status === "expired";

/**
 * Map an axios failure to a user-facing error. Only the HTTP status and the
 * server's own `message`/`code` fields are consulted — never the request
 * config, which contains the base64 photo (logging or re-throwing it would put
 * a personal photograph into console output and error trackers).
 */
const toRequestError = (error: unknown): TryOnRequestError => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as { message?: string; code?: string } | undefined;
    const serverMessage = typeof data?.message === "string" ? data.message : undefined;
    const code = typeof data?.code === "string" ? data.code : undefined;
    if (status === 401) {
      return new TryOnRequestError("Please sign in to use the AI try-on.", status);
    }
    if (status === 413) {
      return new TryOnRequestError("Your photo upload was too large. Please try a smaller image.", status);
    }
    // The try-on API answers every known failure with a safe, specific
    // message (including 5xx: provider unavailable, timed out, ...).
    if (serverMessage && serverMessage !== "An error occurred") {
      return new TryOnRequestError(serverMessage, status, code);
    }
    if (status === 404) {
      return new TryOnRequestError("That Kente cloth is not available for AI try-on right now.", status);
    }
    if (status === 429) {
      return new TryOnRequestError("Too many requests. Please wait a few minutes and try again.", status);
    }
    if (status === 503) {
      return new TryOnRequestError("The AI stylist is offline right now. Please try again later.", status);
    }
    if (status && status >= 500) {
      return new TryOnRequestError("The AI stylist had a problem. Please try again.", status);
    }
    if (!error.response) {
      return new TryOnRequestError("Could not reach the server. Please check your connection and try again.");
    }
  }
  if (error instanceof TryOnRequestError) return error;
  return new TryOnRequestError("Something went wrong. Please try again.");
};

/**
 * Refuse a job the server attributes to a different product than the one on
 * screen. The server binds every job to the product it resolved, so this
 * should never fire — if it did, showing the image would present one
 * product's try-on as another's.
 */
const assertSameProduct = (expected: number, job: TryOnJob) => {
  if (Number(job.productId) !== expected) {
    throw new TryOnRequestError(
      "The try-on result did not match this product, so it was not shown. Please try again.",
    );
  }
};

/** A fresh key per submission attempt: a double click or network retry of the
 *  same attempt reuses it, so the server returns the same job. */
export const newIdempotencyKey = (): string => {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c?.getRandomValues?.(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") || `k${Date.now()}${Math.random()}`;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

const tryOnService = {
  /** Ask the server whether this product supports AI try-on. */
  async getProductEligibility(productId: number): Promise<TryOnEligibility> {
    try {
      const response = await axios.get(`${API_URL}/api/tryon/product/${productId}`, {
        timeout: 15000,
        withCredentials: true,
      });
      return response.data as TryOnEligibility;
    } catch (error) {
      throw toRequestError(error);
    }
  },

  /**
   * Start a try-on. Only the customer's photo (inline JPEG, already
   * downscaled and EXIF-stripped by utils/prepareTryOnImage) and the product
   * id leave the browser; the garment is resolved server-side.
   */
  async createJob(modelImage: string, productId: number, idempotencyKey: string): Promise<TryOnJob> {
    try {
      const response = await axios.post(
        `${API_URL}/api/tryon/jobs`,
        { modelImage, productId, consent: true, idempotencyKey },
        { timeout: 90000, withCredentials: true },
      );
      const job = (response.data as { job?: TryOnJob })?.job;
      if (!job?.jobId) {
        throw new TryOnRequestError("The AI stylist returned an unexpected response. Please try again.");
      }
      assertSameProduct(productId, job);
      return job;
    } catch (error) {
      if (error instanceof TryOnRequestError) throw error;
      // Only status reaches the console — never the request payload.
      if (axios.isAxiosError(error)) console.error("AI Try-On request failed:", error.response?.status || error.code);
      throw toRequestError(error);
    }
  },

  /** Owner-only job status (ownership is enforced server-side). */
  async getJob(jobId: string): Promise<TryOnJob> {
    try {
      const response = await axios.get(`${API_URL}/api/tryon/jobs/${encodeURIComponent(jobId)}`, {
        timeout: 30000,
        withCredentials: true,
      });
      return (response.data as { job: TryOnJob }).job;
    } catch (error) {
      throw toRequestError(error);
    }
  },

  /**
   * Poll until the job finishes, reporting every observed state. Progress is
   * the server's real job status — nothing here invents a percentage.
   */
  async waitForJob(
    job: TryOnJob,
    productId: number,
    onUpdate: (job: TryOnJob) => void,
    { signal, intervalMs = POLL_INTERVAL_MS, maxWaitMs = MAX_WAIT_MS }: { signal?: AbortSignal; intervalMs?: number; maxWaitMs?: number } = {},
  ): Promise<TryOnJob> {
    const started = Date.now();
    let current = job;
    while (!isFinished(current.status)) {
      if (Date.now() - started > maxWaitMs) {
        throw new TryOnRequestError("Your try-on is taking too long. Please try again in a few minutes.");
      }
      await sleep(intervalMs, signal);
      current = await this.getJob(current.jobId);
      assertSameProduct(productId, current);
      onUpdate(current);
    }
    return current;
  },

  /**
   * Fetch the private result image (authenticated) as a blob: URL for this
   * page only. The caller must URL.revokeObjectURL it when done.
   */
  async getResultObjectUrl(jobId: string): Promise<string> {
    try {
      const response = await axios.get(`${API_URL}/api/tryon/jobs/${encodeURIComponent(jobId)}/result`, {
        timeout: 30000,
        withCredentials: true,
        responseType: "blob",
      });
      return URL.createObjectURL(response.data as Blob);
    } catch (error) {
      // An error body arrives as a Blob here; read its JSON message.
      if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
        try {
          error.response.data = JSON.parse(await (error.response.data as Blob).text());
        } catch {
          /* keep the status-only mapping */
        }
      }
      throw toRequestError(error);
    }
  },
};

export default tryOnService;
