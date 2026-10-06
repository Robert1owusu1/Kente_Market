// config/cookieConfig.js
// Cookie SameSite setting. Default is 'lax' (recommended for single-origin and
// still CSRF-resistant). When the frontend and API run on DIFFERENT origins
// (e.g. Vercel SPA + Render API), browsers will NOT attach cookies to cross-site
// fetch() calls unless SameSite=None (and Secure), so login/OAuth would silently
// break. Set COOKIE_SAME_SITE=none for that topology.
const SAME_SITE_VALUES = new Set(['lax', 'strict', 'none']);

export const cookieSameSite = () => {
  const value = (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase();
  return SAME_SITE_VALUES.has(value) ? value : 'lax';
};

/**
 * N-8 — the Secure flag must never depend on a single env var being set.
 *
 * Before this, every cookie in the codebase used
 * `secure: NODE_ENV === 'production'`, while the shipped `backend/.env` has
 * `NODE_ENV` **empty** and `COOKIE_SAME_SITE=none`. The live response was
 * `Set-Cookie: …; SameSite=None` with no `Secure` — rejected outright by
 * browsers, and if one had accepted it the session cookie would have been
 * cleartext-eligible.
 *
 * Rules, in order:
 *   1. `SameSite=None` is ONLY valid together with `Secure`, so that pair is
 *      forced unconditionally.
 *   2. Production always gets `Secure`, even when `NODE_ENV` was forgotten on
 *      the server (the exact footgun this replaces).
 *   3. Otherwise the actual request scheme decides: an HTTPS dev server or a
 *      TLS-terminating proxy (with TRUST_PROXY set) still yields Secure
 *      cookies, while plain-HTTP local development keeps working.
 *
 * @param {import('express').Request} [req]
 * @returns {boolean}
 */
export const cookieSecure = (req) => {
  if (cookieSameSite() === 'none') return true;
  if (process.env.NODE_ENV === 'production') return true;
  return req?.secure === true;
};