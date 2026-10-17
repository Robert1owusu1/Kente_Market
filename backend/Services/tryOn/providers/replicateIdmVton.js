// FILE LOCATION: backend/Services/tryOn/providers/replicateIdmVton.js
// DESCRIPTION: Provider adapter: IDM-VTON (cuuupid/idm-vton) on Replicate.
//
// Everything Replicate-specific lives here: URLs, auth header, payload shape,
// status vocabulary, output parsing, webhook signatures, error mapping. The
// rest of the app only sees the adapter contract (see ./index.js and
// AI_TRYON_ARCHITECTURE.md).
//
// Sources (Replicate docs, read 2026-10-14):
//   - HTTP API  https://replicate.com/docs/reference/http
//       POST /v1/predictions {version, input, webhook, webhook_events_filter},
//       GET /v1/predictions/{id}, POST /v1/predictions/{id}/cancel,
//       "Authorization: Bearer <token>", optional `Cancel-After` header.
//       Files "should be passed as HTTP URLs or data URLs".
//   - Lifecycle https://replicate.com/docs/topics/predictions/lifecycle
//       statuses starting | processing | succeeded | failed | canceled | aborted.
//   - Webhooks  https://replicate.com/docs/topics/webhooks/verify-webhook
//       HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${rawBody}`, key =
//       base64 part of the `whsec_` secret, header `webhook-signature` holds
//       space-separated `v1,<base64>` entries; deliveries may repeat.
//   - Output    https://replicate.com/docs/topics/predictions/output-files
//       files served from replicate.delivery and subdomains, expire after 1h.
//   - Retention https://replicate.com/docs/topics/predictions/data-retention
//       API predictions: inputs, outputs, files and logs removed after 1 hour.
//
// NOT verified (must be checked against the live model schema before
// activation — see AI_TRYON_PROVIDER_SETUP.md): the model's input names
// (human_img, garm_img, garment_des, category) and its `category` choices.
// They are what the previous in-controller integration sent. The model's
// licence is CC BY-NC-SA 4.0 (non-commercial), so production activation is
// refused unless the operator confirms commercial terms.
import crypto from 'crypto';
import axios from 'axios';

const DEFAULT_BASE_URL = 'https://api.replicate.com/v1';
// The version the previous integration pinned ("verified live" at the time).
const DEFAULT_MODEL_VERSION = '0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985';
const VERSION_RE = /^(?:[a-z0-9_.-]+\/[a-z0-9_.-]+:)?[a-f0-9]{64}$/i;
const WEBHOOK_SECRET_RE = /^whsec_[A-Za-z0-9+/=]+$/;
// Docs give no number; 5 minutes is the Standard Webhooks default.
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const MAX_RESULT_BYTES = 15 * 1024 * 1024;

const baseUrl = (config) => config.apiBaseUrl || DEFAULT_BASE_URL;
const modelVersion = (config) => config.modelVersion || DEFAULT_MODEL_VERSION;

const authHeaders = (config) => ({
  Authorization: `Bearer ${config.apiKey}`,
  'Content-Type': 'application/json',
});

/** Replicate status -> normalised status. */
const STATUS_MAP = {
  starting: 'queued',
  processing: 'processing',
  succeeded: 'succeeded',
  failed: 'failed',
  canceled: 'canceled',
  aborted: 'canceled',
};

/** Output is a file URL string or an array whose first entry is one. */
const firstOutputUrl = (output) => {
  if (typeof output === 'string' && output) return output;
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0];
  return null;
};

/** Is this a URL Replicate serves output files from? */
export const isReplicateOutputUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:'
    && !url.username && !url.password && !url.port
    && (host === 'replicate.delivery' || host.endsWith('.replicate.delivery'));
};

const normalisePrediction = (data) => {
  const status = STATUS_MAP[data?.status] || 'processing';
  return {
    providerJobId: typeof data?.id === 'string' ? data.id : null,
    status,
    resultRef: status === 'succeeded' ? firstOutputUrl(data.output) : null,
    // Replicate's `error` is free text from the model run; it is mapped to a
    // fixed code and never shown or stored verbatim.
    errorCode: status === 'failed' ? 'generation_failed' : status === 'canceled' ? 'canceled' : null,
  };
};

const replicateIdmVton = {
  id: 'replicate-idm-vton',
  label: 'IDM-VTON on Replicate',

  capabilities: Object.freeze({
    personImage: true,
    referenceGarmentImage: true,
    // DressCode categories. Unverified against the live schema (see header).
    garmentCategories: Object.freeze(['upper_body', 'lower_body', 'dresses']),
    completion: Object.freeze(['poll', 'webhook']),
    // Docs: data URIs recommended only "if the file is less than 1MB".
    maxInlineImageBytes: 1024 * 1024,
  }),

  /** Facts the operator must settle before production use. */
  verification: Object.freeze({
    inputSchemaVerified: false,
    commercialUseAllowed: false,
    licence: 'CC BY-NC-SA 4.0 (non-commercial) per the model page',
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
    if (config.modelVersion && !VERSION_RE.test(config.modelVersion)) {
      problems.push('AI_TRYON_MODEL_VERSION must be a 64-hex version id (optionally owner/model:<id>)');
    }
    if (config.webhookSecret && !WEBHOOK_SECRET_RE.test(config.webhookSecret)) {
      problems.push('AI_TRYON_WEBHOOK_SECRET must be the whsec_... value from GET /v1/webhooks/default/secret');
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
      version: modelVersion(config),
      input: {
        human_img: input.personImage,
        garm_img: input.garmentImage,
        garment_des: input.garmentDescription,
        category: input.garmentCategory,
      },
    };
    if (input.webhookUrl) {
      body.webhook = input.webhookUrl;
      body.webhook_events_filter = ['completed'];
    }
    const resp = await axios.post(`${baseUrl(config)}/predictions`, body, {
      headers: {
        ...authHeaders(config),
        // Provider-side ceiling so an abandoned run stops billing.
        'Cancel-After': `${config.jobTimeoutMinutes}m`,
      },
      timeout: 60_000,
      maxRedirects: 0,
    });
    const job = normalisePrediction(resp.data);
    if (!job.providerJobId) {
      const err = new Error('provider returned no prediction id');
      err.tryOnCode = 'submit_outcome_unknown';
      throw err;
    }
    return job;
  },

  async getJobStatus(providerJobId, config) {
    const resp = await axios.get(
      `${baseUrl(config)}/predictions/${encodeURIComponent(providerJobId)}`,
      { headers: authHeaders(config), timeout: 30_000, maxRedirects: 0 },
    );
    return normalisePrediction(resp.data);
  },

  /** Best effort; a failure here is logged by the caller, never retried. */
  async cancelJob(providerJobId, config) {
    await axios.post(
      `${baseUrl(config)}/predictions/${encodeURIComponent(providerJobId)}/cancel`,
      {},
      { headers: authHeaders(config), timeout: 15_000, maxRedirects: 0 },
    );
  },

  /**
   * Download the finished image. Only Replicate's own output host is ever
   * fetched (the URL comes from the provider's response, but it is still
   * checked: our API key must never be sent anywhere else).
   * @returns {Promise<Buffer>}
   */
  async fetchResult(resultRef, config) {
    if (!isReplicateOutputUrl(resultRef)) {
      const err = new Error('result URL is not on the provider output host');
      err.tryOnCode = 'result_unavailable';
      throw err;
    }
    const resp = await axios.get(resultRef, {
      // The HTTP reference says output files need the Authorization header.
      headers: { Authorization: `Bearer ${config.apiKey}` },
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxRedirects: 0,
      maxContentLength: MAX_RESULT_BYTES,
    });
    return Buffer.from(resp.data);
  },

  /**
   * @param {{ rawBody: Buffer|string, headers: Record<string, string|string[]|undefined>,
   *           secret: string, nowSeconds?: number }} args
   */
  verifyWebhook({ rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
    const header = (name) => {
      const v = headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const id = header('webhook-id');
    const timestamp = header('webhook-timestamp');
    const signatures = header('webhook-signature');
    if (!id || !timestamp || !signatures || !WEBHOOK_SECRET_RE.test(secret || '')) return false;
    const ts = Number(timestamp);
    if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;

    const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
    const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();

    return String(signatures).split(' ').some((entry) => {
      const [version, sig] = entry.split(',');
      if (version !== 'v1' || !sig) return false;
      const given = Buffer.from(sig, 'base64');
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
  },

  /** Webhook body is the same shape as GET /predictions/{id}. */
  parseWebhook(body) {
    return normalisePrediction(body);
  },

  /**
   * Provider failure -> normalised code. `phase` matters: a submit that timed
   * out may still have started a paid run.
   * @param {any} err
   * @param {'submit'|'status'|'result'|'cancel'} phase
   */
  classifyError(err, phase) {
    if (err?.tryOnCode) return err.tryOnCode;
    const status = err?.response?.status;
    if (status === 401 || status === 403) return 'provider_auth';
    // 402 is not in Replicate's documented error list; treated as quota if seen.
    if (status === 402) return 'provider_quota';
    if (status === 429) return 'provider_rate_limited';
    if (status === 400 || status === 404 || status === 413 || status === 422) {
      return phase === 'submit' ? 'provider_rejected_input' : 'result_unavailable';
    }
    if (status >= 500) return phase === 'submit' ? 'submit_outcome_unknown' : 'provider_unavailable';
    // No response: refused before sending means nothing was created; anything
    // else (timeout, reset) leaves the outcome unknown.
    if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') {
      return 'provider_unavailable';
    }
    return phase === 'submit' ? 'submit_outcome_unknown' : 'provider_unavailable';
  },
};

export default replicateIdmVton;
