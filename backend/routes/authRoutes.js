// routes/authRoutes.js
import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import { generateToken } from '../config/passPort.js';
import { cookieSameSite } from '../config/cookieConfig.js';
import { authLimiter } from '../middleware/rateLimitMiddleware.js';
import User from '../models/usersModel.js';

const router = express.Router();

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
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
      { id: user.id, purpose: 'oauth_exchange' },
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
    next();
  },
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false
  })
);

// Google OAuth callback. The consent cookie must still be present and valid.
router.get('/google/callback',
  (req, res, next) => {
    if (!isConsentTokenValid(req.cookies.oauth_consent)) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=consent_required`);
    }
    req.consentAt = new Date();
    next();
  },
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=google_failed`,
    session: false
  }),
  handleOAuthSuccess
);

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.purpose !== 'oauth_exchange') {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Not authorized' });
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

export default router;