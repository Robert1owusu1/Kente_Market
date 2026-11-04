// FILE LOCATION: backend/controllers/featuredController.js
// DESCRIPTION: Paid featured listings API (Phase 3, Step 8).
import pool from '../config/db.js';
import Setting from '../models/settingModel.js';
import { getFeaturedConfig, startFeaturedPurchase } from '../Services/featuredListingService.js';

const userEmail = async (userId) => {
  const [[u]] = await pool.execute(`SELECT email FROM users WHERE id = ?`, [userId]);
  return u?.email || null;
};

// @desc    Featured pricing/options for the vendor UI
// @route   GET /api/vendors/featured/config
// @access  Private (vendor)
export const getVendorFeaturedConfig = async (_req, res) => {
  try {
    res.json(await getFeaturedConfig());
  } catch (error) {
    console.error('getVendorFeaturedConfig error:', error.message);
    res.status(500).json({ message: 'Failed to load featured options' });
  }
};

// @desc    Start checkout to feature a product → Paystack URL
// @route   POST /api/vendors/featured   { productId, days }
// @access  Private (vendor)
export const createFeaturedPurchase = async (req, res) => {
  try {
    const { productId, days } = req.body || {};
    if (!productId) return res.status(400).json({ message: 'productId is required' });
    const result = await startFeaturedPurchase({
      vendorUserId: req.user.id,
      vendorEmail: await userEmail(req.user.id),
      productId: Number(productId),
      days: Number(days),
    });
    res.status(201).json(result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('createFeaturedPurchase error:', error.message);
    res.status(status).json({ message: error.message || 'Failed to start featured purchase', code: error.code });
  }
};

// @desc    The vendor's featured placements
// @route   GET /api/vendors/featured
// @access  Private (vendor)
export const listMyFeatured = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT fp.id, fp.productId, p.title, fp.days, fp.amount, fp.status, fp.startsAt, fp.expiresAt, fp.created_at
         FROM featured_placements fp
         JOIN product p ON p.id = fp.productId
        WHERE fp.vendorId = ?
        ORDER BY fp.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('listMyFeatured error:', error.message);
    res.status(500).json({ message: 'Failed to load featured placements' });
  }
};

// @desc    Admin: read featured config
// @route   GET /api/admin/featured/config
// @access  Private/Admin
export const adminGetFeaturedConfig = async (_req, res) => {
  try {
    res.json(await getFeaturedConfig());
  } catch (error) {
    console.error('adminGetFeaturedConfig error:', error.message);
    res.status(500).json({ message: 'Failed to load featured config' });
  }
};

// @desc    Admin: set featured pricing / enable
// @route   PUT /api/admin/featured/config  { enabled?, pricePerDay?, maxDays? }
// @access  Private/Admin
export const adminUpdateFeaturedConfig = async (req, res) => {
  try {
    const { enabled, pricePerDay, maxDays } = req.body || {};
    if (typeof enabled === 'boolean') await Setting.update('featured.enabled', enabled, 'boolean');
    if (pricePerDay !== undefined) {
      const n = Number(pricePerDay);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: 'pricePerDay must be 0 or more' });
      await Setting.update('featured.pricePerDay', String(n), 'number');
    }
    if (maxDays !== undefined) {
      const n = Math.floor(Number(maxDays));
      if (!Number.isInteger(n) || n < 1 || n > 365) return res.status(400).json({ message: 'maxDays must be 1–365' });
      await Setting.update('featured.maxDays', String(n), 'number');
    }
    res.json(await getFeaturedConfig());
  } catch (error) {
    console.error('adminUpdateFeaturedConfig error:', error.message);
    res.status(500).json({ message: 'Failed to update featured config' });
  }
};
