// FILE LOCATION: middleware/csrfMiddleware.js
// DESCRIPTION: CSRF protection for cookie-based authentication.
//
// Two layers:
//  1. Origin/Referer check — state-changing requests from a disallowed origin
//     are rejected outright (browsers send Origin on cross-origin POST/PUT/
//     DELETE; forms send Referer). Requests with NO Origin/Referer are only
//     trusted further by layer 2.
//  2. Signed double-submit token — set alongside the session JWT cookie.
//     Any state-changing request that CARRIES the csrf cookie must also echo
//     it back in the X-CSRF-Token header. The value is HMAC-signed with
//     JWT_SECRET, so an attacker can neither read the cookie from a foreign
//     origin nor forge one for the victim's host. Requests without the cookie
//     (public endpoints, Paystack webhooks, first-time logins) need no token.
//
// SameSite=Lax/Strict already stops most CSRF, but the documented
// cross-origin topology (Vercel SPA + Render API) requires SameSite=None,
// which removes that guard — this middleware is what enforces CSRF there.

import crypto from 'crypto';
import { cookieSameSite } from '../config/cookieConfig.js';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const signCsrf = (raw) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(raw).digest('hex');

const verifyCsrf = (raw, signature) => {
  const expected = Buffer.from(signCsrf(raw), 'utf8');
  const actual = Buffer.from(String(signature || ''), 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const issueCsrfToken = () => {
  const raw = crypto.randomBytes(32).toString('base64url');
  return `${raw}.${signCsrf(raw)}`; // <random>.<hmac> — host-only signed double-submit
};

/** Cookie attributes mirror the JWT session cookie (minus HttpOnly so the SPA can echo it). */
const csrfCookieOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: cookieSameSite(),
  maxAge: CSRF_COOKIE_MAX_AGE,
  path: '/',
});

/** Refresh the CSRF token cookie (used the moment a session JWT is issued). */
export const setCsrfCookie = (res) => {
  res.cookie(CSRF_COOKIE_NAME, issueCsrfToken(), csrfCookieOptions());
  return res;
};

/**
 * Return the current CSRF cookie value, or issue one if absent. The SPA must
 * read its CSRF token from this (via the /api/auth/csrf-token endpoint) —
 * document.cookie cannot see the cookie because it is host-only on the API
 * origin, while the SPA runs on a cross-site origin.
 */
export const getOrIssueCsrfToken = (req, res) => {
  const existing = req.cookies?.[CSRF_COOKIE_NAME];
  if (existing) return existing;
  const token = issueCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  return token;
};

/** Clear the CSRF cookie (used on logout, mirroring the JWT clear). */
export const clearCsrfCookie = (res) => {
  res.cookie(CSRF_COOKIE_NAME, '', {
    ...csrfCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
  return res;
};

const isAllowedOrigin = (origin) => {
  if (!origin) return false;
  try {
    new URL(origin);
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    if (isLocalhost && process.env.NODE_ENV !== 'production') return true;

    const allowedOrigins = (process.env.FRONTEND_URL || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    return allowedOrigins.includes(origin);
  } catch {
    return false;
  }
};

const originMatches = (headers) => {
  const referer = headers.referer ? new URL(headers.referer).origin : null;
  const origin = headers.origin || referer;
  return { origin, explicit: !!headers.origin || !!referer, allowed: isAllowedOrigin(headers.origin || referer) };
};

export const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Layer 1: an explicit but disallowed origin is always rejected (Prevent
  // CSRF with an Origin check — OWASP). No origin (server-to-server calls
  // like Paystack webhooks, curl) falls through to layer 2.
  const { explicit, allowed } = originMatches(req.headers);
  if (explicit && !allowed) {
    return res.status(403).json({ message: 'Cross-site request rejected' });
  }

  // Layer 2: signed double-submit token. If the browser sent our CSRF cookie
  // (an authenticated session), the same value must come back in the header.
  // Multi-value support: both AppleMail and some forms send a list.
  const cookieValue = req.cookies?.[CSRF_COOKIE_NAME];
  if (cookieValue === undefined) {
    return next(); // no session cookie => nothing to protect
  }

  const header = req.headers[CSRF_HEADER_NAME];
  const supplied = Array.isArray(header) ? header[0] : header;
  if (!supplied) {
    return res.status(403).json({ message: 'CSRF token missing' });
  }

  // The cookie must be a valid signed token AND the header must be an exact
  // constant-time match of it. Because the value embeds an HMAC under
  // JWT_SECRET, an attacker can't substitute a cookie/header pair they chose.
  const [cookieRaw, cookieSignature] = String(cookieValue).split('.', 2);
  const cookieValid = cookieRaw && cookieSignature && verifyCsrf(cookieRaw, cookieSignature);

  const a = Buffer.from(String(supplied), 'utf8');
  const b = Buffer.from(String(cookieValue), 'utf8');
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!cookieValid || !matches) {
    return res.status(403).json({ message: 'CSRF token mismatch' });
  }

  return next();
};