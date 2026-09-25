// FILE LOCATION: middleware/rateLimitMiddleware.js
// DESCRIPTION: Rate limiting to prevent abuse and DDoS attacks

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import dotenv from 'dotenv';
import { createRateLimitStore } from '../utils/redisClient.js';

// Self-contained: this module reads process.env at import time, so load .env
// here too (same pattern as config/businessConfig.js) in case an entry point
// reaches it before server.js's own dotenv.config() runs.
dotenv.config();

// Redis is optional: when REDIS_URL is set, every limiter below shares one
// durable store so limits survive restarts and work across instances. Each
// limiter gets a distinct prefix so no two limiters share keys.
const redisStore = (prefix) => {
  const store = createRateLimitStore(prefix);
  return store ? { store } : {};
};

// General API rate limiter
// The default is deliberately generous: a single SPA page view fans out to
// ~10 API calls (profile, notifications x2, cart, CSRF, banners, popups...),
// so a tight cap would 429 a normal shopping session — taking down the WHOLE
// site for that IP, since every /api route shares this bucket. Real abuse is
// caught by the targeted limiters below (auth, upload, orders, reset...).
// Override with API_RATE_LIMIT_MAX if your traffic profile differs.
const apiMax = Number(process.env.API_RATE_LIMIT_MAX);
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number.isFinite(apiMax) && apiMax >= 1 ? apiMax : 600, // per IP per windowMs
  ...redisStore('rl:api'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
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
  ...redisStore('rl:auth'),
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many login attempts. Please try again in 15 minutes.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Per-account + IP rate limiter for staff login. Express-rate-limit's default
// keying is IP-only, so an attacker rotating through the platform's staff
// accounts could brute-force within one IP's allowance. Keying on email+IP
// bounds attempts per account regardless of total logins from one IP.
export const staffAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const email = (req.body?.email || 'unknown').toString().trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}:${email}`;
  },
  ...redisStore('rl:staff'),
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many login attempts for this account. Please try again in 15 minutes.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Rate limiter for file uploads
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 uploads per hour
  ...redisStore('rl:upload'),
  message: 'Too many file uploads, please try again later.',
  handler: (req, res) => {
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
  ...redisStore('rl:orders'),
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many orders. Please wait a moment and try again.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Rate limiter for webhook endpoints (generous but prevents flooding)
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  ...redisStore('rl:webhook'),
  message: 'Too many webhook requests.',
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many webhook requests.' });
  }
});

// Rate limiter for contact form (anti-spam)
export const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  ...redisStore('rl:contact'),
  message: 'Too many contact submissions.',
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many messages. Please try again later.' });
  }
});

// Rate limiter for newsletter subscribe (anti-abuse)
export const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  ...redisStore('rl:subscribe'),
  message: 'Too many subscribe requests.',
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many requests. Please try again later.' });
  }
});

// Rate limiter for password reset (anti-enumeration)
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  ...redisStore('rl:reset'),
  message: 'Too many password reset attempts.',
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many reset attempts. Please try again in an hour.' });
  }
});

// Rate limiter for registration (anti-enumeration). Register intentionally
// returns a distinct "email already exists" message for good UX, so this
// limiter caps how fast an attacker can probe which emails are registered
// while still allowing a shared NAT to sign up several users.
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  ...redisStore('rl:register'),
  message: 'Too many registration attempts.',
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many registration attempts. Please try again later.' });
  }
});