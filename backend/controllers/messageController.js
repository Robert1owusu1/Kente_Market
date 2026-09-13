// FILE LOCATION: backend/controllers/messageController.js
// DESCRIPTION: Buyer <-> vendor messaging as a threaded conversation. The
//              vendor_messages row is the thread header (subject, parties,
//              status); every individual message — the customer's opening
//              message, the vendor's replies and the customer's follow-ups —
//              lives in message_posts so both sides can keep talking.
import pool from '../config/db.js';

const insertPost = async (messageId, sender, body) => {
  await pool.execute(
    `INSERT INTO message_posts (messageId, sender, body) VALUES (?, ?, ?)`,
    [messageId, sender, String(body).trim()]
  );
};

/** Attach each thread's ordered posts to the returned row objects. */
const attachPosts = async (rows) => {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(', ');
  const [posts] = await pool.execute(
    `SELECT id, messageId, sender, body, created_at
     FROM message_posts
     WHERE messageId IN (${placeholders})
     ORDER BY created_at ASC, id ASC`,
    ids
  );
  const byThread = new Map();
  for (const p of posts) {
    if (!byThread.has(p.messageId)) byThread.set(p.messageId, []);
    byThread.get(p.messageId).push(p);
  }
  for (const r of rows) {
    r.posts = byThread.get(r.id) || [];
  }
  return rows;
};

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
    // First message of the thread lives in message_posts too so the UI can
    // render the whole conversation from one source.
    await insertPost(result.insertId, 'customer', body);

    res.status(201).json({ message: 'Message sent to vendor', messageId: result.insertId });
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ message: 'Failed to send message' });
  }
};

// @desc    Vendor replies to a customer message
// @route   PUT /api/messages/:id/reply
// @access  Private (vendor/staff owning the thread, or admin)
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

    if (msg.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to reply to this message' });
    }

    await pool.execute(
      `UPDATE vendor_messages SET reply = ?, status = 'replied', replied_at = NOW(), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [String(reply).trim(), msgId]
    );
    await insertPost(msgId, 'vendor', reply);

    res.json({ message: 'Reply sent' });
  } catch (error) {
    console.error('Error replying to message:', error);
    res.status(500).json({ message: 'Failed to send reply' });
  }
};

// @desc    Customer replies to the vendor to keep the conversation going
// @route   PUT /api/messages/:id/customer-reply
// @access  Private (the customer who opened the thread)
export const customerReply = async (req, res) => {
  try {
    const msgId = parseInt(req.params.id);
    const { body } = req.body;
    if (!body || !String(body).trim()) {
      return res.status(400).json({ message: 'Reply is required' });
    }
    if (String(body).trim().length > 5000) {
      return res.status(400).json({ message: 'Reply must be 5000 characters or less' });
    }

    const [[msg]] = await pool.execute(
      `SELECT id, customerId, status FROM vendor_messages WHERE id = ?`,
      [msgId]
    );
    if (!msg) return res.status(404).json({ message: 'Message not found' });

    // Only the customer who opened the thread may follow up.
    if (String(msg.customerId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Not authorized to reply to this message' });
    }
    if (msg.status === 'closed') {
      return res.status(400).json({ message: 'This conversation is closed' });
    }

    await insertPost(msgId, 'customer', body);
    await pool.execute(
      `UPDATE vendor_messages SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [msgId]
    );

    res.json({ message: 'Reply sent' });
  } catch (error) {
    console.error('Error with customer reply:', error);
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
    res.json(await attachPosts(rows));
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
    res.json(await attachPosts(rows));
  } catch (error) {
    console.error('Error fetching customer messages:', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
};

// @desc    Find the existing thread between this customer and a vendor
//          (optionally about a specific product/order) so the UI never spawns
//          duplicate conversations from share/ask links.
// @route   GET /api/messages/thread?vendorId=&productId=&orderId=
// @access  Private (the customer)
export const findThread = async (req, res) => {
  try {
    const vendorId = req.query.vendorId ? parseInt(req.query.vendorId) : null;
    const productId = req.query.productId ? parseInt(req.query.productId) : null;
    const orderId = req.query.orderId ? parseInt(req.query.orderId) : null;

    if (!vendorId) return res.status(400).json({ message: 'vendorId is required' });

    let sql = `
      SELECT m.id, m.subject, m.body, m.reply, m.status, m.created_at, m.replied_at,
             m.vendorId, m.productId, m.orderId,
             v.businessName, v.slug, v.logo,
             p.title AS productTitle
      FROM vendor_messages m
      LEFT JOIN vendors v ON v.userId = m.vendorId
      LEFT JOIN product p ON p.id = m.productId
      WHERE m.customerId = ? AND m.vendorId = ?`;
    const params = [req.user.id, vendorId];
    if (productId) {
      sql += ` AND m.productId = ?`;
      params.push(productId);
    }
    if (orderId) {
      sql += ` AND m.orderId = ?`;
      params.push(orderId);
    }
    sql += ` ORDER BY m.created_at DESC LIMIT 1`;

    const [rows] = await pool.execute(sql, params);
    const thread = rows.length > 0 ? rows[0] : null;
    res.json({
      thread: thread ? (await attachPosts([thread]))[0] : null,
    });
  } catch (error) {
    console.error('Error finding thread:', error);
    res.status(500).json({ message: 'Failed to find thread' });
  }
};

// @desc    All buyer <-> vendor messages (admin oversight)
// @route   GET /api/messages/all
// @access  Private (admin)
export const getAllMessages = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT m.id, m.subject, m.body, m.reply, m.status, m.created_at, m.replied_at,
              m.vendorId, m.customerId, m.productId, m.orderId,
              cu.firstName AS customerFirstName, cu.lastName AS customerLastName,
              cu.email AS customerEmail,
              v.businessName, v.slug,
              p.title AS productTitle
       FROM vendor_messages m
       LEFT JOIN users cu ON cu.id = m.customerId
       LEFT JOIN vendors v ON v.userId = m.vendorId
       LEFT JOIN product p ON p.id = m.productId
       ORDER BY m.status = 'open' DESC, m.created_at DESC
       LIMIT 500`
    );
    res.json(await attachPosts(rows));
  } catch (error) {
    console.error('Error fetching all messages:', error);
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
    await pool.execute(`UPDATE vendor_messages SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [msgId]);
    res.json({ message: 'Message closed' });
  } catch (error) {
    console.error('Error closing message:', error);
    res.status(500).json({ message: 'Failed to close message' });
  }
};