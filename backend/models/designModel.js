// models/designModel.js
import pool from "../config/db.js";

class Design {
  static async create(userId, data) {
    const { name, description, image, config, productId } = data;
    const [result] = await pool.execute(
      `INSERT INTO designs (userId, name, description, image, config, productId)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        parseInt(userId),
        name,
        description || null,
        image || null,
        config ? JSON.stringify(config) : null,
        productId ? parseInt(productId) : null,
      ]
    );
    return Design.findById(userId, result.insertId);
  }

  static async findById(userId, id) {
    const [rows] = await pool.execute(
      `SELECT * FROM designs WHERE id = ? AND userId = ?`,
      [parseInt(id), parseInt(userId)]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  static async findAllByUser(userId) {
    const [rows] = await pool.execute(
      `SELECT * FROM designs WHERE userId = ? ORDER BY created_at DESC`,
      [parseInt(userId)]
    );
    return rows.map((r) => ({ ...r, config: r.config ? JSON.parse(r.config) : null }));
  }

  static async update(userId, id, data) {
    const current = await Design.findById(userId, id);
    if (!current) return null;
    const fields = ['name', 'description', 'image', 'config', 'productId'];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined && data[f] !== null) {
        sets.push(`${f} = ?`);
        values.push(f === 'config' ? JSON.stringify(data[f]) : f === 'productId' ? parseInt(data[f]) : data[f]);
      }
    }
    if (sets.length === 0) return current;
    values.push(parseInt(id), parseInt(userId));
    await pool.execute(
      `UPDATE designs SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?`,
      values
    );
    return Design.findById(userId, id);
  }

  static async remove(userId, id) {
    const [result] = await pool.execute(
      `DELETE FROM designs WHERE id = ? AND userId = ?`,
      [parseInt(id), parseInt(userId)]
    );
    return result.affectedRows > 0;
  }
}

export default Design;
