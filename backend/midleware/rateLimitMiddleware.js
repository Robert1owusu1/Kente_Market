// FILE LOCATION: middleware/rateLimitMiddleware.js
// DESCRIPTION: Rate limiting to prevent abuse and DDoS attacks

import rateLimit from 'express-rate-limit';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    console.log(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      message: 'Too many requests, please try again later.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Strict rate limiter for authentication routes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    console.log(`🚨 Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      message: 'Too many login attempts. Please try again in 15 minutes.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Rate limiter for file uploads
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 uploads per hour
  message: 'Too many file uploads, please try again later.',
  handler: (req, res) => {
    console.log(`⚠️ Upload rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      message: 'Too many file uploads. Please try again in an hour.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Rate limiter for order creation
export const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 orders per minute
  message: 'Too many orders created, please slow down.',
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.log(`⚠️ Order rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      message: 'Too many orders. Please wait a moment and try again.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});