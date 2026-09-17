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
import { cookieSameSite } from '../config/cookieConfig.js';
import { setCsrfCookie } from '../middleware/csrfMiddleware.js';

const VALID_PERMISSIONS = [
  'manage_orders',
  'view_customers',
  'manage_inventory',
  'view_earnings',
  'manage_products',
  'manage_coupons',
  'reply_reviews',
  'manage_staff',
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

// Issue a staff JWT in an HTTP-only cookie so staff can use the vendor panel.
const setStaffCookie = (res, staffId, vendorId) => {
  const token = jwt.sign(
    { id: staffId, vendorId, role: 'vendor_staff' },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const staff = rows[0];

    if (staff.status !== 'active') {
      return res.status(403).json({ message: 'Staff account is deactivated' });
    }
    if (staff.vendorStatus !== 'approved') {
      return res.status(403).json({ message: 'This vendor store is not active' });
    }

    const passwordOk = await bcrypt.compare(password, staff.password);
    if (!passwordOk) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    setStaffCookie(res, staff.id, staff.vendorId);
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

// @desc    Create a staff account
// @route   POST /api/vendors/staff
// @access  Private (vendor owner)
export const createStaff = async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'A valid email is required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const vendor = await Vendor.findByUserId(req.user.id);
    if (!vendor || vendor.status !== 'approved') {
      return res.status(403).json({ message: 'Approved vendor account required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
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
      `SELECT id, vendorId, password FROM vendor_staff WHERE id = ?`,
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
      }
      sets.push('password = ?'); vals.push(await bcrypt.hash(password, 10));
    }
    if (permissions !== undefined) {
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