// models/supportTicketModel.js
import pool from "../config/db.js";

class SupportTicket {
  static async create(userId, data) {
    const { subject, category, message } = data;
    const [result] = await pool.execute(
      `INSERT INTO support_tickets (userId, subject, category, message)
       VALUES (?, ?, ?, ?)`,
      [parseInt(userId), subject, category || 'general', message]
    );
    return SupportTicket.findById(userId, result.insertId);
  }

  static async findById(userId, id) {
    const [rows] = await pool.execute(
      `SELECT st.*, u.firstName, u.lastName, u.email
       FROM support_tickets st
       JOIN users u ON u.id = st.userId
       WHERE st.id = ? AND st.userId = ?`,
      [parseInt(id), parseInt(userId)]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  static async findAllByUser(userId) {
    const [rows] = await pool.execute(
      `SELECT st.*, u.firstName, u.lastName, u.email
       FROM support_tickets st
       JOIN users u ON u.id = st.userId
       WHERE st.userId = ?
       ORDER BY st.created_at DESC`,
      [parseInt(userId)]
    );
    return rows;
  }

  static async findAll() {
    const [rows] = await pool.execute(
      `SELECT st.*, u.firstName, u.lastName, u.email
       FROM support_tickets st
       JOIN users u ON u.id = st.userId
       ORDER BY st.status = 'open' DESC, st.created_at DESC`
    );
    return rows;
  }

  static async reply(id, reply) {
    await pool.execute(
      `UPDATE support_tickets
       SET reply = ?, status = 'answered', repliedAt = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reply, parseInt(id)]
    );
    const [rows] = await pool.execute(
      `SELECT st.*, u.firstName, u.lastName, u.email
       FROM support_tickets st
       JOIN users u ON u.id = st.userId
       WHERE st.id = ?`,
      [parseInt(id)]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  static async setStatus(id, status) {
    await pool.execute(
      `UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, parseInt(id)]
    );
    const [rows] = await pool.execute(
      `SELECT st.*, u.firstName, u.lastName, u.email
       FROM support_tickets st
       JOIN users u ON u.id = st.userId
       WHERE st.id = ?`,
      [parseInt(id)]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

export default SupportTicket;
