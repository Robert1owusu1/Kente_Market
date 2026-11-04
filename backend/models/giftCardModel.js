// FILE LOCATION: backend/models/giftCardModel.js
// DESCRIPTION: Data access for gift cards (Phase 3, Step 7).
import pool from '../config/db.js';

class GiftCard {
  constructor(data) {
    this.id = data.id;
    this.code = data.code ?? null;
    this.initialAmount = Number(data.initialAmount) || 0;
    this.balance = Number(data.balance) || 0;
    this.currency = data.currency || 'GHS';
    this.status = data.status;
    this.purchaserUserId = data.purchaserUserId ?? null;
    this.recipientEmail = data.recipientEmail ?? null;
    this.message = data.message ?? null;
    this.purchaseReference = data.purchaseReference;
    this.redeemedByUserId = data.redeemedByUserId ?? null;
    this.issuedAt = data.issuedAt ?? null;
    this.redeemedAt = data.redeemedAt ?? null;
    this.created_at = data.created_at;
  }

  static async findById(id) {
    const [rows] = await pool.execute(`SELECT * FROM gift_cards WHERE id = ?`, [id]);
    return rows.length ? new GiftCard(rows[0]) : null;
  }

  static async findByCode(code) {
    const [rows] = await pool.execute(`SELECT * FROM gift_cards WHERE code = ?`, [code]);
    return rows.length ? new GiftCard(rows[0]) : null;
  }

  static async findByReference(reference) {
    const [rows] = await pool.execute(`SELECT * FROM gift_cards WHERE purchaseReference = ?`, [reference]);
    return rows.length ? new GiftCard(rows[0]) : null;
  }

  /** Cards a user has purchased (for their history). */
  static async findByPurchaser(userId) {
    const [rows] = await pool.execute(
      `SELECT * FROM gift_cards WHERE purchaserUserId = ? ORDER BY created_at DESC LIMIT 100`, [userId]
    );
    return rows.map((r) => new GiftCard(r));
  }

  /** Create a pending-payment card (code issued later, on payment). */
  static async createPending({ initialAmount, purchaserUserId, recipientEmail, message, purchaseReference, currency = 'GHS' }) {
    const [res] = await pool.execute(
      `INSERT INTO gift_cards (initialAmount, balance, currency, status, purchaserUserId, recipientEmail, message, purchaseReference)
       VALUES (?, ?, ?, 'pending_payment', ?, ?, ?, ?)`,
      [initialAmount, initialAmount, currency, purchaserUserId, recipientEmail, message, purchaseReference]
    );
    return GiftCard.findById(res.insertId);
  }
}

export default GiftCard;
