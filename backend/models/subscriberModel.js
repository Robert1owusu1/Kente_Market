// FILE LOCATION: backend/models/subscriberModel.js
// DESCRIPTION: Model for newsletter subscribers ("Get Notified About New Kente Collections")
import pool from "../config/db.js";

class Subscriber {
  // ✅ Create/upsert a subscriber by email
  static async create(email) {
    let connection;
    try {
      connection = await pool.getConnection();

      const cleanEmail = (email || "").trim().toLowerCase();

      // Upsert: if the email already exists, just reactivate/keep it subscribed.
      await connection.execute(
        `INSERT INTO subscribers (email)
         VALUES (?)
         ON DUPLICATE KEY UPDATE
           subscribed = 1,
           updated_at = CURRENT_TIMESTAMP`,
        [cleanEmail]
      );

      const [rows] = await connection.execute(
        "SELECT * FROM subscribers WHERE email = ?",
        [cleanEmail]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Subscriber.create):", err.message);
      throw new Error(`Error saving subscriber: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ Unsubscribe
  static async unsubscribe(email) {
    let connection;
    try {
      connection = await pool.getConnection();
      const cleanEmail = (email || "").trim().toLowerCase();
      const [result] = await connection.execute(
        "UPDATE subscribers SET subscribed = 0 WHERE email = ?",
        [cleanEmail]
      );
      return result.affectedRows > 0;
    } catch (err) {
      console.error("DB Error (Subscriber.unsubscribe):", err.message);
      throw new Error(`Error unsubscribing: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ List subscribers (admin)
  static async findAll(limit = 500) {
    let connection;
    try {
      connection = await pool.getConnection();
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 500, 1000));
      const [rows] = await connection.query(
        `SELECT * FROM subscribers WHERE subscribed = 1 ORDER BY id DESC LIMIT ?`,
        [safeLimit]
      );
      return rows;
    } catch (err) {
      console.error("DB Error (Subscriber.findAll):", err.message);
      throw new Error(`Error fetching subscribers: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default Subscriber;
