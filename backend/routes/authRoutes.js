// routes/authRoutes.js
import express from 'express';
import passport from 'passport';
import { generateToken } from '../config/passPort.js';

const router = express.Router();

// Helper: Handle OAuth callback success
const handleOAuthSuccess = (req, res) => {
  try {
    const user = req.user;
    const token = generateToken(user);
    
    // Set HTTP-only cookie (same as your regular login)
    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    
    // Build user data for frontend (exclude sensitive fields)
    const userData = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isAdmin: user.role === 'admin',
      isEmailVerified: true, // OAuth users are auto-verified
      profilePicture: user.profileImage || user.profile_picture
    };
    
    // Redirect to frontend with user data in URL (will be parsed by frontend)
    const encodedData = encodeURIComponent(JSON.stringify(userData));
    res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?user=${encodedData}&success=true`);
    
  } catch (error) {
    console.error('OAuth success handler error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
};

// Helper: Handle OAuth callback failure
const handleOAuthFailure = (provider) => (req, res) => {
  console.error(`${provider} OAuth failed`);
  res.redirect(`${process.env.FRONTEND_URL}/login?error=${provider.toLowerCase()}_failed`);
};

// ============================================
// GOOGLE OAUTH ROUTES
// ============================================

// Initiate Google OAuth
router.get('/google', 
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false 
  })
);

// Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=google_failed`,
    session: false 
  }),
  handleOAuthSuccess
);

// ============================================
// FACEBOOK OAUTH ROUTES
// ============================================

// Initiate Facebook OAuth
router.get('/facebook',
  passport.authenticate('facebook', { 
    scope: ['email', 'public_profile'],
    session: false 
  })
);

// Facebook OAuth callback
router.get('/facebook/callback',
  passport.authenticate('facebook', { 
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=facebook_failed`,
    session: false 
  }),
  handleOAuthSuccess
);

// ============================================
// APPLE OAUTH ROUTES (Placeholder)
// ============================================

// Apple Sign In requires additional setup with Apple Developer account
// and uses a different flow (Sign in with Apple JS)
router.get('/apple', (req, res) => {
  res.status(501).json({ 
    message: 'Apple Sign In not yet implemented',
    info: 'Requires Apple Developer Account and additional configuration'
  });
});

// ============================================
// OAUTH STATUS CHECK
// ============================================

router.get('/status', (req, res) => {
  res.json({
    providers: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      facebook: !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
      apple: false // Not implemented yet
    }
  });
});

export default router;