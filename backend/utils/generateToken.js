// utils/generateToken.js - COMPLETE VERSION WITH REMEMBER ME
import jwt from 'jsonwebtoken';
import { cookieSameSite, cookieSecure } from '../config/cookieConfig.js';
import { setCsrfCookie } from '../middleware/csrfMiddleware.js';

export const SESSION_7D = '7d';
export const SESSION_30D = '30d';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sign a user session JWT. This is the ONLY place a `jwt` session cookie's
 * claims are defined.
 *
 * It used to exist twice with different shapes: this module signed
 * `{ id, tv }` at 7d/30d, while config/passPort.js exported its own
 * `generateToken(user)` signing `{ id, role, tv }` at a flat 30d and used by
 * the OAuth routes. Two functions with the same name, the same purpose, and
 * silently different lifetimes and claim sets is a footgun: a change to
 * session policy (adding a claim, shortening the lifetime, rotating the
 * algorithm) applies to password logins or to OAuth logins depending only on
 * which file you opened. Both now go through here.
 *
 * @param {object|number} userOrId - User record (carries .id, .role, .tokenVersion) or user ID
 * @param {string} expiresIn - Session lifetime
 * @returns {string} signed JWT
 */
export const signUserToken = (userOrId, expiresIn = SESSION_7D) => {
  const isUser = typeof userOrId === 'object' && userOrId !== null;
  const userId = isUser ? userOrId.id : userOrId;
  // Session-revocation claim: tokens are only valid while JWT `tv` matches the
  // user's current users.tokenVersion. Password/email changes bump the version,
  // which instantly invalidates every previously issued token.
  const tv = isUser ? (userOrId.tokenVersion ?? 0) : 0;
  return jwt.sign(
    { id: userId, role: isUser ? userOrId.role : undefined, tv },
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

/**
 * Generate JWT token and set it as HTTP-only cookie
 * @param {object} res - Express response object
 * @param {object|number} userOrId - User record (preferred: carries .id + .tokenVersion) or user ID
 * @param {boolean} rememberMe - Whether to extend token expiration (default: false)
 */
const generateToken = (res, userOrId, rememberMe = false) => {
  const userId = typeof userOrId === 'object' && userOrId !== null ? userOrId.id : userOrId;
  const tv = typeof userOrId === 'object' && userOrId !== null ? (userOrId.tokenVersion ?? 0) : 0;

  // Token expiration time
  // Remember Me: 30 days, Normal: 7 days
  const expiresIn = rememberMe ? SESSION_30D : SESSION_7D;
  const token = signUserToken(userOrId, expiresIn);

  // Calculate cookie max age in milliseconds
  const maxAge = rememberMe ? THIRTY_DAYS_MS : SEVEN_DAYS_MS;

  // Set JWT as HTTP-Only cookie
  res.cookie('jwt', token, {
    httpOnly: true,                                    // Prevents XSS attacks (client-side JavaScript cannot access)
    secure: cookieSecure(res.req),                    // N-8: forced for SameSite=None and production
    sameSite: cookieSameSite(),                         // CSRF (lax default; none for cross-origin frontend)
    maxAge: maxAge,                                    // Cookie expiration time
    path: '/'                                          // Cookie available for entire domain
  });

  // Signed double-submit CSRF token (state-changing /api calls must echo it in
  // X-CSRF-Token). Issued with every new session cookie.
  setCsrfCookie(res);

 console.log(` Token generated for user ${userId} (Remember Me: ${rememberMe}, Expires: ${rememberMe ? '30 days' : '7 days'}, tv: ${tv})`);
  
  return token;
};

export default generateToken;