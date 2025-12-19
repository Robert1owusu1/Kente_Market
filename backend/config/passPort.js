// config/passport.js
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import pool from './db.js';
import jwt from 'jsonwebtoken';

// Helper: Find or create user from OAuth profile
const findOrCreateOAuthUser = async (provider, profile) => {
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
      console.log(`✅ Found existing user by ${provider}Id`);
      return existingByProvider[0];
    }
    
    // 2. Check if user exists by email (link accounts)
    if (email) {
      const [existingByEmail] = await connection.execute(
        'SELECT * FROM users WHERE email = ?',
        [email]
      );
      
      if (existingByEmail.length > 0) {
        // Link OAuth provider to existing account
        await connection.execute(
          `UPDATE users SET ${providerId} = ?, isEmailVerified = 1 WHERE id = ?`,
          [profile.id, existingByEmail[0].id]
        );
        console.log(`✅ Linked ${provider} to existing account`);
        return { ...existingByEmail[0], [providerId]: profile.id, isEmailVerified: 1 };
      }
    }
    
    // 3. Create new user
    const firstName = profile.name?.givenName || profile.displayName?.split(' ')[0] || 'User';
    const lastName = profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';
    const profilePicture = profile.photos?.[0]?.value || null;
    
    const [result] = await connection.execute(
      `INSERT INTO users (firstName, lastName, email, ${providerId}, password, isEmailVerified, profileImage, role, isActive)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'customer', 1)`,
      [firstName, lastName, email || `${provider}_${profile.id}@oauth.local`, profile.id, 'OAUTH_NO_PASSWORD', profilePicture]
    );
    
    console.log(`✅ Created new user via ${provider} OAuth`);
    
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
export const generateToken = (user) => {
  return jwt.sign(
    { userId: user.id, role: user.role },
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
      scope: ['profile', 'email']
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateOAuthUser('google', profile);
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