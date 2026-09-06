import pool from "../config/db.js";

class Notification {
  static async create({ userId, type, title, message, link }) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `INSERT INTO notifications (userId, type, title, message, link)
         VALUES (?, ?, ?, ?, ?)`,
        [
          parseInt(userId),
          type || "system",
          title,
          message,
          link || null,
        ]
      );

      const [rows] = await connection.execute(
        "SELECT * FROM notifications WHERE id = ?",
        [result.insertId]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Notification.create):", err.message);
      throw new Error(`Error creating notification: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findByUser(userId, { limit, unreadOnly } = {}) {
    let connection;
    try {
      connection = await pool.getConnection();

      let query = "SELECT * FROM notifications WHERE userId = ?";
      const params = [parseInt(userId)];

      if (unreadOnly) {
        query += " AND is_read = 0";
      }

      query += " ORDER BY created_at DESC";

      if (limit) {
        query += ` LIMIT ${Math.max(1, Math.min(parseInt(limit) || 20, 200))}`;
      }

      const [rows] = await connection.execute(query, params);
      return rows;
    } catch (err) {
      console.error("DB Error (Notification.findByUser):", err.message);
      throw new Error(`Error fetching notifications: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async markAsRead(id, userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.execute(
        "UPDATE notifications SET is_read = 1 WHERE id = ? AND userId = ?",
        [parseInt(id), parseInt(userId)]
      );
      if (result.affectedRows === 0) return null;
      const [rows] = await connection.execute(
        "SELECT * FROM notifications WHERE id = ?",
        [parseInt(id)]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Notification.markAsRead):", err.message);
      throw new Error(`Error marking notification as read: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async markAllAsRead(userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.execute(
        "UPDATE notifications SET is_read = 1 WHERE userId = ? AND is_read = 0",
        [parseInt(userId)]
      );
      return result.affectedRows;
    } catch (err) {
      console.error("DB Error (Notification.markAllAsRead):", err.message);
      throw new Error(`Error marking notifications as read: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async getUnreadCount(userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        "SELECT COUNT(*) as count FROM notifications WHERE userId = ? AND is_read = 0",
        [parseInt(userId)]
      );
      return rows[0].count;
    } catch (err) {
      console.error("DB Error (Notification.getUnreadCount):", err.message);
      throw new Error(`Error counting unread notifications: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async delete(id, userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.execute(
        "DELETE FROM notifications WHERE id = ? AND userId = ?",
        [parseInt(id), parseInt(userId)]
      );
      return result.affectedRows > 0;
    } catch (err) {
      console.error("DB Error (Notification.delete):", err.message);
      throw new Error(`Error deleting notification: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async deleteAllForUser(userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.execute(
        "DELETE FROM notifications WHERE userId = ?",
        [parseInt(userId)]
      );
      return result.affectedRows > 0;
    } catch (err) {
      console.error("DB Error (Notification.deleteAllForUser):", err.message);
      throw new Error(`Error deleting notifications: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default Notification;
