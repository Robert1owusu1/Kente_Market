// models/paymentMethodModel.js
import pool from "../config/db.js";

class PaymentMethod {
  static async create(userId, data) {
    const {
      provider, type, cardBrand, last4, expMonth, expYear, authorizedCode, isDefault,
    } = data;

    if (isDefault) {
      await pool.execute(`UPDATE payment_methods SET isDefault = 0 WHERE userId = ?`, [parseInt(userId)]);
    }

    const [result] = await pool.execute(
      `INSERT INTO payment_methods
        (userId, provider, type, cardBrand, last4, expMonth, expYear, authorizedCode, isDefault)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parseInt(userId),
        provider || 'paystack',
        type || 'card',
        cardBrand || null,
        last4 || null,
        expMonth || null,
        expYear || null,
        authorizedCode || null,
        isDefault ? 1 : 0,
      ]
    );

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS c FROM payment_methods WHERE userId = ?`,
      [parseInt(userId)]
    );
    if (parseInt(countRows[0].c) === 1) {
      await pool.execute(`UPDATE payment_methods SET isDefault = 1 WHERE id = ?`, [result.insertId]);
    }

    return PaymentMethod.findById(userId, result.insertId);
  }

  static async findById(userId, id) {
    const [rows] = await pool.execute(
      `SELECT * FROM payment_methods WHERE id = ? AND userId = ?`,
      [parseInt(id), parseInt(userId)]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  static async findAllByUser(userId) {
    const [rows] = await pool.execute(
      `SELECT id, userId, provider, type, cardBrand, last4, expMonth, expYear, isDefault, created_at
       FROM payment_methods WHERE userId = ? ORDER BY isDefault DESC, created_at DESC`,
      [parseInt(userId)]
    );
    // Never expose authorization codes to the client
    return rows;
  }

  static async setDefault(userId, id) {
    const current = await PaymentMethod.findById(userId, id);
    if (!current) return null;
    await pool.execute(`UPDATE payment_methods SET isDefault = 0 WHERE userId = ?`, [parseInt(userId)]);
    await pool.execute(`UPDATE payment_methods SET isDefault = 1 WHERE id = ?`, [parseInt(id)]);
    return PaymentMethod.findById(userId, id);
  }

  static async remove(userId, id) {
    const [result] = await pool.execute(
      `DELETE FROM payment_methods WHERE id = ? AND userId = ?`,
      [parseInt(id), parseInt(userId)]
    );
    return result.affectedRows > 0;
  }
}

export default PaymentMethod;
