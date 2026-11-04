// FILE LOCATION: backend/models/bulkQuoteModel.js
// DESCRIPTION: Data access for B2B bulk quote requests (Phase 3, Step 9).
import pool from '../config/db.js';

class BulkQuote {
  constructor(data) {
    this.id = data.id;
    this.buyerUserId = data.buyerUserId;
    this.vendorId = data.vendorId ?? null;
    this.productId = data.productId;
    this.quantity = Number(data.quantity) || 0;
    this.companyName = data.companyName ?? null;
    this.contactPhone = data.contactPhone ?? null;
    this.message = data.message ?? null;
    this.status = data.status;
    this.quotedUnitPrice = data.quotedUnitPrice == null ? null : Number(data.quotedUnitPrice);
    this.quoteNote = data.quoteNote ?? null;
    this.quotedBy = data.quotedBy ?? null;
    this.quotedAt = data.quotedAt ?? null;
    this.validUntil = data.validUntil ?? null;
    this.buyerRespondedAt = data.buyerRespondedAt ?? null;
    this.created_at = data.created_at;
    // Joined fields.
    this.productTitle = data.productTitle;
    this.productImg = data.productImg;
    this.buyerName = data.buyerName;
    this.buyerEmail = data.buyerEmail;
  }

  static async findById(id) {
    const [rows] = await pool.execute(`SELECT * FROM bulk_quote_requests WHERE id = ?`, [id]);
    return rows.length ? new BulkQuote(rows[0]) : null;
  }

  static async create({ buyerUserId, vendorId, productId, quantity, companyName, contactPhone, message }) {
    const [res] = await pool.execute(
      `INSERT INTO bulk_quote_requests (buyerUserId, vendorId, productId, quantity, companyName, contactPhone, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [buyerUserId, vendorId ?? null, productId, quantity, companyName ?? null, contactPhone ?? null, message ?? null]
    );
    return BulkQuote.findById(res.insertId);
  }

  static async findByBuyer(buyerUserId) {
    const [rows] = await pool.execute(
      `SELECT bq.*, p.title AS productTitle, p.img AS productImg
         FROM bulk_quote_requests bq JOIN product p ON p.id = bq.productId
        WHERE bq.buyerUserId = ? ORDER BY bq.created_at DESC LIMIT 100`,
      [buyerUserId]
    );
    return rows.map((r) => new BulkQuote(r));
  }

  /** Quotes addressed to a vendor (their products). */
  static async findByVendor(vendorId) {
    const [rows] = await pool.execute(
      `SELECT bq.*, p.title AS productTitle, p.img AS productImg,
              CONCAT(u.firstName, ' ', u.lastName) AS buyerName, u.email AS buyerEmail
         FROM bulk_quote_requests bq
         JOIN product p ON p.id = bq.productId
         JOIN users u ON u.id = bq.buyerUserId
        WHERE bq.vendorId = ? ORDER BY bq.created_at DESC LIMIT 200`,
      [vendorId]
    );
    return rows.map((r) => new BulkQuote(r));
  }

  /** Platform-product quotes (vendorId NULL) for the admin. */
  static async findForAdmin() {
    const [rows] = await pool.execute(
      `SELECT bq.*, p.title AS productTitle, p.img AS productImg,
              CONCAT(u.firstName, ' ', u.lastName) AS buyerName, u.email AS buyerEmail
         FROM bulk_quote_requests bq
         JOIN product p ON p.id = bq.productId
         JOIN users u ON u.id = bq.buyerUserId
        WHERE bq.vendorId IS NULL ORDER BY bq.created_at DESC LIMIT 200`
    );
    return rows.map((r) => new BulkQuote(r));
  }

  static async quote(id, { quotedUnitPrice, quoteNote, quotedBy, validUntil }) {
    await pool.execute(
      `UPDATE bulk_quote_requests
          SET status = 'quoted', quotedUnitPrice = ?, quoteNote = ?, quotedBy = ?, quotedAt = CURRENT_TIMESTAMP, validUntil = ?
        WHERE id = ?`,
      [quotedUnitPrice, quoteNote ?? null, quotedBy, validUntil ?? null, id]
    );
    return BulkQuote.findById(id);
  }

  static async setStatus(id, status) {
    await pool.execute(
      `UPDATE bulk_quote_requests SET status = ?, buyerRespondedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );
    return BulkQuote.findById(id);
  }
}

export default BulkQuote;
