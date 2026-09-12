// config/passport.js
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from './db.js';
import jwt from 'jsonwebtoken';

// Helper: Find or create user from OAuth profile
const findOrCreateOAuthUser = async (provider, profile, opts = {}) => {
  const consentAt = opts?.consentAt || null;
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
        };
      }
    }
    
    // 3. Create new user
    const firstName = profile.name?.givenName || profile.displayName?.split(' ')[0] || 'User';
    const lastName = profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';
    const profilePicture = profile.photos?.[0]?.value || null;

    // Never store a plaintext placeholder password. Hash a random value so the
    // bcrypt column is valid but the account cannot be authenticated with a known password.
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 12);

    const [result] = await connection.execute(
      `INSERT INTO users (firstName, lastName, email, ${providerId}, password, is_email_verified, profileImage, role, isActive, legal_consent_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'customer', 1, ?)`,
      [firstName, lastName, email || `${provider}_${profile.id}@oauth.local`, profile.id, hashedPassword, profilePicture, consentAt]
    );
    
    console.log(`Created new user via ${provider} OAuth`);
    
    const [newUser] = await connection.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
    return newUser[0];
    
  } catch (error) {
    console.error(`❌ OAuth ${provider} error:`, error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Generate JWT token for user
// NOTE: claim MUST be `id` to match middleware/authMiddleware.js which reads decoded.id
export const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
};

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
      passReqToCallback: true
    }, async (req, accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateOAuthUser('google', profile, { consentAt: req.consentAt });
        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }));
    console.log('✅ Google OAuth configured');
  } else {
    console.log('⚠️ Google OAuth not configured (missing credentials)');
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
    console.log('✅ Facebook OAuth configured');
  } else {
    console.log('⚠️ Facebook OAuth not configured (missing credentials)');
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