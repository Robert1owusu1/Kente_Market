// utils/generateToken.js - COMPLETE VERSION WITH REMEMBER ME
import jwt from 'jsonwebtoken';

/**
 * Generate JWT token and set it as HTTP-only cookie
 * @param {object} res - Express response object
 * @param {number} userId - User ID
 * @param {boolean} rememberMe - Whether to extend token expiration (default: false)
 */
const generateToken = (res, userId, rememberMe = false) => {
  // Token expiration time
  // Remember Me: 30 days, Normal: 7 days
  const expiresIn = rememberMe ? '30d' : '7d';
  
  // Generate JWT
  const token = jwt.sign(
    { id: userId }, 
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
    sameSite: 'strict',                                // Prevents CSRF attacks
    maxAge: maxAge,                                    // Cookie expiration time
    path: '/'                                          // Cookie available for entire domain
  });

  console.log(`✅ Token generated for user ${userId} (Remember Me: ${rememberMe}, Expires: ${rememberMe ? '30 days' : '7 days'})`);
  
  return token;
};

export default generateToken;