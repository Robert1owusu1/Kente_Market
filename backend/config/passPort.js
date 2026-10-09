// config/passport.js
import passport from 'passport';
import { TERMS_VERSION } from './legalTerms.js';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from './db.js';
import { signUserToken, SESSION_7D } from '../utils/generateToken.js';

// Helper: Find or create user from OAuth profile
const findOrCreateOAuthUser = async (provider, profile, opts = {}) => {
  const consentAt = opts?.consentAt || null;
  // RB-06: Google LOGIN must not silently create accounts. Creation is only
  // allowed on the explicit signup path (allowCreate === true). Login with an
  // unknown identity returns null so the caller fails with a generic error
  // (no existence oracle).
  const allowCreate = opts?.allowCreate === true;
  let connection;
  try {
    connection = await pool.getConnection();
    
    const providerId = `${provider}Id`; // googleId or facebookId
    const email = profile.emails?.[0]?.value?.toLowerCase();
    
    // 1. Check if user exists by provider ID
    const [existingByProvider] = await connection.execute(
      `SELECT * FROM users WHERE ${providerId} = ?`,
      [profile.id]
    );
    
    if (existingByProvider.length > 0) {
      return existingByProvider[0];
    }
    
    // 2. Check if user exists by email (link accounts)
    if (email) {
      const [existingByEmail] = await connection.execute(
        'SELECT * FROM users WHERE email = ?',
        [email]
      );

      if (existingByEmail.length > 0) {
        const existing = existingByEmail[0];

        // SECURITY: only link an OAuth identity to an email-verified account.
        // Anyone can pre-register an UNVERIFIED account with a victim's email and
        // a known password; linking the victim's OAuth login to that account would
        // let the attacker keep authenticating as them. So:
        //  - verified account  -> link normally (clean OAuth sign-in).
        //  - unverified account -> adopt + secure it: bind the OAuth id, mark the
        //    email verified (the provider already proved ownership), and rotate the
        //    password to an unknown random value so any previously-known password
        //    immediately stops working.
        if (existing.is_email_verified) {
          await connection.execute(
            `UPDATE users SET ${providerId} = ?, is_email_verified = 1,
               legal_consent_at = COALESCE(legal_consent_at, ?)
             WHERE id = ?`,
            [profile.id, consentAt, existing.id]
          );
          console.log(`Linked ${provider} to existing account`);
          return { ...existing, [providerId]: profile.id, is_email_verified: 1 };
        }

        const randomPassword = crypto.randomBytes(32).toString('hex');
        const adoptedHashedPassword = await bcrypt.hash(randomPassword, 12);
        await connection.execute(
          `UPDATE users SET ${providerId} = ?, is_email_verified = 1,
             password = ?, failed_login_attempts = 0, locked_until = NULL,
             last_failed_at = NULL,
             tokenVersion = tokenVersion + 1,
             legal_consent_at = COALESCE(legal_consent_at, ?)
           WHERE id = ?`,
          [profile.id, adoptedHashedPassword, consentAt, existing.id]
        );
        console.log(`Adopted unverified account ${existing.id} via verified ${provider} email`);
        return {
          ...existing,
          [providerId]: profile.id,
          is_email_verified: 1,
          password: adoptedHashedPassword,
          tokenVersion: (existing.tokenVersion ?? 0) + 1,
        };
      }
    }
    
    // 3. Create new user (explicit signup path only — see allowCreate above).
    if (!allowCreate) {
      return null;
    }
    const firstName = profile.name?.givenName || profile.displayName?.split(' ')[0] || 'User';
    const lastName = profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';
    const profilePicture = profile.photos?.[0]?.value || null;

    // Never store a plaintext placeholder password. Hash a random value so the
    // bcrypt column is valid but the account cannot be authenticated with a known password.
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 12);

    const [result] = await connection.execute(
      `INSERT INTO users (firstName, lastName, email, ${providerId}, password, is_email_verified, profileImage, role, isActive, legal_consent_at, terms_version)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'customer', 1, ?, ?)`,
      [firstName, lastName, email || `${provider}_${profile.id}@oauth.local`, profile.id, hashedPassword, profilePicture, consentAt, TERMS_VERSION]
    );
    
    console.log(`Created new user via ${provider} OAuth`);
    
    const [newUser] = await connection.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
    return newUser[0];
    
  } catch (error) {
 console.error(` OAuth ${provider} error:`, error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Sign a user session JWT for the OAuth flow.
//
// This used to be a second, independent implementation of what
// utils/generateToken.js already did: same name, same purpose, different
// claim set and a flat 30-day lifetime where password login defaults to 7 days.
// Any future change to session policy would have applied to one login path and
// not the other. It now delegates to the single canonical signer.
//
// NOTE: claim MUST be `id` to match middleware/authMiddleware.js which reads decoded.id.
// `tv` carries the user's tokenVersion for session revocation.
export const generateToken = (user) => signUserToken(user, SESSION_7D);

// Configure Passport strategies
export const configurePassport = () => {
  
  // ============================================
  // GOOGLE STRATEGY
  // ============================================
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.OAUTH_CALLBACK_URL}/api/auth/google/callback`,
      scope: ['profile', 'email'],
      passReqToCallback: true,
      // RB-06: do NOT use Passport's session state store. The app issues its
      // own signed state JWT (see authRoutes signOAuthState) and passes it as
      // the OAuth `state` param per-request. Enabling Passport's store here
      // would create a second, conflicting state value and break login.
      state: false
    }, async (req, accessToken, refreshToken, profile, done) => {
      try {
        const allowCreate = req?.oauthMode === 'signup';
        const user = await findOrCreateOAuthUser('google', profile, { consentAt: req.consentAt, allowCreate });
        if (!user) return done(null, false);
        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }));
 console.log(' Google OAuth configured');
  } else {
 console.log(' Google OAuth not configured (missing credentials)');
  }

  // ============================================
  // FACEBOOK STRATEGY
  // ============================================
  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: `${process.env.OAUTH_CALLBACK_URL}/api/auth/facebook/callback`,
      profileFields: ['id', 'emails', 'name', 'displayName', 'photos']
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateOAuthUser('facebook', profile);
        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }));
 console.log(' Facebook OAuth configured');
  } else {
 console.log(' Facebook OAuth not configured (missing credentials)');
  }

  // Serialize/Deserialize (for session-based auth, optional)
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
      done(null, rows[0] || null);
    } catch (error) {
      done(error, null);
    }
  });
};

export default passport;