// FILE LOCATION: backend/controllers/productModerationController.js
// DESCRIPTION: Admin moderation of vendor listings. Prevents fake Kente, poor
//              descriptions, counterfeit products and misleading cultural claims
//              from reaching the public catalogue.
import pool from '../config/db.js';

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'changes_requested'];

// @desc    List products awaiting / in moderation with vendor info
// @route   GET /api/admin/moderation/products
// @access  Private/Admin
export const listProductsForModeration = async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const safeStatus = VALID_STATUSES.includes(status) ? status : 'pending';

    const [rows] = await pool.execute(
      `SELECT p.id, p.title, p.img, p.price, p.category, p.approvalStatus,
              p.approvalNote, p.stock, p.created_at,
              v.businessName, v.verificationLevel, v.location
       FROM product p
       LEFT JOIN vendors v ON v.userId = p.vendorId
       WHERE p.approvalStatus = ?
       ORDER BY p.created_at ASC
       LIMIT 500`,
      [safeStatus]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing products for moderation:', error);
    res.status(500).json({ message: 'Failed to list products for moderation' });
  }
};

// @desc    Approve / reject / request changes on a product
// @route   PUT /api/admin/moderation/products/:id
// @access  Private/Admin
export const moderateProduct = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { status, note } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    if ((status === 'rejected' || status === 'changes_requested') && (!note || !String(note).trim())) {
      return res.status(400).json({ message: 'A reason/note is required when rejecting or requesting changes' });
    }

    const [[existing]] = await pool.execute(
      `SELECT p.id, p.vendorId, p.approvalStatus,
              v.businessName
       FROM product p
       LEFT JOIN vendors v ON v.userId = p.vendorId
       WHERE p.id = ?`,
      [productId]
    );
    if (!existing) return res.status(404).json({ message: 'Product not found' });

    const approvedAt = status === 'approved' ? new Date() : null;
    await pool.execute(
      `UPDATE product
       SET approvalStatus = ?, approvalNote = ?, approvedAt = ?
       WHERE id = ?`,
      [status, note || null, approvedAt, productId]
    );

    // Notify the vendor about the moderation outcome.
    if (existing.vendorId) {
      const titles = {
        approved: 'Product approved',
        rejected: 'Product rejected',
        changes_requested: 'Changes requested for your product',
        pending: 'Product back in review',
      };
      const texts = {
        approved: 'Your product has been approved and is now live on the Bonwire marketplace.',
        rejected: `Your product was not approved. ${note || ''}`,
        changes_requested: `Please review and update your product: ${note || ''}`,
        pending: 'Your product is now in the review queue.',
      };
      try {
        const Notification = (await import('../models/notificationModel.js')).default;
        await Notification.create({
          userId: existing.vendorId,
          type: 'system',
          title: titles[status],
          message: texts[status],
          link: `/vendor/products`,
        });
      } catch (notifyErr) {
        console.warn('⚠️ Could not notify vendor of moderation:', notifyErr.message);
      }
    }

    res.json({
      message: status === 'approved' ? 'Product approved and published' : `Product marked as ${status}`,
      product: { id: productId, approvalStatus: status, approvalNote: note || null },
    });

    const { auditFromRequest } = await import('../utils/auditLog.js');
    await auditFromRequest(req, {
      action: 'product.moderate',
      entityType: 'product',
      entityId: productId,
      before: { approvalStatus: existing.approvalStatus },
      after: { approvalStatus: status, note: note || null },
    });
  } catch (error) {
    console.error('Error moderating product:', error);
    res.status(500).json({ message: 'Failed to moderate product' });
  }
};

// @desc    Admin moderation stats (pending count etc.)
// @route   GET /api/admin/moderation/stats
// @access  Private/Admin
export const getModerationStats = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT approvalStatus, COUNT(*) AS count
       FROM product GROUP BY approvalStatus`
    );
    const stats = { pending: 0, approved: 0, rejected: 0, changes_requested: 0 };
    rows.forEach((r) => { stats[r.approvalStatus] = r.count; });
    res.json(stats);
  } catch (error) {
    console.error('Error fetching moderation stats:', error);
    res.status(500).json({ message: 'Failed to fetch moderation stats' });
  }
};