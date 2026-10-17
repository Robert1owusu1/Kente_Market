// FILE LOCATION: backend/Services/tryOn/config.js
// DESCRIPTION: The one place AI try-on reads its environment. Everything is
//              re-read on each call (tests and operators flip the kill switch
//              without a restart) and every number is clamped to a sane range,
//              so a typo can loosen a cost bound only as far as the clamp.
//              Provider credentials are read here and handed to the adapter;
//              they are never returned to a route, logged, or echoed in an
//              error. See AI_TRYON_PROVIDER_SETUP.md for every variable.

const intEnv = (name, fallback, min, max) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const trimmed = (name) => (process.env[name] || '').trim();

/**
 * @returns {{
 *   enabled: boolean, providerId: string, apiKey: string, apiBaseUrl: string,
 *   modelVersion: string, webhookSecret: string, publicApiUrl: string,
 *   termsAccepted: boolean, production: boolean,
 *   maxActivePerUser: number, maxActiveGlobal: number,
 *   jobTimeoutMinutes: number, resultTtlHours: number, jobRecordRetentionDays: number,
 *   resultDir: string,
 * }}
 */
export const getTryOnConfig = () => ({
  // Kill switch: anything but the literal string "true" is off.
  enabled: process.env.AI_TRYON_ENABLED === 'true',
  // No default provider: an unset value means "not configured", never a guess.
  providerId: trimmed('AI_TRYON_PROVIDER').toLowerCase(),
  // REPLICATE_API_TOKEN is the pre-adapter name, still honoured so an existing
  // deployment does not silently lose its key; AI_TRYON_API_KEY wins.
  apiKey: trimmed('AI_TRYON_API_KEY') || trimmed('REPLICATE_API_TOKEN'),
  apiBaseUrl: trimmed('AI_TRYON_API_BASE_URL'),
  modelVersion: trimmed('AI_TRYON_MODEL_VERSION'),
  webhookSecret: trimmed('AI_TRYON_WEBHOOK_SECRET'),
  publicApiUrl: trimmed('AI_TRYON_PUBLIC_API_URL').replace(/\/+$/, ''),
  termsAccepted: process.env.AI_TRYON_PROVIDER_TERMS_ACCEPTED === 'true',
  production: process.env.NODE_ENV === 'production',
  maxActivePerUser: intEnv('AI_TRYON_MAX_ACTIVE_PER_USER', 2, 1, 10),
  maxActiveGlobal: intEnv('AI_TRYON_MAX_ACTIVE_GLOBAL', 8, 1, 100),
  // Hard ceiling on one job, start to finish (Replicate documents its own
  // 30-minute run limit); ours is tighter and is also sent as Cancel-After.
  jobTimeoutMinutes: intEnv('AI_TRYON_JOB_TIMEOUT_MINUTES', 10, 2, 30),
  // How long a finished try-on image is kept for its owner.
  resultTtlHours: intEnv('AI_TRYON_RESULT_TTL_HOURS', 24, 1, 168),
  // How long the (photo-free) job metadata row is kept after it ends.
  jobRecordRetentionDays: intEnv('AI_TRYON_JOB_RETENTION_DAYS', 30, 1, 365),
  resultDir: trimmed('AI_TRYON_RESULT_DIR'),
});
