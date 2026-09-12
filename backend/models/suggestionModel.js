// models/suggestionModel.js
// User suggestions surfaced to the main admin, who works through them and
// marks each one done.
import pool from '../config/db.js';

class Suggestion {
  static async create({ userId, subject, body }) {
    const [result] = await pool.execute(
      `INSERT INTO suggestions (userId, subject, body, status) VALUES (?, ?, ?, 'new')`,
      [userId, subject, body]
    );
    return this.findById(result.insertId);
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      `SELECT id, userId, subject, body, status, created_at, updated_at
       FROM suggestions WHERE id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByUser(userId) {
    const [rows] = await pool.execute(
      `SELECT id, userId, subject, body, status, created_at, updated_at
       FROM suggestions
       WHERE userId = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    );
    return rows;
  }

  static async findAll() {
    const [rows] = await pool.execute(
      `SELECT s.id, s.userId, s.subject, s.body, s.status, s.created_at, s.updated_at,
              u.firstName, u.lastName, u.email
       FROM suggestions s
       LEFT JOIN users u ON u.id = s.userId
       ORDER BY FIELD(s.status, 'new', 'in_review', 'done'), s.created_at DESC
       LIMIT 500`
    );
    return rows;
  }

  static async updateStatus(id, status) {
    await pool.execute(
      `UPDATE suggestions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );
    return this.findById(id);
  }
}

export default Suggestion;