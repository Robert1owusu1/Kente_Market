// @ts-check
// FILE LOCATION: backend/config/frontendOrigins.js
// DESCRIPTION: Single reader for FRONTEND_URL (CFG-1).
//   FRONTEND_URL is a comma-separated list. Every entry is an allowed origin
//   for CORS and the CSRF Origin check; the FIRST entry is the canonical site
//   used to build links and redirects (password reset, OAuth callback,
//   Paystack callback_url, referral links, emails). Callers used to
//   interpolate the raw variable, so a second origin (e.g. a staging alias)
//   turned every link into "https://a.app,https://b.app/reset-password/…".
//   Trailing slashes are dropped: a browser Origin header never has one, so
//   "https://a.app/" used to fail the allow-list silently.

/** @param {string} o */
const normalize = (o) => o.trim().replace(/\/+$/, '');

/** All configured origins, normalized, empty entries removed. */
export const frontendOrigins = () =>
  String(process.env.FRONTEND_URL || '')
    .split(',')
    .map(normalize)
    .filter(Boolean);

/**
 * Canonical frontend base URL (first configured origin), or '' when unset.
 * Callers keep their own development fallback.
 */
export const frontendBaseUrl = () => frontendOrigins()[0] || '';
