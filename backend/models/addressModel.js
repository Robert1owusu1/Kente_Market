// models/addressModel.js
import pool from "../config/db.js";

class Address {
  static async create(userId, data) {
    const {
      label, fullName, phone, addressLine1, addressLine2,
      city, state, zipCode, country, isDefault,
    } = data;

    // Clear any existing default for this user if this one is marked default
    if (isDefault) {
      await pool.execute(`UPDATE user_addresses SET isDefault = 0 WHERE userId = ?`, [parseInt(userId)]);
    }

    const [result] = await pool.execute(
      `INSERT INTO user_addresses
        (userId, label, fullName, phone, addressLine1, addressLine2, city, state, zipCode, country, isDefault)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parseInt(userId),
        label || 'Home',
        fullName,
        phone,
        addressLine1,
        addressLine2 || null,
        city,
        state || null,
        zipCode || null,
        country || 'Ghana',
        isDefault ? 1 : 0,
      ]
    );

    // If this is the first address, make it the default
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS c FROM user_addresses WHERE userId = ?`,
      [parseInt(userId)]
    );
    if (parseInt(countRows[0].c) === 1) {
      await pool.execute(`UPDATE user_addresses SET isDefault = 1 WHERE id = ?`, [result.insertId]);
    }

    return Address.findById(userId, result.insertId);
  }

  static async findById(userId, id) {
    const [rows] = await pool.execute(
      `SELECT * FROM user_addresses WHERE id = ? AND userId = ?`,
      [parseInt(id), parseInt(userId)]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  static async findAllByUser(userId) {
    const [rows] = await pool.execute(
      `SELECT * FROM user_addresses WHERE userId = ? ORDER BY isDefault DESC, created_at DESC`,
      [parseInt(userId)]
    );
    return rows;
  }

  static async update(userId, id, data) {
    const current = await Address.findById(userId, id);
    if (!current) return null;

    const fields = [
      'label', 'fullName', 'phone', 'addressLine1', 'addressLine2',
      'city', 'state', 'zipCode', 'country', 'isDefault',
    ];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined && data[f] !== null) {
        sets.push(`${f} = ?`);
        values.push(data[f]);
      }
    }
    if (data.isDefault) {
      await pool.execute(`UPDATE user_addresses SET isDefault = 0 WHERE userId = ?`, [parseInt(userId)]);
      sets.push('isDefault = ?');
      values.push(1);
    }
    if (sets.length === 0) return current;

    values.push(parseInt(id), parseInt(userId));
    await pool.execute(
      `UPDATE user_addresses SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?`,
      values
    );
    return Address.findById(userId, id);
  }

  static async remove(userId, id) {
    const [result] = await pool.execute(
      `DELETE FROM user_addresses WHERE id = ? AND userId = ?`,
      [parseInt(id), parseInt(userId)]
    );
    return result.affectedRows > 0;
  }
}

export default Address;
