// utils/generateToken.js - COMPLETE VERSION WITH REMEMBER ME
import jwt from 'jsonwebtoken';
import { cookieSameSite } from '../config/cookieConfig.js';

/**
 * Generate JWT token and set it as HTTP-only cookie
 * @param {object} res - Express response object
 * @param {object|number} userOrId - User record (preferred: carries .id + .tokenVersion) or user ID
 * @param {boolean} rememberMe - Whether to extend token expiration (default: false)
 */
const generateToken = (res, userOrId, rememberMe = false) => {
  const userId = typeof userOrId === 'object' && userOrId !== null ? userOrId.id : userOrId;
  // Session-revocation claim: tokens are only valid while JWT `tv` matches the
  // user's current users.tokenVersion. Password/email changes bump the version,
  // which instantly invalidates every previously issued token.
  const tv = typeof userOrId === 'object' && userOrId !== null ? (userOrId.tokenVersion ?? 0) : 0;

  // Token expiration time
  // Remember Me: 30 days, Normal: 7 days
  const expiresIn = rememberMe ? '30d' : '7d';
  
  // Generate JWT
  const token = jwt.sign(
    { id: userId, tv }, 
    process.env.JWT_SECRET,
    { expiresIn }
  );

  // Calculate cookie max age in milliseconds
  const maxAge = rememberMe 
    ? 30 * 24 * 60 * 60 * 1000  // 30 days in milliseconds
    : 7 * 24 * 60 * 60 * 1000;   // 7 days in milliseconds

  // Set JWT as HTTP-Only cookie
  res.cookie('jwt', token, {
    httpOnly: true,                                    // Prevents XSS attacks (client-side JavaScript cannot access)
    secure: process.env.NODE_ENV === 'production',    // HTTPS only in production
    sameSite: cookieSameSite(),                         // CSRF (lax default; none for cross-origin frontend)
    maxAge: maxAge,                                    // Cookie expiration time
    path: '/'                                          // Cookie available for entire domain
  });

  console.log(`✅ Token generated for user ${userId} (Remember Me: ${rememberMe}, Expires: ${rememberMe ? '30 days' : '7 days'}, tv: ${tv})`);
  
  return token;
};

export default generateToken;