// FILE LOCATION: backend/controllers/messageController.js
// DESCRIPTION: Buyer <-> vendor enquiries kept inside the platform so customers
//              don't need to expose phone numbers. Customers open a thread on a
//              product/vendor; the vendor replies. Both sides see their threads.
import pool from '../config/db.js';

// @desc    Customer opens a message to a vendor
// @route   POST /api/messages
// @access  Private (customer)
export const createMessage = async (req, res) => {
  try {
    const { vendorId, productId, orderId, subject, body } = req.body;

    if (!vendorId || !subject || !body) {
      return res.status(400).json({ message: 'Vendor, subject and message are required' });
    }
    if (String(subject).trim().length > 255) {
      return res.status(400).json({ message: 'Subject must be 255 characters or less' });
    }
    if (String(body).trim().length > 5000) {
      return res.status(400).json({ message: 'Message must be 5000 characters or less' });
    }
    if (!Number.isInteger(parseInt(vendorId))) {
      return res.status(400).json({ message: 'Invalid vendor' });
    }

    // Vendor must be a real approved vendor.
    const [[vendor]] = await pool.execute(
      `SELECT userId FROM vendors WHERE userId = ? AND status = 'approved'`,
      [parseInt(vendorId)]
    );
    if (!vendor) {
      return res.status(400).json({ message: 'Vendor not found' });
    }
    if (parseInt(vendorId) === req.user.id) {
      return res.status(400).json({ message: 'You cannot message your own store' });
    }

    const [result] = await pool.execute(
      `INSERT INTO vendor_messages (vendorId, customerId, productId, orderId, subject, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        parseInt(vendorId),
        req.user.id,
        productId ? parseInt(productId) : null,
        orderId ? parseInt(orderId) : null,
        String(subject).trim(),
        String(body).trim(),
      ]
    );

    res.status(201).json({ message: 'Message sent to vendor', messageId: result.insertId });
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ message: 'Failed to send message' });
  }
};

// @desc    Vendor replies to a customer message
// @route   PUT /api/messages/:id/reply
// @access  Private (vendor/staff with manage_orders-ish access — vendor only for now)
export const replyToMessage = async (req, res) => {
  try {
    const msgId = parseInt(req.params.id);
    const { reply } = req.body;
    if (!reply || !String(reply).trim()) {
      return res.status(400).json({ message: 'Reply is required' });
    }
    if (String(reply).trim().length > 5000) {
      return res.status(400).json({ message: 'Reply must be 5000 characters or less' });
    }

    const [[msg]] = await pool.execute(
      `SELECT id, vendorId, status, customerId FROM vendor_messages WHERE id = ?`,
      [msgId]
    );
    if (!msg) return res.status(404).json({ message: 'Message not found' });

    // Only the owning vendor (or admin) may reply.
    const actingVendorId = req.staff ? req.user.id : req.user.id;
    if (msg.vendorId !== actingVendorId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to reply to this message' });
    }

    await pool.execute(
      `UPDATE vendor_messages SET reply = ?, status = 'replied', replied_at = NOW()
       WHERE id = ?`,
      [String(reply).trim(), msgId]
    );

    res.json({ message: 'Reply sent' });
  } catch (error) {
    console.error('Error replying to message:', error);
    res.status(500).json({ message: 'Failed to send reply' });
  }
};

// @desc    Messages received by the vendor
// @route   GET /api/vendors/messages
// @access  Private (vendor)
export const getVendorMessages = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT m.id, m.subject, m.body, m.reply, m.status, m.created_at, m.replied_at,
              m.productId, m.orderId,
              u.firstName, u.lastName, u.profile_picture,
              p.title AS productTitle
       FROM vendor_messages m
       LEFT JOIN users u ON u.id = m.customerId
       LEFT JOIN product p ON p.id = m.productId
       WHERE m.vendorId = ?
       ORDER BY m.status = 'open' DESC, m.created_at DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching vendor messages:', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
};

// @desc    Messages sent by the customer
// @route   GET /api/messages/me
// @access  Private (customer)
export const getMyMessages = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT m.id, m.subject, m.body, m.reply, m.status, m.created_at, m.replied_at,
              m.vendorId, m.productId, m.orderId,
              v.businessName, v.slug, v.logo,
              p.title AS productTitle
       FROM vendor_messages m
       LEFT JOIN vendors v ON v.userId = m.vendorId
       LEFT JOIN product p ON p.id = m.productId
       WHERE m.customerId = ?
       ORDER BY m.created_at DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching customer messages:', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
};

// @desc    Mark a vendor message as closed
// @route   PUT /api/messages/:id/close
// @access  Private (vendor)
export const closeMessage = async (req, res) => {
  try {
    const msgId = parseInt(req.params.id);
    const [[msg]] = await pool.execute(
      `SELECT id, vendorId FROM vendor_messages WHERE id = ?`,
      [msgId]
    );
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    if (msg.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await pool.execute(`UPDATE vendor_messages SET status = 'closed' WHERE id = ?`, [msgId]);
    res.json({ message: 'Message closed' });
  } catch (error) {
    console.error('Error closing message:', error);
    res.status(500).json({ message: 'Failed to close message' });
  }
};