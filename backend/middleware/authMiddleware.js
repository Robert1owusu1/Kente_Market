// middleware/authMiddleware.js - COMPLETE VERSION
import jwt from 'jsonwebtoken';
import asyncHandler from './asyncHandler.js';
import User from '../models/usersModel.js';
import pool from '../config/db.js';

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
      if (user && user.isActive) {
        req.user = user.getProfile();
      }
    } catch {
      // Invalid/expired token: treat as anonymous, never block the request.
    }
  }
  next();
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
 * Vendor middleware - Check if user is a vendor (or admin)
 * Must be used after protect middleware
 */
const vendor = (req, res, next) => {
    if (req.user && (req.user.role === 'vendor' || req.user.role === 'admin')) {
        next();
    } else {
        res.status(403);
        throw new Error('Not authorized as a vendor');
    }
};

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
    try {
        const token = req.cookies.jwt;
        if (!token) {
            res.status(401);
            throw new Error('Not authorized, no token');
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Normal vendor/admin token.
        if (decoded.role !== 'vendor_staff') {
            const user = await User.findById(decoded.id);
            if (!user) {
                res.status(401);
                throw new Error('User not found');
            }
            if (!user.isActive) {
                res.status(403);
                throw new Error('Account is deactivated');
            }
            req.user = user.getProfile();
            if (!(req.user.role === 'vendor' || req.user.role === 'admin')) {
                res.status(403);
                throw new Error('Not authorized as a vendor');
            }
            return next();
        }

        // Staff token: validate the staff record + parent vendor.
        const [staffRows] = await pool.execute(
            `SELECT s.id, s.name, s.email, s.permissions, s.status,
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

export { protect, admin, vendor, vendorOrStaff, requireVendorPermission, optionalAuth };