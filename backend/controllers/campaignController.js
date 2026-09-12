// FILE LOCATION: backend/controllers/campaignController.js
// DESCRIPTION: Admin marketing campaigns (Kente Week, Heritage Month, seasonal
//              sales). Admin picks title, discount type/value, dates, banner,
//              targeted products and vendors. Active campaigns power homepage
//              merchandising sections.
import pool from '../config/db.js';

const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'active', 'ended'];

const validStatusForDate = (status, startDate, endDate) => {
  if (status === 'draft' || status === 'ended') return status;
  const now = new Date();
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (start && now < start) return 'scheduled';
  if (end && now > end) return 'ended';
  return 'active';
};

// @desc    Create a campaign
// @route   POST /api/campaigns
// @access  Private/Admin
export const createCampaign = async (req, res) => {
  try {
    const {
      title, description, discountType, discountValue, startDate, endDate,
      bannerImage, channel, productIds, vendorIds,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }
    if (!['percentage', 'fixed'].includes(discountType)) {
      return res.status(400).json({ message: "Discount type must be 'percentage' or 'fixed'" });
    }
    const value = parseFloat(discountValue);
    if (isNaN(value) || value <= 0) {
      return res.status(400).json({ message: 'Discount value must be greater than 0' });
    }
    if (discountType === 'percentage' && value > 100) {
      return res.status(400).json({ message: 'Percentage discount cannot exceed 100' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const status = validStatusForDate('active', startDate, endDate);
      const [result] = await connection.execute(
        `INSERT INTO campaigns (title, slug, description, discountType, discountValue,
                                startDate, endDate, bannerImage, status, channel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(title).trim(),
          String(title).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200),
          description || null,
          discountType,
          value,
          startDate || null,
          endDate || null,
          bannerImage || null,
          status,
          channel || 'homepage',
        ]
      );
      const campaignId = result.insertId;

      const parsedIds = (ids) => (Array.isArray(ids) ? ids.map((x) => parseInt(x)).filter((n) => Number.isFinite(n) && n > 0) : []);

      // Only link targets that still exist. References to wiped/deleted
      // products or vendors (e.g. from a stale cached list) must not fail the
      // whole campaign creation with a foreign-key error.
      const existingByIds = async (table, column, ids) => {
        if (!ids.length) return new Set();
        const marks = ids.map(() => '?').join(', ');
        const [rows] = await connection.execute(
          `SELECT ${column} FROM ${table} WHERE ${column} IN (${marks})`,
          ids
        );
        return new Set(rows.map((r) => r[column]));
      };

      const validProductIds = await existingByIds('product', 'id', parsedIds(productIds));
      if (validProductIds.size > 0) {
        for (const pid of validProductIds) {
          await connection.execute(
            `INSERT IGNORE INTO campaign_products (campaignId, productId) VALUES (?, ?)`,
            [campaignId, pid]
          );
        }
      }
      const validVendorIds = await existingByIds('users', 'id', parsedIds(vendorIds));
      if (validVendorIds.size > 0) {
        for (const vid of validVendorIds) {
          await connection.execute(
            `INSERT IGNORE INTO campaign_vendors (campaignId, vendorId) VALUES (?, ?)`,
            [campaignId, vid]
          );
        }
      }

      await connection.commit();
      res.status(201).json({ message: 'Campaign created', campaignId });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ message: 'Failed to create campaign' });
  }
};

// @desc    List campaigns (admin sees all; public sees active only)
// @route   GET /api/campaigns
// @access  Public (only active) / Admin (all states via ?all=1)
export const listCampaigns = async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const all = isAdmin && req.query.all === '1';

    if (all) {
      const [rows] = await pool.execute(
        `SELECT c.*, COUNT(DISTINCT cp.id) AS productCount, COUNT(DISTINCT cv.id) AS vendorCount
         FROM campaigns c
         LEFT JOIN campaign_products cp ON cp.campaignId = c.id
         LEFT JOIN campaign_vendors cv ON cv.campaignId = c.id
         GROUP BY c.id
         ORDER BY c.created_at DESC
         LIMIT 200`
      );
      return res.json(rows);
    }

    const [rows] = await pool.execute(
      `SELECT c.*, COUNT(DISTINCT cp.id) AS productCount, COUNT(DISTINCT cv.id) AS vendorCount
       FROM campaigns c
       LEFT JOIN campaign_products cp ON cp.campaignId = c.id
       LEFT JOIN campaign_vendors cv ON cv.campaignId = c.id
       WHERE c.status = 'active'
         AND (c.startDate IS NULL OR c.startDate <= NOW())
         AND (c.endDate IS NULL OR c.endDate >= NOW())
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing campaigns:', error);
    res.status(500).json({ message: 'Failed to fetch campaigns' });
  }
};

// @desc    Get a single campaign with its products + vendors
// @route   GET /api/campaigns/:id
// @access  Public (active only) / Admin (all states)
export const getCampaign = async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const isAdmin = req.user && req.user.role === 'admin';

    const [[campaign]] = await pool.execute(
      `SELECT * FROM campaigns WHERE id = ?`,
      [campaignId]
    );
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    if (!isAdmin && campaign.status !== 'active') {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    const [products] = await pool.execute(
      `SELECT p.id, p.title, p.img, p.price, p.originalPrice, p.category,
              v.businessName, v.slug
       FROM campaign_products cp
       JOIN product p ON p.id = cp.productId
       LEFT JOIN vendors v ON v.userId = p.vendorId
       WHERE cp.campaignId = ? AND p.approvalStatus = 'approved'
       ORDER BY p.created_at DESC`,
      [campaignId]
    );
    const [vendors] = await pool.execute(
      `SELECT v.id, v.userId, v.slug, v.businessName, v.logo, v.verificationLevel
       FROM campaign_vendors cv
       JOIN vendors v ON v.userId = cv.vendorId
       WHERE cv.campaignId = ?`,
      [campaignId]
    );

    res.json({ campaign, products, vendors });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ message: 'Failed to fetch campaign' });
  }
};

// @desc    Update a campaign
// @route   PUT /api/campaigns/:id
// @access  Private/Admin
export const updateCampaign = async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const [[existing]] = await pool.execute(`SELECT id FROM campaigns WHERE id = ?`, [campaignId]);
    if (!existing) return res.status(404).json({ message: 'Campaign not found' });

    const allowed = [
      'title', 'description', 'discountType', 'discountValue', 'startDate',
      'endDate', 'bannerImage', 'channel', 'status',
    ];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'title') {
          sets.push('title = ?'); vals.push(String(req.body[key]).trim());
        } else if (key === 'discountValue') {
          sets.push('discountValue = ?'); vals.push(parseFloat(req.body[key]));
        } else if (key === 'status') {
          if (!CAMPAIGN_STATUSES.includes(req.body[key])) {
            return res.status(400).json({ message: 'Invalid campaign status' });
          }
          sets.push('status = ?'); vals.push(req.body[key]);
        } else {
          sets.push(`${key} = ?`); vals.push(req.body[key]);
        }
      }
    }
    if (sets.length > 0) {
      vals.push(campaignId);
      await pool.execute(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`, vals);
    }

    // Allow replacing the targeted products/vendors when supplied. Only link
    // targets that still exist so stale references never cause FK errors.
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const existingByIds = async (table, column, ids) => {
        if (!ids.length) return new Set();
        const marks = ids.map(() => '?').join(', ');
        const [rows] = await connection.execute(
          `SELECT ${column} FROM ${table} WHERE ${column} IN (${marks})`,
          ids
        );
        return new Set(rows.map((r) => r[column]));
      };
      const parsedIds = (ids) => ids.map((x) => parseInt(x)).filter((n) => Number.isFinite(n) && n > 0);
      if (Array.isArray(req.body.productIds)) {
        await connection.execute(`DELETE FROM campaign_products WHERE campaignId = ?`, [campaignId]);
        const validProductIds = await existingByIds('product', 'id', parsedIds(req.body.productIds));
        for (const pid of validProductIds) {
          await connection.execute(
            `INSERT IGNORE INTO campaign_products (campaignId, productId) VALUES (?, ?)`,
            [campaignId, pid]
          );
        }
      }
      if (Array.isArray(req.body.vendorIds)) {
        await connection.execute(`DELETE FROM campaign_vendors WHERE campaignId = ?`, [campaignId]);
        const validVendorIds = await existingByIds('users', 'id', parsedIds(req.body.vendorIds));
        for (const vid of validVendorIds) {
          await connection.execute(
            `INSERT IGNORE INTO campaign_vendors (campaignId, vendorId) VALUES (?, ?)`,
            [campaignId, vid]
          );
        }
      }
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    // Recompute status from dates if the admin set it to scheduled/active.
    const [[updated]] = await pool.execute(`SELECT * FROM campaigns WHERE id = ?`, [campaignId]);
    const autoStatus = validStatusForDate(updated.status, updated.startDate, updated.endDate);
    if (autoStatus !== updated.status) {
      await pool.execute(`UPDATE campaigns SET status = ? WHERE id = ?`, [autoStatus, campaignId]);
    }

    res.json({ message: 'Campaign updated', campaignId });
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json({ message: 'Failed to update campaign' });
  }
};

// @desc    Delete a campaign
// @route   DELETE /api/campaigns/:id
// @access  Private/Admin
export const deleteCampaign = async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const [[existing]] = await pool.execute(`SELECT id FROM campaigns WHERE id = ?`, [campaignId]);
    if (!existing) return res.status(404).json({ message: 'Campaign not found' });
    await pool.execute(`DELETE FROM campaigns WHERE id = ?`, [campaignId]);
    res.json({ message: 'Campaign deleted' });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ message: 'Failed to delete campaign' });
  }
};