// models/vendorModel.js
import pool from '../config/db.js';

class Vendor {
  constructor(data) {
    this.id = data.id;
    this.userId = data.userId;
    this.businessName = data.businessName;
    this.contactPhone = data.contactPhone;
    this.bankName = data.bankName;
    this.accountNumber = data.accountNumber;
    this.bankCode = data.bankCode;
    this.recipientCode = data.recipientCode;
    this.platformFeeRate = parseFloat(data.platformFeeRate) || 0.1;
    this.status = data.status;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    // Joined user info
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.email = data.email;
  }

  static async findByUserId(userId) {
    const [rows] = await pool.execute(
      `SELECT v.*, u.firstName, u.lastName, u.email
       FROM vendors v
       JOIN users u ON u.id = v.userId
       WHERE v.userId = ?`,
      [userId]
    );
    return rows.length > 0 ? new Vendor(rows[0]) : null;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      `SELECT v.*, u.firstName, u.lastName, u.email
       FROM vendors v
       JOIN users u ON u.id = v.userId
       WHERE v.id = ?`,
      [id]
    );
    return rows.length > 0 ? new Vendor(rows[0]) : null;
  }

  static async findAll(options = {}) {
    const { status = null, search = null } = options;
    const conditions = [];
    const params = [];
    if (status) {
      conditions.push('v.status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('(v.businessName LIKE ? OR u.firstName LIKE ? OR u.lastName LIKE ? OR u.email LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT v.*, u.firstName, u.lastName, u.email
       FROM vendors v
       JOIN users u ON u.id = v.userId
       ${whereClause}
       ORDER BY v.created_at DESC`,
      params
    );
    return rows.map((r) => new Vendor(r));
  }

  static async create(data) {
    const fields = [
      'userId', 'businessName', 'contactPhone', 'bankName',
      'accountNumber', 'bankCode', 'recipientCode', 'platformFeeRate', 'status'
    ];
    const cols = [];
    const placeholders = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined && data[f] !== null) {
        cols.push(f);
        placeholders.push('?');
        values.push(data[f]);
      }
    }
    if (cols.length === 0) throw new Error('No vendor fields provided');

    const [result] = await pool.execute(
      `INSERT INTO vendors (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values
    );
    return Vendor.findById(result.insertId);
  }

  static async update(id, data) {
    const fields = [
      'businessName', 'contactPhone', 'bankName', 'accountNumber',
      'bankCode', 'recipientCode', 'platformFeeRate', 'status'
    ];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined && data[f] !== null) {
        sets.push(`${f} = ?`);
        values.push(data[f]);
      }
    }
    if (sets.length === 0) throw new Error('No vendor fields to update');
    values.push(id);
    await pool.execute(
      `UPDATE vendors SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return Vendor.findById(id);
  }

  /**
   * Escrow summary for a vendor: pending (held) and released payouts.
   */
  static async getEscrowSummary(vendorUserId) {
    const [rows] = await pool.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN ea.status = 'held' THEN ea.payoutAmount END), 0) AS pendingPayout,
         COALESCE(SUM(CASE WHEN ea.status IN ('releasing', 'released') THEN ea.payoutAmount END), 0) AS releasedPayout,
         COALESCE(SUM(CASE WHEN ea.status = 'held' THEN ea.platformFee END), 0) AS pendingFee,
         COALESCE(SUM(CASE WHEN ea.status = 'failed' THEN 1 ELSE 0 END), 0) AS failedCount
       FROM escrow_allocations ea
       WHERE ea.vendorId = ?`,
      [vendorUserId]
    );
    return rows[0] || {};
  }

  /**
   * Payout history (allocations + order refs) for a vendor.
   */
  static async getPayoutHistory(vendorUserId) {
    const [rows] = await pool.execute(
      `SELECT ea.*, o.orderNumber, o.created_at AS orderPlacedAt
       FROM escrow_allocations ea
       JOIN orders o ON o.id = ea.orderId
       WHERE ea.vendorId = ?
       ORDER BY ea.updated_at DESC
       LIMIT 200`,
      [vendorUserId]
    );
    return rows.map((r) => ({
      ...r,
      platformFeeRate: parseFloat(r.platformFeeRate) || 0,
      platformFee: parseFloat(r.platformFee) || 0,
      payoutAmount: parseFloat(r.payoutAmount) || 0,
      amount: parseFloat(r.amount) || 0,
    }));
  }
}

export default Vendor;