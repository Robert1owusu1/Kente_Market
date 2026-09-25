import pool from '../config/db.js';
import BuybackRequest from '../models/buybackModel.js';
import Notification from '../models/notificationModel.js';

// A customer may only sell back items from their own delivered + paid orders.
const findEligibleOrderItem = async (userId, orderId, productId) => {
  const [orders] = await pool.execute(
    `SELECT id, items, orderStatus, paymentStatus FROM orders WHERE id = ? AND userId = ?`,
    [parseInt(orderId), parseInt(userId)]
  );
  const order = orders[0];
  if (!order) return { error: 'Order not found' };
  if (order.orderStatus !== 'delivered') return { error: 'Only delivered orders can be sold back' };
  if (order.paymentStatus !== 'paid') return { error: 'Only paid orders can be sold back' };

  // The driver often parses JSON columns already — only stringify when needed.
  let items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0 && typeof order.items === 'string') {
    try { items = JSON.parse(order.items || '[]'); } catch { items = []; }
  }
  const line = items.find((it) =>
    parseInt(it.product || it.productId || it.id || 0) === parseInt(productId)
  );
  if (!line) return { error: 'That item is not part of this order' };
  const qty = parseInt(line.quantity || line.qty || 1);
  return { order, line, qty };
};

// @desc    Create a sell-back request for a delivered order item
// @route   POST /api/orders/:orderId/buyback
// @access  Private (customer who owns the order)
export const createBuybackRequest = async (req, res) => {
  try {
    const { productId, quantity, conditionNote, expectedPrice } = req.body;
    const { orderId } = req.params;
    if (!productId) return res.status(400).json({ message: 'Product is required' });

    const { error, order, line, qty } = await findEligibleOrderItem(req.user.id, orderId, productId);
    if (error) return res.status(400).json({ message: error });
    const wanted = parseInt(quantity) || qty;
    if (wanted < 1 || wanted > qty) {
      return res.status(400).json({ message: `Quantity must be between 1 and ${qty}` });
    }

    const existing = await pool.execute(
      `SELECT id FROM buyback_requests
       WHERE customerId = ? AND orderId = ? AND productId = ? AND status = 'pending'`,
      [req.user.id, parseInt(orderId), parseInt(productId)]
    );
    if (existing[0].length > 0) {
      return res.status(409).json({ message: 'You already have a pending sell-back request for this item' });
    }

    const request = await BuybackRequest.create({
      customerId: req.user.id,
      orderId: parseInt(orderId),
      productId: parseInt(productId),
      quantity: wanted,
      conditionNote,
      expectedPrice,
    });

    // Keep the platform's attention on the request.
    try {
      const [admins] = await pool.execute(
        `SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 5`
      );
      for (const admin of admins) {
        await Notification.create({
          userId: admin.id,
          type: 'buyback',
          title: `Sell-back request #${request?.id ?? ''}`,
          message: `Order ${order?.orderNumber || ''} — ${wanted} × ${line?.title || productId}. Expected ≈ GHS ${expectedPrice ? parseFloat(expectedPrice).toFixed(2) : '—'}.`,
          link: '/admin/buyback',
        });
      }
    } catch {
      /* non-fatal */
    }

    res.status(201).json({ message: 'Sell-back request sent. The marketplace will review it.', request });
  } catch (error) {
    console.error('❌ createBuybackRequest error:', error.message);
    res.status(500).json({ message: 'Failed to create sell-back request' });
  }
};

// @desc    List the caller's sell-back requests
// @route   GET /api/orders/buyback
// @access  Private
export const getMyBuybackRequests = async (req, res) => {
  try {
    const requests = await BuybackRequest.findByCustomer(req.user.id);
    res.json({ requests });
  } catch (error) {
    console.error('❌ getMyBuybackRequests error:', error.message);
    res.status(500).json({ message: 'Failed to load sell-back requests' });
  }
};

// @desc    Admin: list all buy-back requests (pending first)
// @route   GET /api/admin/buyback
// @access  Private (admin)
export const listBuybackRequests = async (req, res) => {
  try {
    const { status, showDeclined } = req.query;
    const requests = await BuybackRequest.findAll({
      status: status || 'pending',
      showDeclined: showDeclined === undefined ? undefined : showDeclined === 'true',
    });
    res.json({ requests });
  } catch (error) {
    console.error('❌ listBuybackRequests error:', error.message);
    res.status(500).json({ message: 'Failed to load sell-back requests' });
  }
};

// @desc    Admin: approve (with offer) or decline a sell-back request.
//          Approval restores product stock so the cloth re-enters circulation.
// @route   PUT /api/admin/buyback/:id
// @access  Private (admin)
export const reviewBuybackRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, buybackPrice, adminNote } = req.body;

    const request = await BuybackRequest.findById(id);
    if (!request) return res.status(404).json({ message: 'Sell-back request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ message: `This request was already ${request.status}` });
    }

    if (decision === 'approved') {
      const price = parseFloat(buybackPrice);
      if (!(price >= 0)) return res.status(400).json({ message: 'A buy-back price is required' });

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // Conditional claim: approval must transition from 'pending' in the
        // same statement that writes the decision, so two racing admin
        // approvals can never both restore stock for one physical item.
        const [claimed] = await connection.execute(
          `UPDATE buyback_requests SET status = 'approved', buybackPrice = ?, adminNote = ?
           WHERE id = ? AND status = 'pending'`,
          [price, adminNote ? String(adminNote).trim() : null, parseInt(id)]
        );
        if (claimed.affectedRows !== 1) {
          await connection.rollback();
          return res.status(409).json({ message: 'This request was already reviewed' });
        }
        await connection.execute(
          `UPDATE product SET stock = stock + ? WHERE id = ?`,
          [parseInt(request.quantity) || 1, parseInt(request.productId)]
        );
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      try {
        await Notification.create({
          userId: request.customerId,
          type: 'buyback',
          title: `Sell-back approved — ${request.productTitle || 'item'}`,
          message: `The marketplace will buy it back for GHS ${price.toFixed(2)}. Ship it back and your balance will be credited.`,
          link: '/buyback',
        });
      } catch { /* non-fatal */ }

      const updated = await BuybackRequest.findById(id);
      return res.json({ message: 'Sell-back approved and product restocked.', request: updated });
    }

    if (decision === 'declined') {
      // Same conditional claim as approval: a decline racing an approval must
      // not overwrite 'approved' (the approval already restored stock).
      const [declined] = await pool.execute(
        `UPDATE buyback_requests SET status = 'declined', adminNote = ?
         WHERE id = ? AND status = 'pending'`,
        [adminNote ? String(adminNote).trim() : null, parseInt(id)]
      );
      if (declined.affectedRows !== 1) {
        return res.status(409).json({ message: 'This request was already reviewed' });
      }
      const updated = await BuybackRequest.findById(id);
      try {
        await Notification.create({
          userId: request.customerId,
          type: 'buyback',
          title: `Sell-back request #${id} declined`,
          message: adminNote
            ? `The marketplace passed on this piece. Note: "${String(adminNote).trim().slice(0, 300)}"`
            : "The marketplace couldn't offer on this piece, but you're free to sell or gift it.",
          link: '/buyback',
        });
      } catch { /* non-fatal */ }
      return res.json({ message: 'Sell-back request declined.', request: updated });
    }

    res.status(400).json({ message: 'Decision must be "approved" or "declined"' });
  } catch (error) {
    console.error('❌ reviewBuybackRequest error:', error.message);
    res.status(500).json({ message: 'Failed to review sell-back request' });
  }
};