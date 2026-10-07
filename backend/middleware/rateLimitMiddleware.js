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
//
// RED-TEAM FIX (P1): every limiter above is keyed on req.ip, and with
// TRUST_PROXY set (the shipped backend/.env sets 1) Express derives req.ip
// from X-Forwarded-For — a header any direct client controls. Proven live:
// 8 login attempts from one IP were cut off at 5 with a 429, while 8 attempts
// with a rotating X-Forwarded-For all reached the handler (401 x8). The same
// defeated passwordResetLimiter and staffAuthLimiter (whose "account+IP" key
// is still half-spoofable). So IP buckets are a speed bump, not a bound.
//
// `credentialStuffingLimiter` below is keyed on the TARGET ACCOUNT, a value
// the attacker cannot forge, and is mounted alongside (never instead of) the
// IP limiters. Credential stuffing against one account is now bounded no
// matter how many addresses the requests arrive from.
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

// Per-account rate limiter — NOT keyed on IP at all.
//
// The IP-keyed limiters above are only as trustworthy as req.ip. With
// TRUST_PROXY set (backend/.env ships 1) Express takes req.ip from
// X-Forwarded-For, which any direct client controls: measured live, 8 login
// attempts with a rotating X-Forwarded-For all reached the handler while a
// fixed IP was cut off at 5. staffAuthLimiter's `ip:email` key is likewise
// defeated by rotating the half that is the IP.
//
// Keying purely on the target account removes the spoofable half. The allowance
// is deliberately larger than the IP bucket (a shared NAT / office must not
// lock out real users) yet far below what a password guess needs. Successful
// logins do not count, so a legitimate user mistyping a few times is never
// blocked — only a sustained run against ONE account is.
export const accountAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Kept BELOW usersModel's lockout threshold (10 failed attempts) so one
  // window can never drive an account into a 1-hour lock — otherwise this
  // limiter would be the very instrument of a lockout DoS, and a caller who
  // knows a victim's email could lock them out at will. Lockout still exists
  // as the backstop for a distributed attacker spreading attempts over many
  // windows; it is now recoverable (resetPassword clears locked_until).
  max: 5,
  keyGenerator: (req) => {
    const email = (req.body?.email || req.body?.username || 'unknown')
      .toString().trim().toLowerCase();
    return `acct:${email}`;
  },
  ...redisStore('rl:acct'),
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many login attempts for this account. Please try again in 15 minutes.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

// Per-recipient limiter for OTP resends.
//
// M-1: authLimiter was mounted on POST /resend-otp with
// `skipSuccessfulRequests: true`, which is right for login — a user typing
// their real password must not spend the bucket on the attempts that WORK —
// and is exactly backwards here, because on this route a successful response
// IS the harm. express-rate-limit decrements the counter once the response
// finishes under 400, so every successful resend cancelled itself out and the
// limiter was a no-op for the only case worth bounding: unlimited emails, one
// per request, for as long as an unverified session keeps asking.
//
// That is reachable, not theoretical. Registration does not require a
// verified address, so an attacker who registers with somebody else's
// address holds a session that legitimately reaches /resend-otp (it only
// demands `protect` and `!isEmailVerified`) and can flood that inbox at the
// pace of the general 600-per-15-minute apiLimiter — roughly 600 emails per
// window off one account, each one burning sender reputation with it.
//
// Keyed on the RECIPIENT ADDRESS rather than the IP: the resource actually
// consumed is one inbox, `req.user.email` is read from the server-side record
// rather than anything in the request, and keying on it holds up under
// X-Forwarded-For rotation — the same reason accountAuthLimiter above exists
// at all. Same shape as accountRegisterLimiter (V-10c): both outcomes count,
// because a 400 and a 200 are both answers to someone asking for mail.
export const otpResendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 5 per 15 minutes is several times what a user who genuinely did not
  // receive the code will ever need, and it is per recipient — one address
  // cannot be hammered no matter how many sessions or source IPs ask.
  max: 5,
  keyGenerator: (req) => {
    const recipient = (req.user?.email || req.user?.id || 'unknown')
      .toString().trim().toLowerCase();
    return `otp-resend:${recipient}`;
  },
  ...redisStore('rl:otpresend'),
  // Deliberately ABSENT: `skipSuccessfulRequests` is what made the old
  // limiter count nothing on the requests that succeeded.
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many verification emails requested. Please try again in 15 minutes.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

// Per-account + IP rate limiter for staff login. Express-rate-limit's default
// keying is IP-only, so an attacker rotating through the platform's staff
// accounts could brute-force within one IP's allowance. Keying on email+IP
// bounds attempts per account regardless of total logins from one IP.
// NOTE: `ipKeyGenerator(req.ip)` is still spoofable via X-Forwarded-For when
// TRUST_PROXY is set, so this is mounted TOGETHER WITH accountAuthLimiter,
// which has no IP component at all.
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

// Rate limiter for public coupon validation. Codes can be as short as 3 chars
// and the validator distinguishes not-found from expired / limit-reached /
// minimum-not-met, so without this a caller can enumerate the code space and
// read back each coupon's configuration.
export const couponValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  ...redisStore('rl:coupon'),
  skipSuccessfulRequests: true,
  message: 'Too many coupon checks, please try again later.',
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many coupon checks. Please try again in 15 minutes.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
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

// Per-TARGET-ACCOUNT reset limiter. passwordResetLimiter is IP-keyed and was
// measured bypassable by rotating X-Forwarded-For; this one has no IP
// component, so one address cannot request endless reset mails for a victim
// (mail-bombing + token grinding).
export const accountResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: (req) => {
    const email = (req.body?.email || 'unknown').toString().trim().toLowerCase();
    return `acct-reset:${email}`;
  },
  ...redisStore('rl:acctreset'),
  message: 'Too many password reset attempts.',
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many reset attempts. Please try again in an hour.' });
  },
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

// Per-TARGET-EMAIL registration limiter — V-10.
//
// `registerLimiter` above is keyed on req.ip, and with TRUST_PROXY set (the
// shipped backend/.env sets 1) that half is an attacker-controlled
// X-Forwarded-For (N-9): rotating the header allowed unlimited probes before.
// Registration is the last enumeration oracle that answers "this address is
// taken" (400) vs "it is free" (201), so the bound must be keyed on the value
// being probed, not on the source.
//
// Both outcomes count (no `skipSuccessfulRequests`): a 400 and a 201 are both
// answers, and a prober must pay for the free ones too. Keying is per-email, so
// a shared NAT is unaffected — each new signup uses a key nobody else uses.
export const accountRegisterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const email = (req.body?.email || 'unknown').toString().trim().toLowerCase();
    return `acct-register:${email}`;
  },
  ...redisStore('rl:acctregister'),
  message: 'Too many registration attempts.',
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many registration attempts. Please try again later.' });
  },
});