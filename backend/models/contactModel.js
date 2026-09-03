// FILE LOCATION: backend/models/contactModel.js
// DESCRIPTION: Model for contact/submission messages ("Contact Us")
import pool from "../config/db.js";

class Contact {
  // ✅ Create a new contact message
  static async create(data) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `INSERT INTO contacts (name, email, phone, subject, message)
         VALUES (?, ?, ?, ?, ?)`,
        [
          (data.name || "").trim(),
          (data.email || "").trim().toLowerCase(),
          (data.phone || "").trim() || null,
          (data.subject || "").trim() || null,
          (data.message || "").trim(),
        ]
      );

      const [rows] = await connection.execute(
        "SELECT * FROM contacts WHERE id = ?",
        [result.insertId]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Contact.create):", err.message);
      throw new Error(`Error saving contact message: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ List messages (admin)
  static async findAll(limit = 100) {
    let connection;
    try {
      connection = await pool.getConnection();
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 500));
      const [rows] = await connection.query(
        `SELECT * FROM contacts ORDER BY id DESC LIMIT ?`,
        [safeLimit]
      );
      return rows;
    } catch (err) {
      console.error("DB Error (Contact.findAll):", err.message);
      throw new Error(`Error fetching contact messages: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default Contact;
