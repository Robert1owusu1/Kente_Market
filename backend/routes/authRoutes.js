// routes/authRoutes.js
import express from 'express';
import { TERMS_VERSION } from '../config/legalTerms.js';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { generateToken } from '../config/passPort.js';
import { cookieSameSite, cookieSecure } from '../config/cookieConfig.js';
import { authLimiter } from '../middleware/rateLimitMiddleware.js';
import { setCsrfCookie, getOrIssueCsrfToken } from '../middleware/csrfMiddleware.js';
import { consumeOnce } from '../utils/redisClient.js';
import User from '../models/usersModel.js';

const router = express.Router();

// Matches the OAuth session token lifetime (SESSION_7D). These used to disagree:
// the cookie was valid for 30 days while the JWT inside it expired in 7 (and 30
// in the old duplicate signer), so the cookie outlived its own token and kept
// re-sending a dead credential on every request for three weeks.
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const CONSENT_COOKIE_MAX_AGE = 10 * 60 * 1000; // 10 minutes

// Sign a short-lived token proving the user accepted the legal policies.
// The TERMS_VERSION claim binds the proof to a REVISION: a consent token
// minted before a Terms update no longer validates, so OAuth signup cannot
// ride an old acceptance through a new version.
const signConsentToken = () =>
  jwt.sign({ purpose: 'legal_consent', termsVersion: TERMS_VERSION }, process.env.JWT_SECRET, { expiresIn: '10m' });

// Verify a consent token; returns true only for a genuine legal_consent
// token issued for the CURRENT terms revision.
const isConsentTokenValid = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.purpose === 'legal_consent' && decoded.termsVersion === TERMS_VERSION;
  } catch {
    return false;
  }
};

// Record that this browser session accepted the legal policies. The short-lived
// signed token is passed to /api/auth/google and mirrored into an httpOnly cookie
// so the acceptance can be proven again at the OAuth callback.
router.post('/consent', authLimiter, (req, res) => {
  const { accepted } = req.body || {};
  if (!accepted) {
    return res.status(400).json({ message: 'You must accept the legal policies before continuing' });
  }
  const consentToken = signConsentToken();
  res.cookie('oauth_consent', consentToken, {
    httpOnly: true,
    secure: cookieSecure(res.req), // N-8
    sameSite: cookieSameSite(),
    maxAge: CONSENT_COOKIE_MAX_AGE,
    path: '/'
  });
  res.json({ consentToken });
});

// Helper: issue the real session cookie. Called both on direct redirect (for
// browsers that accept cross-site redirect cookies) and on the exchange
// endpoint (the partitioned-cookie-safe path all modern browsers use).
const setAuthCookie = (res, token) => {
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: cookieSecure(res.req), // N-8
    sameSite: cookieSameSite(),
    maxAge: COOKIE_MAX_AGE
  });
  setCsrfCookie(res);
};

// Helper: Handle OAuth callback success
const handleOAuthSuccess = (req, res) => {
  try {
    const user = req.user;
    const token = generateToken(user);

    // Set HTTP-only cookie (same as your regular login). This still works in
    // browsers that accept cookies set during a cross-site redirect.
    setAuthCookie(res, token);

    // Partitioned-cookie-safe path: short-lived, purpose-bound token appended
    // as a URL FRAGMENT (# = never sent to any server, never logged, never in
    // Referer). The frontend exchanges it via POST /api/auth/oauth/exchange,
    // which issues the real cookie inside a normal fetch whose top-level site
    // is the Vercel frontend — so partitioned storage (Firefox Total Cookie
    // Protection / Chrome partitioning) keeps it instead of dropping it.
    const exchangeToken = jwt.sign(
      { id: user.id, purpose: 'oauth_exchange', tv: user.tokenVersion, jti: crypto.randomUUID() },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    // NOTE: no user data is placed in the URL. The exchange token is signed
    // with JWT_SECRET and purpose-bound, so credentials can never be forged
    // via a crafted callback URL.
    res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?success=true#token=${exchangeToken}`);
  } catch (error) {
    console.error('OAuth success handler error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
};

// ============================================
// GOOGLE OAUTH ROUTES
// ============================================

// Sign a short-lived, browser-bound state token for OAuth CSRF protection.
// Stored in an httpOnly cookie and verified at callback.
const signOAuthState = () =>
  jwt.sign({ purpose: 'oauth_state', nonce: crypto.randomUUID() }, process.env.JWT_SECRET, { expiresIn: '10m' });

// Returns the claims of a genuine state token, or null. Callers need the
// claims (specifically the nonce) — V-05's single-use is now enforced by
// consuming that nonce server-side, not just by the browser dropping a cookie.
const decodeOAuthState = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.purpose === 'oauth_state' && decoded.nonce ? decoded : null;
  } catch {
    return null;
  }
};

// V-05: in-process fallback for consumed state nonces. Mirrors the
// oauth:exchange consumer below: Redis is the durable, cross-instance store
// (consumeOnce → SET NX); when Redis is unavailable the Map is the fallback,
// so a replay is still refused within this process. Entries live exactly as
// long as the token they mirror (10 minutes) — after that the JWT's own
// expiry is the only remaining check and it still refuses.
const consumedStateNonces = new Map();
const pruneStateNonces = () => {
  const now = Date.now();
  for (const [nonce, at] of consumedStateNonces) {
    if (now - at > 10 * 60 * 1000) consumedStateNonces.delete(nonce);
  }
  if (consumedStateNonces.size > 2000) {
    for (const nonce of consumedStateNonces.keys()) consumedStateNonces.delete(nonce);
  }
};

// Initiate Google OAuth. Account CREATION (signup) requires proof of legal
// acceptance (signed consent token from POST /api/auth/consent).
// Plain /google is LOGIN ONLY, never creates an account (RB-06), and must
// NOT gate returning users on re-accepting Terms/Privacy.
// `mode=signup` selects the explicit account-creation path.
const startGoogleOAuth = (mode) => (req, res, next) => {
    if (mode === 'signup') {
      if (!isConsentTokenValid(req.query.consent)) {
        return res.redirect(`${process.env.FRONTEND_URL}/register?error=consent_required`);
      }
      // Mirror the acceptance into an httpOnly cookie so we can re-verify it at the
      // callback (the consent query param will not survive the Google round-trip).
      res.cookie('oauth_consent', signConsentToken(), {
        httpOnly: true,
        secure: cookieSecure(res.req), // N-8
        sameSite: cookieSameSite(),
        maxAge: CONSENT_COOKIE_MAX_AGE,
        path: '/'
      });
    }

    // RB-06: Issue a per-request, browser-bound state token to
    // prevent login CSRF / session fixation. The state is stored in an httpOnly
    // cookie AND passed to Google as the OAuth `state` param; the callback
    // verifies they match. Single-use via cookie clear at callback.
    const stateToken = signOAuthState();
    res.cookie('oauth_state', stateToken, {
      httpOnly: true,
      secure: cookieSecure(res.req), // N-8
      sameSite: cookieSameSite(),
      maxAge: CONSENT_COOKIE_MAX_AGE,
      path: '/'
    });

    req.oauthMode = mode;
    res.cookie('oauth_mode', mode, {
      httpOnly: true,
      secure: cookieSecure(res.req), // N-8
      sameSite: cookieSameSite(),
      maxAge: CONSENT_COOKIE_MAX_AGE,
      path: '/'
    });
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
      state: stateToken,
    })(req, res, next);
};

router.get('/google', startGoogleOAuth('login'));
// Explicit Google signup path — the ONLY OAuth path that may create accounts.
router.get('/google/signup', startGoogleOAuth('signup'));

// Google OAuth callback. The state cookie must always be present and valid.
// The consent cookie is only required for signup (account creation); login
// must not re-gate returning users.
const googleCallbackMode = (req, res, next) => {
  // mode is carried in the callback `state` round-trip? No — the state JWT is
  // opaque. Carry mode via a short-lived httpOnly cookie set at initiation.
  req.oauthMode = req.cookies?.oauth_mode === 'signup' ? 'signup' : 'login';
  next();
};
router.get('/google/callback',
  googleCallbackMode,
  async (req, res, next) => {
    if (req.oauthMode === 'signup' && !isConsentTokenValid(req.cookies.oauth_consent)) {
      return res.redirect(`${process.env.FRONTEND_URL}/register?error=consent_required`);
    }
    // RB-06: Verify OAuth state parameter (login CSRF protection).
    // The state must be present in the query, match the httpOnly cookie, and
    // be single-use — enforced SERVER-SIDE by consuming its nonce (V-05
    // residual closed: the signed JWT alone stays valid for its full 10
    // minutes, and the browser dropping its cookie is not a defence that
    // binds an attacker who already holds both halves of the pair).
    const refuse = () =>
      res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_oauth_state`);
    try {
      const queryState = req.query.state;
      const cookieState = req.cookies?.oauth_state;
      const stateClaims = typeof queryState === 'string' ? decodeOAuthState(queryState) : null;
      if (!queryState || !cookieState || queryState !== cookieState || !stateClaims) {
        return refuse();
      }
      // Burn the nonce ONLY after every other check has passed — a rejected
      // attempt must not consume the legitimate browser's state. Same
      // fast-path-then-Redis contract as the exchange consumer below.
      if (consumedStateNonces.has(stateClaims.nonce)) return refuse();
      const consumed = await consumeOnce(`oauth:state:${stateClaims.nonce}`, 10 * 60);
      if (consumed === false) return refuse(); // Redis has seen this nonce already
      if (consumed === null) {
        consumedStateNonces.set(stateClaims.nonce, Date.now());
        pruneStateNonces();
      }
      // Clear the state cookie so it can't be replayed by the browser either.
      res.clearCookie('oauth_state', { path: '/', httpOnly: true, secure: cookieSecure(res.req), sameSite: cookieSameSite() }); // N-8
      res.clearCookie('oauth_mode', { path: '/', httpOnly: true, secure: cookieSecure(res.req), sameSite: cookieSameSite() }); // N-8

      req.consentAt = new Date();
      next();
    } catch (err) {
      // Fail closed: a gate that cannot decide must refuse.
      console.error(' OAuth state gate error:', err.message);
      return refuse();
    }
  },
  (req, res, next) => {
    passport.authenticate('google', (err, user) => {
      // Generic failure for every OAuth error / unknown identity: no oracle
      // for whether an email exists (RB-06).
      if (err || !user) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=google_failed`);
      }
      req.user = user;
      return handleOAuthSuccess(req, res);
    })(req, res, next);
  }
);

// Consumed OAuth exchange tokens (jti). 1h TTL > 10m token lifetime, so a
// stolen/replayed exchange token can never mint a second session.
const consumedExchangeJtis = new Map();
const pruneExchangeJtis = () => {
  const now = Date.now();
  for (const [jti, at] of consumedExchangeJtis) {
    if (now - at > 60 * 60 * 1000) consumedExchangeJtis.delete(jti);
  }
  if (consumedExchangeJtis.size > 2000) {
    for (const jti of consumedExchangeJtis.keys()) consumedExchangeJtis.delete(jti);
  }
};

// Exchange the short-lived fragment token (sent by the frontend after the
// OAuth redirect) for a real session cookie. The cookie is set in this normal
// fetch response, whose top-level site is the Vercel frontend — this is the
// partitioned-cookie-safe path, identical to how a regular login works.
router.post('/oauth/exchange', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ message: 'Missing token' });
    }
    // No consent-cookie check here: consent is enforced at OAuth initiation
    // and callback for signup only. Login must not require it, and the
    // exchange token itself is purpose-bound, short-lived, and single-use.

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.purpose !== 'oauth_exchange') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    // SECURITY FIX (N-2): Use explicit null/undefined check instead of falsy check.
    // tokenVersion can be 0 (falsy) for legitimate users, which would incorrectly
    // reject their OAuth exchange.
    if (decoded.tv === undefined || decoded.tv === null || !decoded.jti) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    // One-time use: an exchange token must never be able to mint two sessions.
    // In-process check first (cheap, no I/O); a durable Redis check happens
    // after the user/token-version validation so a rejected token is never
    // burned.
    if (consumedExchangeJtis.has(decoded.jti)) {
      return res.status(401).json({ message: 'Token already used' });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    // Reject tokens issued before the latest credential/session change.
    if (user.tokenVersion === undefined || decoded.tv !== user.tokenVersion) {
      return res.status(401).json({ message: 'Session expired, please log in again' });
    }

    // Consume atomically via Redis when configured (durable across restarts and
    // instances). When Redis is unavailable, fall back to the in-process set.
    const reused = await consumeOnce(`oauth:exchange:${decoded.jti}`, 60 * 60);
    if (reused === false) {
      return res.status(401).json({ message: 'Token already used' });
    }
    if (reused === null) {
      consumedExchangeJtis.set(decoded.jti, Date.now());
      pruneExchangeJtis();
    }

    // Issue the real session cookie (same shape as regular login).
    const sessionToken = generateToken(user);
    setAuthCookie(res, sessionToken);

    res.json(user.getProfile());
  } catch (error) {
    console.error('OAuth exchange error:', error);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
});

// ============================================
// OAUTH STATUS CHECK
// ============================================

router.get('/status', (req, res) => {
  res.json({
    providers: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      facebook: false, // Not configured
      apple: false // Not implemented yet
    }
  });
});

// ============================================
// CSRF TOKEN (cross-site SPA read channel)
// ============================================
// The double-submit cookie is host-only on the API origin, so the SPA cannot
// read it via document.cookie (it runs on a cross-site origin). This safe GET
// lets the SPA obtain the current token to echo back in X-CSRF-Token. GET is
// exempt from CSRF checks, so no token is required to read it; CORS limits
// who may read the response to FRONTEND_URL only.
router.get('/csrf-token', (req, res) => {
  const csrfToken = getOrIssueCsrfToken(req, res);
  res.json({ csrfToken });
});

export default router;