// FILE LOCATION: backend/controllers/staffController.js
// DESCRIPTION: Vendor staff accounts with granular permissions.
//              Staff log in with their own email/password and receive a JWT
//              bound to their vendorId. Permissions gate sensitive actions
//              (earnings, payouts, settings) while order/inventory/customer
//              tasks can be delegated.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import Vendor from '../models/vendorModel.js';
import { cookieSameSite, cookieSecure } from '../config/cookieConfig.js';
import { setCsrfCookie } from '../middleware/csrfMiddleware.js';
import { burnPasswordTime } from '../utils/authTiming.js';

// A8: `manage_storefront` was missing from this list, and
// requireVendorPermission was therefore never asked for it — so
// PUT /api/vendors/profile, which rewrites the PUBLIC store page
// (business name, the /store/:slug URL, logo, cover, weaver story, social
// links), ran behind vendorOrStaff alone. Any staff member could do it,
// including one whose permission object was completely empty. The vendor's
// own account is unaffected: requireVendorPermission always passes the owner.
// `reply_reviews` was REMOVED from this list: no route anywhere consumed it
// (there is no reply endpoint — GET /api/vendors/reviews is read-only), so
// it was a checkbox that granted nothing while telling the owner it did.
// Re-add it in the same change as the endpoint that reads it.
const VALID_PERMISSIONS = [
  'manage_orders',
  'view_customers',
  'manage_inventory',
  'view_earnings',
  'manage_products',
  'manage_coupons',
  'manage_staff',
  'manage_storefront',
];

// mysql2 auto-parses JSON columns to objects; tolerate both forms.
const parsePermissions = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return value;
};

const normalizePermissions = (permissions) => {
  const out = {};
  for (const perm of VALID_PERMISSIONS) {
    out[perm] = !!(permissions && permissions[perm]);
  }
  return out;
};

// Brute-force lockout for staff, mirroring the customer policy in
// usersModel.authenticate (10 consecutive failures -> locked for 1 hour).
// Without this, staff password guessing was bounded only by an in-memory
// per-IP+email rate limiter that resets on every deploy and is per-instance.
const STAFF_MAX_FAILED = 10;
const STAFF_LOCK_MINUTES = 60;

// bcrypt cost factor used for every other password in the app. Staff accounts
// were hashed at 10, which is ~4x cheaper to crack, and they gate the vendor
// panel (earnings, payouts, bank details).
const STAFF_BCRYPT_ROUNDS = 12;

// Issue a staff JWT in an HTTP-only cookie so staff can use the vendor panel.
// `tv` embeds the staff tokenVersion so a password change invalidates every
// outstanding staff session, matching how user sessions are revoked.
const setStaffCookie = (res, staffId, vendorId, tokenVersion = 0) => {
  const token = jwt.sign(
    { id: staffId, vendorId, role: 'vendor_staff', tv: tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: cookieSecure(res.req), // N-8
    sameSite: cookieSameSite(),
    maxAge: 8 * 60 * 60 * 1000,
  });
  setCsrfCookie(res);
};

// @desc    Staff login
// @route   POST /api/vendors/staff/login
// @access  Public (staff)
export const staffLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const [rows] = await pool.execute(
      `SELECT s.*, v.businessName, v.status AS vendorStatus
       FROM vendor_staff s
       JOIN vendors v ON v.userId = s.vendorId
       WHERE s.email = ?`,
      [String(email).trim().toLowerCase()]
    );
    if (rows.length === 0) {
      // A5 twin: unknown staff email and wrong staff password are answered
      // with the SAME 401 body, so skipping the comparison here made the
      // arrival time of that 401 the only difference between them. The
      // branches below that distinguish themselves by status code (403 for a
      // deactivated staff member or an unapproved store) already reveal that
      // an account exists — deliberately, so staff are told why — and timing
      // adds nothing to a difference the body already states. This one branch
      // is where timing was the sole oracle.
      await burnPasswordTime(password);
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const staff = rows[0];

    if (staff.status !== 'active') {
      return res.status(403).json({ message: 'Staff account is deactivated' });
    }
    if (staff.vendorStatus !== 'approved') {
      return res.status(403).json({ message: 'This vendor store is not active' });
    }

    // Brute-force lockout, checked before the password comparison so a locked
    // account does not leak timing information through bcrypt.
    if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
      return res.status(423).json({
        message: 'Account temporarily locked after too many failed attempts. Try again later.',
      });
    }

    const passwordOk = await bcrypt.compare(password, staff.password);
    if (!passwordOk) {
      const attempts = (staff.failed_attempts || 0) + 1;
      const shouldLock = attempts >= STAFF_MAX_FAILED;
      await pool.execute(
        `UPDATE vendor_staff
            SET failed_attempts = ?,
                locked_until = ?,
                last_failed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [
          shouldLock ? 0 : attempts,
          shouldLock
            ? new Date(Date.now() + STAFF_LOCK_MINUTES * 60 * 1000)
            : null,
          staff.id,
        ]
      );
      if (shouldLock) {
        console.warn(
          `Staff account locked after ${STAFF_MAX_FAILED} failed attempts (staffId=${staff.id})`
        );
      }
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Successful login clears the counter and any lock.
    await pool.execute(
      `UPDATE vendor_staff
          SET failed_attempts = 0, locked_until = NULL, last_failed_at = NULL
        WHERE id = ?`,
      [staff.id]
    );

    // Opportunistically upgrade legacy cost-10 hashes now that we hold the
    // plaintext, so the stronger factor applies from the next login onward.
    if (/^\$2[aby]\$10\$/.test(staff.password || '')) {
      try {
        await pool.execute('UPDATE vendor_staff SET password = ? WHERE id = ?', [
          await bcrypt.hash(password, STAFF_BCRYPT_ROUNDS),
          staff.id,
        ]);
      } catch (err) {
        console.warn(' Could not upgrade staff bcrypt cost:', err.message);
      }
    }

    setStaffCookie(res, staff.id, staff.vendorId, staff.tokenVersion ?? 0);
    res.json({
      message: 'Staff login successful',
      staff: {
        id: staff.id,
        name: staff.name,
        vendorId: staff.vendorId,
        role: 'vendor_staff',
      },
    });
  } catch (error) {
    console.error('Error in staff login:', error);
    res.status(500).json({ message: 'Failed to log in staff account' });
  }
};

// @desc    List staff accounts for a vendor
// @route   GET /api/vendors/staff
// @access  Private (vendor owner)
export const listStaff = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, vendorId, name, email, permissions, status, created_at
       FROM vendor_staff
       WHERE vendorId = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows.map((r) => ({ ...r, permissions: parsePermissions(r.permissions) })));
  } catch (error) {
    console.error('Error listing staff:', error);
    res.status(500).json({ message: 'Failed to list staff' });
  }
};

// The grant ceiling for a STAFF caller. Owners and admins bypass it
// (requireVendorPermission already admitted them); for a staff member it
// enforces the two rules that make the wired staff routes safe:
//   1. never grant a permission the caller does not themselves hold —
//      updateStaff can reach the caller's OWN row, so without this the
//      route would be a ladder to view_earnings and beyond;
//   2. never ADD `manage_staff` — promotion to manager is an owner-only
//      decision, or one stolen manager key could mint managers forever.
//      KEEPING it on a row that already holds it is fine: a rule that
//      refused the key outright would make every ordinary edit by (or on)
//      a manager silently DEMOTE them, which is data loss, not security.
// `targetPermissions` is the row being written — null on create, where the
// row does not exist yet, so a staff caller can never seed the key.
// Returns an error message, or null when the grant is allowed.
const grantCeiling = (req, permissions, targetPermissions = null) => {
  if (!req.staff) return null;
  const requested = VALID_PERMISSIONS.filter((p) => permissions && permissions[p]);
  const escalated = requested.filter((p) => !req.staff.permissions[p]);
  if (escalated.length > 0) {
    return `You cannot grant a permission you do not hold: ${escalated.join(', ')}`;
  }
  if (permissions && permissions.manage_staff && !(targetPermissions && targetPermissions.manage_staff)) {
    return 'manage_staff can only be granted by the store owner';
  }
  return null;
};

// @desc    Create a staff account
// @route   POST /api/vendors/staff
// @access  Private (vendor owner or staff holding manage_staff)
export const createStaff = async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;

    const violation = grantCeiling(req, permissions);
    if (violation) return res.status(403).json({ message: violation });

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'A valid email is required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    } else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({
        message: 'Password must contain at least one letter and one number',
      });
    }

    const vendor = await Vendor.findByUserId(req.user.id);
    if (!vendor || vendor.status !== 'approved') {
      return res.status(403).json({ message: 'Approved vendor account required' });
    }

    const hashedPassword = await bcrypt.hash(password, STAFF_BCRYPT_ROUNDS);
    const normalized = normalizePermissions(permissions);

    const [result] = await pool.execute(
      `INSERT INTO vendor_staff (vendorId, name, email, password, permissions)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, String(name).trim(), String(email).trim().toLowerCase(), hashedPassword, JSON.stringify(normalized)]
    );

    const [[created]] = await pool.execute(
      `SELECT id, vendorId, name, email, permissions, status, created_at
       FROM vendor_staff WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json({
      message: 'Staff account created',
      staff: { ...created, permissions: parsePermissions(created.permissions) },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'A staff member with this email already exists' });
    }
    console.error('Error creating staff:', error);
    res.status(500).json({ message: 'Failed to create staff account' });
  }
};

// @desc    Update a staff account (name, permissions, password, status)
// @route   PUT /api/vendors/staff/:id
// @access  Private (vendor owner)
export const updateStaff = async (req, res) => {
  try {
    const staffId = parseInt(req.params.id);
    const [[existing]] = await pool.execute(
      `SELECT id, vendorId, password, permissions FROM vendor_staff WHERE id = ?`,
      [staffId]
    );
    if (!existing) return res.status(404).json({ message: 'Staff member not found' });
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { name, password, permissions, status } = req.body;
    const sets = [];
    const vals = [];

    if (name !== undefined) { sets.push('name = ?'); vals.push(String(name).trim()); }
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      sets.push('status = ?'); vals.push(status);
    }
    if (password !== undefined) {
      if (String(password).length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
      } else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
          message: 'Password must contain at least one letter and one number',
        });
      }
      sets.push('password = ?'); vals.push(await bcrypt.hash(password, STAFF_BCRYPT_ROUNDS));
      // Revoke outstanding staff sessions: bump tokenVersion so every JWT
      // already issued for this account stops validating. Without this, the
      // standard response to a suspected compromise (change the password) left
      // a stolen staff cookie working for the full 8h token lifetime.
      sets.push('tokenVersion = tokenVersion + 1');
      // A new password should also clear any active brute-force lock.
      sets.push('failed_attempts = 0', 'locked_until = NULL');
    }
    if (permissions !== undefined) {
      const violation = grantCeiling(req, permissions, parsePermissions(existing.permissions));
      if (violation) return res.status(403).json({ message: violation });
      sets.push('permissions = ?'); vals.push(JSON.stringify(normalizePermissions(permissions)));
    }

    if (sets.length === 0) return res.status(400).json({ message: 'No fields to update' });

    vals.push(staffId);
    await pool.execute(`UPDATE vendor_staff SET ${sets.join(', ')} WHERE id = ?`, vals);

    const [[updated]] = await pool.execute(
      `SELECT id, vendorId, name, email, permissions, status, created_at
       FROM vendor_staff WHERE id = ?`,
      [staffId]
    );
    res.json({ message: 'Staff account updated', staff: { ...updated, permissions: parsePermissions(updated.permissions) } });
  } catch (error) {
    console.error('Error updating staff:', error);
    res.status(500).json({ message: 'Failed to update staff account' });
  }
};

// @desc    Delete a staff account
// @route   DELETE /api/vendors/staff/:id
// @access  Private (vendor owner)
export const deleteStaff = async (req, res) => {
  try {
    const staffId = parseInt(req.params.id);
    const [[existing]] = await pool.execute(
      `SELECT id, vendorId FROM vendor_staff WHERE id = ?`,
      [staffId]
    );
    if (!existing) return res.status(404).json({ message: 'Staff member not found' });
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await pool.execute(`DELETE FROM vendor_staff WHERE id = ?`, [staffId]);
    res.json({ message: 'Staff account deleted' });
  } catch (error) {
    console.error('Error deleting staff:', error);
    res.status(500).json({ message: 'Failed to delete staff account' });
  }
};

export { VALID_PERMISSIONS, normalizePermissions };