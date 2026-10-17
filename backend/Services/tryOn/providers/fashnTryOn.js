// FILE LOCATION: backend/Services/tryOn/providers/fashnTryOn.js
// DESCRIPTION: Provider adapter: FASHN Try-On Max (api.fashn.ai).
//
// Everything FASHN-specific lives here: URLs, auth header, payload shape,
// status vocabulary, output parsing, error mapping. The rest of the app only
// sees the adapter contract (see ./index.js and AI_TRYON_ARCHITECTURE.md).
//
// Sources (FASHN docs, read 2026-10-17: docs.fashn.ai/llms-full.txt,
// /api-reference/tryon-max, /utility-endpoints/credits):
//   - POST /v1/run {model_name, inputs}; "Place all endpoint parameters inside
//     `inputs`". Answer {id, error}. Auth "Authorization: Bearer <key>".
//   - tryon-max inputs: product_image + model_image (image URL | data URI,
//     both required), resolution 1k|2k|4k, generation_mode
//     fast|balanced|quality, num_images 1-4, output_format png|jpeg,
//     return_base64. No garment category: the model takes any product image,
//     which suits draped cloth and stoles better than tops/bottoms models.
//   - GET /v1/status/{id} -> {id, status, output[], error{name, message}};
//     statuses starting | in_queue | processing | completed | failed
//     (SDK comments also mention canceled and time_out).
//   - Outputs are URLs on cdn.fashn.ai or media.fashn.ai, expiring after
//     three days. Failed predictions are not charged.
//   - API-level errors {error, message}: 400 BadRequest, 401
//     UnauthorizedAccess, 404 NotFound, 429 RateLimitExceeded /
//     ConcurrencyLimitExceeded / OutOfCredits, 500 InternalServerError; "no
//     prediction was created" for these.
//   - Cost per output (tryon-max, 1k): fast 1, balanced 2, quality 3 credits.
//
// Deliberately NOT used:
//   - Webhooks. FASHN documents no webhook signature, so a callback could be
//     forged by anyone who learns the URL. Jobs complete by polling (the
//     customer's poll plus the sweepTryOnJobs scheduler), which is enough.
//   - Cancel. No cancel endpoint is documented; an abandoned job simply ends
//     on our side at its deadline.
//
// The API key is only ever sent to the configured API host, never to the
// output CDN.
import axios from 'axios';

const DEFAULT_BASE_URL = 'https://api.fashn.ai/v1';
const MODEL_NAME = 'tryon-max';
const GENERATION_MODES = Object.freeze(['fast', 'balanced', 'quality']);
const DEFAULT_GENERATION_MODE = 'fast'; // cheapest: 1 credit per image at 1k
const OUTPUT_HOSTS = new Set(['cdn.fashn.ai', 'media.fashn.ai']);
const MAX_RESULT_BYTES = 15 * 1024 * 1024;

const baseUrl = (config) => config.apiBaseUrl || DEFAULT_BASE_URL;
const generationMode = (config) => config.generationMode || DEFAULT_GENERATION_MODE;

const authHeaders = (config) => ({
  Authorization: `Bearer ${config.apiKey}`,
  'Content-Type': 'application/json',
});

/** FASHN status -> normalised status. */
const STATUS_MAP = {
  starting: 'queued',
  in_queue: 'queued',
  processing: 'processing',
  completed: 'succeeded',
  failed: 'failed',
  canceled: 'canceled',
  time_out: 'failed',
};

/** FASHN runtime error name -> normalised code. Text is never forwarded. */
const RUNTIME_ERRORS = {
  ImageLoadError: 'provider_rejected_input',
  InputValidationError: 'provider_rejected_input',
  ContentModerationError: 'provider_rejected_input',
  UnavailableError: 'provider_unavailable',
  ThirdPartyError: 'provider_unavailable',
  PipelineError: 'generation_failed',
};

/** Is this a URL FASHN serves outputs from? */
export const isFashnOutputUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:'
    && !url.username && !url.password && !url.port
    && OUTPUT_HOSTS.has(url.hostname.toLowerCase());
};

const normalisePrediction = (data) => {
  const status = STATUS_MAP[data?.status] || 'processing';
  const output = Array.isArray(data?.output) ? data.output : [];
  let errorCode = null;
  if (status === 'failed') {
    errorCode = data?.status === 'time_out' ? 'job_timeout' : RUNTIME_ERRORS[data?.error?.name] || 'generation_failed';
  } else if (status === 'canceled') {
    errorCode = 'canceled';
  }
  return {
    providerJobId: typeof data?.id === 'string' && data.id ? data.id : null,
    status,
    resultRef: status === 'succeeded' && typeof output[0] === 'string' ? output[0] : null,
    errorCode,
  };
};

const fashnTryOn = {
  id: 'fashn',
  label: 'FASHN Try-On Max',

  capabilities: Object.freeze({
    personImage: true,
    referenceGarmentImage: true,
    // tryon-max takes no category. These are the internal categories the
    // catalog produces for WEARABLE products (non-wearables are refused
    // before this point), all of which the model accepts.
    garmentCategories: Object.freeze(['upper_body', 'lower_body', 'dresses']),
    completion: Object.freeze(['poll']),
    // Images are sent inline as data URIs. FASHN allows 30 MiB but warns that
    // large base64 bodies cause 500s; 2 MB keeps the request small (photos
    // are downscaled to fit, see tryOnJobService.fitInline).
    maxInlineImageBytes: 2 * 1024 * 1024,
  }),

  /** Facts the operator must settle before production use. */
  verification: Object.freeze({
    // Field names are from FASHN's API reference; confirm with the first
    // live try-on (AI_TRYON_PROVIDER_SETUP.md).
    inputSchemaVerified: false,
    // The docs describe tryon-max as built for "publishable e-commerce
    // content" but state no licence; the operator confirms the terms.
    commercialUseAllowed: false,
    licence: 'FASHN Terms of Service (https://fashn.ai/legal/terms-of-service) — confirm commercial use',
  }),

  /**
   * @param {ReturnType<import('../config.js').getTryOnConfig>} config
   * @returns {string[]} operator-facing problems (never contain secret values)
   */
  validateConfiguration(config) {
    const problems = [];
    if (!config.apiKey) problems.push('AI_TRYON_API_KEY is not set');
    if (config.apiBaseUrl) {
      try {
        if (new URL(config.apiBaseUrl).protocol !== 'https:') problems.push('AI_TRYON_API_BASE_URL must be https');
      } catch {
        problems.push('AI_TRYON_API_BASE_URL is not a valid URL');
      }
    }
    if (config.modelVersion && config.modelVersion !== MODEL_NAME) {
      problems.push(`AI_TRYON_MODEL_VERSION must be empty or "${MODEL_NAME}" for the fashn provider`);
    }
    if (config.generationMode && !GENERATION_MODES.includes(config.generationMode)) {
      problems.push(`AI_TRYON_GENERATION_MODE must be one of: ${GENERATION_MODES.join(', ')}`);
    }
    return problems;
  },

  /** Internal category -> provider value, or null when unsupported. */
  mapGarmentCategory(category) {
    return this.capabilities.garmentCategories.includes(category) ? category : null;
  },

  /**
   * @param {{ personImage: string, garmentImage: string, garmentDescription: string,
   *           garmentCategory: string, webhookUrl?: string|null }} input
   * @param {ReturnType<import('../config.js').getTryOnConfig>} config
   */
  async submitJob(input, config) {
    const body = {
      model_name: MODEL_NAME,
      inputs: {
        model_image: input.personImage,
        product_image: input.garmentImage,
        resolution: '1k',
        generation_mode: generationMode(config),
        num_images: 1,
        output_format: 'jpeg',
        return_base64: false,
      },
    };
    const resp = await axios.post(`${baseUrl(config)}/run`, body, {
      headers: authHeaders(config),
      timeout: 60_000,
      maxRedirects: 0,
      maxBodyLength: 12 * 1024 * 1024,
    });
    if (resp.data?.error) {
      const err = new Error('provider refused the run');
      err.tryOnCode = RUNTIME_ERRORS[resp.data.error?.name] || 'provider_rejected_input';
      throw err;
    }
    const job = normalisePrediction({ ...resp.data, status: 'starting' });
    if (!job.providerJobId) {
      const err = new Error('provider returned no prediction id');
      err.tryOnCode = 'submit_outcome_unknown';
      throw err;
    }
    return job;
  },

  async getJobStatus(providerJobId, config) {
    const resp = await axios.get(
      `${baseUrl(config)}/status/${encodeURIComponent(providerJobId)}`,
      { headers: authHeaders(config), timeout: 30_000, maxRedirects: 0 },
    );
    return normalisePrediction(resp.data);
  },

  /** FASHN documents no cancel endpoint; the job ends on our side. */
  async cancelJob() {},

  /**
   * Download the finished image from FASHN's CDN only. The URL comes from
   * the provider's response but is still checked, and no credentials are
   * sent with it.
   * @returns {Promise<Buffer>}
   */
  async fetchResult(resultRef) {
    if (!isFashnOutputUrl(resultRef)) {
      const err = new Error('result URL is not on the provider output host');
      err.tryOnCode = 'result_unavailable';
      throw err;
    }
    const resp = await axios.get(resultRef, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxRedirects: 0,
      maxContentLength: MAX_RESULT_BYTES,
    });
    return Buffer.from(resp.data);
  },

  /** Unsigned provider: no callback is ever trusted. */
  verifyWebhook() {
    return false;
  },

  parseWebhook() {
    return null;
  },

  /**
   * Provider failure -> normalised code.
   * @param {any} err
   * @param {'submit'|'status'|'result'|'cancel'} phase
   */
  classifyError(err, phase) {
    if (err?.tryOnCode) return err.tryOnCode;
    const status = err?.response?.status;
    const name = err?.response?.data?.error;
    if (status === 401 || status === 403) return 'provider_auth';
    if (status === 429) return name === 'OutOfCredits' ? 'provider_quota' : 'provider_rate_limited';
    if (status === 400 || status === 404 || status === 413 || status === 422) {
      return phase === 'submit' ? 'provider_rejected_input' : 'result_unavailable';
    }
    // FASHN: an API-level error means no prediction was created.
    if (status >= 500) return 'provider_unavailable';
    if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') {
      return 'provider_unavailable';
    }
    // Timeout / reset with no response: the run may have started.
    return phase === 'submit' ? 'submit_outcome_unknown' : 'provider_unavailable';
  },
};

export default fashnTryOn;
