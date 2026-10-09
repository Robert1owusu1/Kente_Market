// middleware/authMiddleware.js - COMPLETE VERSION
import jwt from 'jsonwebtoken';
import asyncHandler from './asyncHandler.js';
import User from '../models/usersModel.js';
import pool from '../config/db.js';
import { decodeRegisterPendingToken } from '../utils/registerPendingToken.js';

// mysql2 auto-parses JSON columns to objects; tolerate both forms.
const parsePermissions = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return value;
};

/**
 * Optional auth middleware - Attach user if a valid JWT cookie exists, otherwise
 * continue anonymously. Used by anonymous-friendly endpoints (server-side cart)
 * that behave differently for logged-in vs guest visitors.
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.jwt;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (
        user && user.isActive &&
        decoded.role !== 'vendor_staff' &&
        (user.tokenVersion === undefined || decoded.tv === user.tokenVersion)
      ) {
        req.user = user.getProfile();
      }
    } catch {
      // Invalid/expired token: treat as anonymous, never block the request.
    }
  }
  next();
});

/**
 * Verification-phase authentication (V-10 residual: registration oracle).
 *
 * Mount AFTER `optionalAuth` on the three verification endpoints. Two modes,
 * and the controller must know which one it got (`req.authViaRegToken`):
 *
 *  - Session mode (login flow: an unverified user signed in and was routed
 *    to /verify-email): optionalAuth already set req.user — pass through.
 *  - Pending mode (registration flow: the reply to POST /api/users carries
 *    no session on EITHER branch any more, by design): accept the
 *    purpose-bound regToken from body or query, resolve the account from
 *    its claims, and mark the request so uniform-response rules apply.
 *
 * Neither credential → 401, exactly like `protect` did before: the
 * frontend's existing expiry handling logs the visitor out, and a pending
 * token that outlived its 15 minutes recovers by starting at register
 * again (bounded there by accountRegisterLimiter).
 */
const attachVerificationAuth = asyncHandler(async (req, res, next) => {
  if (req.user) {
    req.authViaRegToken = false;
    return next();
  }

  const pending = req.body?.regToken ?? req.query?.regToken;
  if (typeof pending === 'string' && pending.length > 0) {
    const claims = decodeRegisterPendingToken(pending);
    if (claims) {
      const user = await User.findByEmail(claims.email);
      if (user && user.isActive) {
        req.user = user.getProfile();
        req.authViaRegToken = true;
        return next();
      }
    }
  }

  res.status(401);
  throw new Error('Not authorized');
});

/**
 * Protect routes - Verify JWT token
 * Middleware to authenticate users via JWT token in cookies
 */
const protect = asyncHandler(async(req, res, next) => {
    let token;

    // Read the JWT from the cookie
    token = req.cookies.jwt;

    if (token) {
        try {
            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Explicitly reject staff tokens here. Staff and users share one
            // signing key and one cookie name, and staff ids live in the same
            // numeric space as user ids, so a staff token reaching this
            // middleware would be resolved against the USERS table. That was
            // only accidentally safe: a staff token carries no `tv` claim, so
            // the tokenVersion check below rejected it - but the separation
            // rested entirely on that one missing field. If `tv` is ever added
            // to staff tokens, or the version check is relaxed, staff_staff.id=5
            // would silently authenticate as users.id=5. `vendorOrStaff` and
            // `optionalAuth` already make this distinction explicitly.
            if (decoded.role === 'vendor_staff') {
                res.status(401);
                throw new Error('Not authorized');
            }

            // Get user from database (without password)
            const user = await User.findById(decoded.id);
            
            if (!user) {
                res.status(401);
                throw new Error('User not found');
            }

            // Check if user is active
            if (!user.isActive) {
                res.status(403);
                throw new Error('Account is deactivated');
            }

            // Session-revocation guard: every token embeds the tokenVersion in
            // effect when it was issued; password/email changes bump it, so any
            // pre-change tokens are rejected here and the user must log in again.
            if (user.tokenVersion === undefined || decoded.tv !== user.tokenVersion) {
                res.status(401);
                throw new Error('Session expired, please log in again');
            }
            
            // Attach user to request object (without password)
            req.user = user.getProfile();
            
            next();
    } catch (error) {
            console.error('Token verification error:', error);
            res.status(401);
            throw new Error('Not authorized, token failed');
        }
    } else {
        res.status(401);
        throw new Error('Not authorized, no token');
    }
});

/**
 * Email-verification gate (P0-8) — require a verified email before money moves.
 * Must be used after `protect`/`vendorOrStaff`. Admins bypass so operations
 * can always place manual/admin orders. Accepts 1/true/'1' (MySQL returns 0/1).
 */
const requireVerifiedEmail = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    const verified = req.user && (req.user.isEmailVerified === true || req.user.isEmailVerified === 1 || req.user.isEmailVerified === '1');
    if (verified) {
        return next();
    }
    res.status(403);
    throw new Error('Please verify your email before placing an order');
};

/**
 * Admin middleware - Check if user is admin
 * Must be used after protect middleware
 */
const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403);
        throw new Error('Not authorized as an admin');
    }
};

/**
 * C5 — the STORE, not the TOKEN, decides whether an account may act as a vendor.
 *
 * `vendor` and `vendorOrStaff` both checked only `users.role`, and `applyVendor`
 * sets role='vendor' in the SAME request that creates the store with
 * status='pending'. So one second after submitting an application — long before
 * any administrator has seen it — the applicant could call every vendor
 * endpoint: publish products, mint staff accounts through POST /api/vendors/staff,
 * create coupons, advance order fulfilment, withdraw a balance.
 *
 * The staff branch of `vendorOrStaff` already enforced
 * `staff.vendorStatus !== 'approved'`. The owner branch never consulted
 * `vendors.status` at all: the middleware enforced the invariant for the
 * employee and not for their employer.
 *
 * `status` is the VENDORS enum ('pending' | 'approved' | 'suspended'). It is
 * deliberately not `approvalStatus`, which is the PRODUCT moderation column —
 * reading the wrong one is how the sibling productModel finding got shipped.
 *
 * Exactly one exemption, and only one:
 *   GET /api/vendors/me
 * VendorDashboard renders entirely off that response (it is the dashboard's
 * entry point, and VendorSettings/VendorPayouts read `vendor.status` from it),
 * so blocking it would leave a pending applicant with no way to discover that
 * they are pending — the very state the endpoint exists to report. It returns
 * only their own row and passes the status through verbatim; every other
 * dashboard section now fails with 403 until the store is approved, which is
 * the point.
 */
const APPLICATION_STATUS_PATH = '/api/vendors/me';

const isOwnApplicationStatusRead = (req) =>
    req.method === 'GET' && req.originalUrl.split('?')[0] === APPLICATION_STATUS_PATH;

/**
 * Resolve `vendors.status` and enforce approval.
 * Callers must have already established `req.user` and its vendor/admin role.
 * Returns { ok: true } or { ok: false, message } — it never throws, so both
 * middlewares report the same reason.
 */
const requireApprovedStore = async (req) => {
    // An administrator is not a vendor; there is no store row to approve.
    if (req.user.role === 'admin') return { ok: true };
    if (isOwnApplicationStatusRead(req)) return { ok: true };

    const [rows] = await pool.execute(
        `SELECT status FROM vendors WHERE userId = ?`,
        [req.user.id]
    );
    // Fail closed: role='vendor' with no store row means the row was removed
    // underneath the account, and a store you cannot name is not a store you
    // may sell from.
    if (rows.length === 0) {
        return { ok: false, message: 'No vendor store exists on this account' };
    }
    const status = rows[0].status;
    if (status !== 'approved') {
        return {
            ok: false,
            message: `Your vendor store is ${status} and cannot be used until an administrator approves it`,
        };
    }
    return { ok: true };
};

/**
 * Vendor middleware - Check if user is a vendor (or admin), AND that their
 * store is approved. Must be used after protect middleware.
 */
const vendor = asyncHandler(async (req, res, next) => {
    if (!(req.user && (req.user.role === 'vendor' || req.user.role === 'admin'))) {
        res.status(403);
        throw new Error('Not authorized as a vendor');
    }
    const gate = await requireApprovedStore(req);
    if (!gate.ok) {
        res.status(403);
        throw new Error(gate.message);
    }
    next();
});

/**
 * Vendor-or-staff middleware — self-contained guard for the vendor panel.
 *
 * Accepts two token types:
 *  - A normal vendor/admin JWT (validated against the users table, role check).
 *  - A vendor_staff JWT (validated against vendor_staff + parent vendor).
 *
 * For staff tokens, req.user is set to the VENDOR so all existing vendor routes
 * run unchanged, and req.staff carries { id, name, permissions } so routes can
 * enforce granular permissions. MUST NOT be combined with `protect` (a staff
 * token has no users row).
 */
const vendorOrStaff = async (req, res, next) => {
    // Token trouble is shared by both token kinds, so settle it before the
    // branches split. Reported exactly as `protect` reports it.
    let decoded;
    try {
        const token = req.cookies.jwt;
        if (!token) throw new Error('Not authorized, no token');
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        res.status(401);
        return next(
            error.message === 'Not authorized, no token'
                ? error
                : new Error('Not authorized, token failed'),
        );
    }

    // Normal vendor/admin token.
    if (decoded.role !== 'vendor_staff') {
        // This branch used to share the catch at the bottom of this function —
        // which was written for the STAFF branch: it logs 'Staff auth error'
        // and answers 401 'Not authorized, staff token failed'. So every owner
        // failure arrived as that sentence, at a status the frontend reads as
        // session expiry (apiSlice: `response.status === 401` ->
        // handleUnauthorized). A customer who merely opened a vendor URL, a
        // deactivated account, and — since C5 — a pending applicant were each
        // logged out of the whole site and told that a staff token they never
        // presented had failed. Owner failures keep their own status and
        // message instead; `next()` sits outside the try so a synchronous
        // downstream throw is not caught here and handed to next() twice.
        try {
            const user = await User.findById(decoded.id);
            if (!user) {
                res.status(401);
                throw new Error('User not found');
            }
            if (!user.isActive) {
                res.status(403);
                throw new Error('Account is deactivated');
            }
            // Session-revocation guard (same as `protect`): password/email
            // changes bump tokenVersion, invalidating pre-change vendor tokens.
            if (user.tokenVersion === undefined || decoded.tv !== user.tokenVersion) {
                res.status(401);
                throw new Error('Session expired, please log in again');
            }
            req.user = user.getProfile();
            if (!(req.user.role === 'vendor' || req.user.role === 'admin')) {
                res.status(403);
                throw new Error('Not authorized as a vendor');
            }
            // C5: mirror the staff branch below, which already refuses a store
            // whose status !== 'approved'. Without this the owner of a pending
            // store had MORE reach than the staff they had not hired yet.
            const ownerGate = await requireApprovedStore(req);
            if (!ownerGate.ok) {
                res.status(403);
                throw new Error(ownerGate.message);
            }
        } catch (error) {
            // errorHandeler trusts the sticky res.statusCode, so whatever this
            // branch decided is what the client sees. Only a failure that got
            // this far without a status (a driver error) becomes 401.
            if (res.statusCode === 200) res.status(401);
            return next(error);
        }
        return next();
    }

    // Staff token: validate the staff record + parent vendor.
    try {
        const [staffRows] = await pool.execute(
            `SELECT s.id, s.name, s.email, s.permissions, s.status, s.tokenVersion,
                    v.userId AS vendorUserId, v.status AS vendorStatus
             FROM vendor_staff s
             JOIN vendors v ON v.userId = s.vendorId
             WHERE s.id = ? AND s.vendorId = ?`,
            [decoded.id, decoded.vendorId]
        );
        if (staffRows.length === 0) {
            res.status(401);
            throw new Error('Staff account not found');
        }
        const staff = staffRows[0];
        if (staff.status !== 'active') {
            res.status(403);
            throw new Error('Staff account is deactivated');
        }
        if (staff.vendorStatus !== 'approved') {
            res.status(403);
            throw new Error('This vendor store is not active');
        }
        // Session revocation for staff, matching the user-side tokenVersion
        // guard. Without this, changing a compromised staff password left
        // every already-issued staff JWT valid for its full 8h.
        if (staff.tokenVersion === undefined || decoded.tv !== staff.tokenVersion) {
            res.status(401);
            throw new Error('Session expired, please log in again');
        }

        req.user = {
            id: staff.vendorUserId,
            role: 'vendor',
            isActive: true,
        };
        req.staff = {
            id: staff.id,
            name: staff.name,
            email: staff.email,
            permissions: parsePermissions(staff.permissions),
        };
        next();
    } catch (error) {
        console.error('Staff auth error:', error.message);
        res.status(401);
        throw new Error('Not authorized, staff token failed');
    }
};

/**
 * Require a specific staff permission (works after vendorOrStaff).
 * For vendor owners/admins the permission is always granted.
 */
const requireVendorPermission = (permission) => (req, res, next) => {
    if (!req.user || (req.user.role !== 'vendor' && req.user.role !== 'admin')) {
        res.status(403);
        throw new Error('Not authorized');
    }
    const isOwner = req.user.role === 'vendor' && !req.staff;
    const isAdmin = req.user.role === 'admin';
    if (isOwner || isAdmin || (req.staff && req.staff.permissions[permission])) {
        return next();
    }
    res.status(403);
    throw new Error(`Missing permission: ${permission}`);
};

export { protect, admin, vendor, vendorOrStaff, requireVendorPermission, optionalAuth, requireVerifiedEmail, attachVerificationAuth };