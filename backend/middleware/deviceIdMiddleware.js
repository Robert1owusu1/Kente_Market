// FILE LOCATION: backend/middleware/deviceIdMiddleware.js
// DESCRIPTION: First-party, httpOnly random device id (cookie `kdid`) used only
//              as a referral anti-abuse signal (REFERRAL_SYSTEM_DESIGN.md R11):
//              a new account created on a device its referrer has used is not
//              attributed. Stored server-side only as a keyed hash. It is a
//              speed bump, not proof of identity: clearing cookies resets it.
import crypto from 'crypto';
import { cookieSameSite, cookieSecure } from '../config/cookieConfig.js';
import { DEVICE_COOKIE } from '../Services/referralService.js';

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const VALID = /^[a-f0-9]{32}$/;

export const deviceId = (req, res, next) => {
  let id = req.cookies?.[DEVICE_COOKIE];
  if (typeof id !== 'string' || !VALID.test(id)) {
    id = crypto.randomBytes(16).toString('hex');
    res.cookie(DEVICE_COOKIE, id, {
      httpOnly: true,
      secure: cookieSecure(req),
      sameSite: cookieSameSite(),
      maxAge: TWO_YEARS_MS,
      path: '/',
    });
  }
  req.deviceId = id;
  next();
};
