import axios from "axios";

// Use the Vite proxy by default (empty base -> same origin, /api proxied to
// backend) so cookies work and it functions from LAN devices too.
const API_URL = import.meta.env.VITE_API_URL || "";

/** How long to wait for the async prediction overall: 5s interval x 36 =
 *  3 minutes, comfortably above IDM-VTON's typical 60-90s latency. */
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 36;

/** Error carrying a message that is safe and useful to show in the UI. */
export class TryOnRequestError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TryOnRequestError";
    this.status = status;
  }
}

/**
 * Map an axios failure to a user-facing error. Only the HTTP status and the
 * server's own `message` field are consulted — never the request config,
 * which contains the base64 photo (logging or re-throwing it would put a
 * personal photograph into console output and error trackers).
 */
const toRequestError = (error: unknown): TryOnRequestError => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const serverMessage = (error.response?.data as { message?: string } | undefined)?.message;
    if (status === 401) {
      return new TryOnRequestError("Please sign in to use the AI try-on.", status);
    }
    if (status === 404) {
      return new TryOnRequestError(
        serverMessage || "That Kente cloth is not available for AI try-on right now.",
        status,
      );
    }
    if (status === 413) {
      return new TryOnRequestError(
        "Your photo upload was too large. Please try a smaller image.",
        status,
      );
    }
    if (status === 429) {
      return new TryOnRequestError(
        serverMessage || "Too many requests. Please wait a few minutes and try again.",
        status,
      );
    }
    if (status === 503) {
      return new TryOnRequestError(
        "The AI stylist is offline right now. Please try again later.",
        status,
      );
    }
    if (status && status >= 500) {
      return new TryOnRequestError(
        "The AI stylist had a problem. Please try again.",
        status,
      );
    }
    if (serverMessage) {
      return new TryOnRequestError(serverMessage, status);
    }
    if (!error.response) {
      return new TryOnRequestError(
        "Could not reach the server. Please check your connection and try again.",
        status,
      );
    }
  }
  return new TryOnRequestError(
    error instanceof Error && !axios.isAxiosError(error)
      ? error.message
      : "Something went wrong. Please try again.",
  );
};

interface TryOnStatusResponse {
  status?: string;
  output?: string | string[];
  message?: string;
  [key: string]: unknown;
}

const firstOutputUrl = (output: unknown): string | null => {
  if (typeof output === "string" && output) return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  return null;
};

const tryOnService = {
  /**
   * Generate an AI virtual try-on (Replicate IDM-VTON) via the backend proxy.
   *
   * The client sends ONLY the user's photo (inline data: JPEG) and the
   * productId — the garment image, its name and the garment category are all
   * resolved server-side from the catalog, so nothing about the product is
   * trusted from here. The photo is prepared (downscaled, EXIF-stripped)
   * before this call by utils/prepareTryOnImage.
   *
   * @param modelImage - base64 JPEG data: URI of the person's photo
   * @param productId - catalog product id of the selected Kente cloth
   * @returns the generated try-on image URL (polls the job to completion)
   */
  async generateTryOn(modelImage: string, productId: number): Promise<string> {
    try {
      const response = await axios.post(
        `${API_URL}/api/tryon/generate`,
        { modelImage, productId },
        { timeout: 30000, withCredentials: true },
      );
      const predictionId = (response.data as { predictionId?: string })?.predictionId;
      if (!predictionId) {
        throw new TryOnRequestError("The AI stylist returned an unexpected response. Please try again.");
      }
      return await this.pollForResult(predictionId);
    } catch (error) {
      if (error instanceof TryOnRequestError) throw error;
      // Only status/message reach the console — never the request payload,
      // which contains the user's photo as base64.
      if (axios.isAxiosError(error)) {
        console.error("AI Try-On request failed:", error.response?.status || error.message);
      }
      throw toRequestError(error);
    }
  },

  /**
   * Check try-on generation status (ownership is enforced server-side).
   */
  async getTryOnStatus(predictionId: string): Promise<TryOnStatusResponse> {
    try {
      const response = await axios.get(`${API_URL}/api/tryon/status/${predictionId}`, {
        timeout: 30000,
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Try-On status check failed:", error.response?.status || error.message);
      }
      throw toRequestError(error);
    }
  },

  /**
   * Poll until the try-on is ready.
   * @returns the output image URL
   */
  async pollForResult(
    predictionId: string,
    intervalMs: number = POLL_INTERVAL_MS,
    maxAttempts: number = POLL_MAX_ATTEMPTS,
  ): Promise<string> {
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      const status = await this.getTryOnStatus(predictionId);
      if (status.status === "succeeded") {
        const url = firstOutputUrl(status.output);
        if (!url) {
          throw new TryOnRequestError("The try-on finished but returned no image. Please try again.");
        }
        return url;
      }
      if (status.status === "failed" || status.status === "canceled") {
        throw new TryOnRequestError("AI try-on generation failed. Please try again.");
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new TryOnRequestError(
      "Try-on generation is taking too long. Please try again in a few minutes.",
    );
  },
};

export default tryOnService;
