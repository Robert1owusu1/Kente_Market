// routes/authRoutes.js
import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { generateToken } from '../config/passPort.js';
import { cookieSameSite } from '../config/cookieConfig.js';
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
const signConsentToken = () =>
  jwt.sign({ purpose: 'legal_consent' }, process.env.JWT_SECRET, { expiresIn: '10m' });

// Verify a consent token; returns true if it is a valid legal_consent token.
const isConsentTokenValid = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.purpose === 'legal_consent';
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
    secure: process.env.NODE_ENV === 'production',
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
    secure: process.env.NODE_ENV === 'production',
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

const isOAuthStateValid = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.purpose === 'oauth_state';
  } catch {
    return false;
  }
};

// Initiate Google OAuth. Refuses to start unless the caller has accepted the
// legal policies (signed consent token from POST /api/auth/consent).
router.get('/google',
  (req, res, next) => {
    if (!isConsentTokenValid(req.query.consent)) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=consent_required`);
    }
    // Mirror the acceptance into an httpOnly cookie so we can re-verify it at the
    // callback (the consent query param will not survive the Google round-trip).
    res.cookie('oauth_consent', signConsentToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: cookieSameSite(),
      maxAge: CONSENT_COOKIE_MAX_AGE,
      path: '/'
    });

    // SECURITY FIX (V-05): Issue a per-request, browser-bound state token to
    // prevent login CSRF / session fixation. The state is stored in an httpOnly
    // cookie and passed to Google; the callback verifies it matches.
    const stateToken = signOAuthState();
    res.cookie('oauth_state', stateToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: cookieSameSite(),
      maxAge: CONSENT_COOKIE_MAX_AGE,
      path: '/'
    });

    next();
  },
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false
  })
);

// Google OAuth callback. The consent cookie AND state cookie must be present and valid.
router.get('/google/callback',
  (req, res, next) => {
    if (!isConsentTokenValid(req.cookies.oauth_consent)) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=consent_required`);
    }
    // SECURITY FIX (V-05): Verify OAuth state parameter (login CSRF protection).
    // The state must be present in the query, match the httpOnly cookie, and
    // be single-use (consumed here).
    const queryState = req.query.state;
    const cookieState = req.cookies?.oauth_state;
    if (!queryState || !cookieState || queryState !== cookieState || !isOAuthStateValid(queryState)) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_oauth_state`);
    }
    // Clear the state cookie so it can't be replayed.
    res.clearCookie('oauth_state', { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: cookieSameSite() });

    req.consentAt = new Date();
    next();
  },
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=google_failed`,
    session: false
  }),
  handleOAuthSuccess
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
    if (!req.cookies || !isConsentTokenValid(req.cookies.oauth_consent)) {
      return res.status(401).json({ message: 'Consent required' });
    }

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