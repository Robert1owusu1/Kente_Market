import pool from '../config/db.js';

const BuybackRequest = {
  async create({ customerId, orderId, productId, quantity = 1, conditionNote = null, expectedPrice = null }) {
    const [result] = await pool.execute(
      `INSERT INTO buyback_requests (customerId, orderId, productId, quantity, conditionNote, expectedPrice)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [parseInt(customerId), parseInt(orderId), parseInt(productId), parseInt(quantity) || 1,
        conditionNote ? String(conditionNote).trim().slice(0, 500) : null,
        expectedPrice != null ? parseFloat(expectedPrice) : null]
    );
    return this.findById(result.insertId);
  },

  async findById(id) {
    const [rows] = await pool.execute(
      `SELECT br.*, o.orderNumber,
              p.title AS productTitle, p.img AS productImage, p.price AS productPrice,
              u.firstName, u.lastName, u.email
       FROM buyback_requests br
       JOIN orders o ON o.id = br.orderId
       LEFT JOIN product p ON p.id = br.productId
       LEFT JOIN users u ON u.id = br.customerId
       WHERE br.id = ?`,
      [parseInt(id)]
    );
    return rows[0] || null;
  },

  async findAll({ status, showDeclined }) {
    let sql = `
      SELECT br.*, o.orderNumber,
             p.title AS productTitle, p.img AS productImage, p.price AS productPrice,
             u.firstName, u.lastName, u.email
      FROM buyback_requests br
      JOIN orders o ON o.id = br.orderId
      LEFT JOIN product p ON p.id = br.productId
      LEFT JOIN users u ON u.id = br.customerId
      WHERE 1=1`;
    const params = [];
    if (status === 'pending') sql += ` AND br.status = 'pending'`;
    if (status === 'approved') sql += ` AND br.status = 'approved'`;
    if (status === 'declined' && showDeclined === false) sql += ` AND br.status <> 'declined'`;
    sql += ` ORDER BY br.created_at DESC`;
    const [rows] = await pool.execute(sql, params);
    return rows;
  },

  async findByCustomer(customerId, { limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, parseInt(limit) || 50));
    const [rows] = await pool.execute(
      `SELECT br.*, o.orderNumber,
              p.title AS productTitle, p.img AS productImage, p.price AS productPrice
       FROM buyback_requests br
       JOIN orders o ON o.id = br.orderId
       LEFT JOIN product p ON p.id = br.productId
       WHERE br.customerId = ?
       ORDER BY br.created_at DESC
       LIMIT ${safeLimit}`,
      [parseInt(customerId)]
    );
    return rows || [];
  },

  async update(id, fields) {
    const allowed = ['status', 'buybackPrice', 'adminNote'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(parseInt(id));
    await pool.execute(`UPDATE buyback_requests SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  },
};

export default BuybackRequest;