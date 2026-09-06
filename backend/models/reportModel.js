import pool from "../config/db.js";

class ReviewReport {
  static async create({ reviewId, userId, reason }) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `INSERT INTO review_reports (reviewId, userId, reason, status)
         VALUES (?, ?, ?, 'pending')`,
        [
          parseInt(reviewId),
          parseInt(userId),
          reason,
        ]
      );

      const [rows] = await connection.execute(
        "SELECT * FROM review_reports WHERE id = ?",
        [result.insertId]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (ReviewReport.create):", err.message);
      throw new Error(`Error creating review report: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findAll() {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(
        `SELECT rr.*, r.comment AS reviewComment, r.rating AS reviewRating,
                u.firstName, u.lastName, u.email
         FROM review_reports rr
         LEFT JOIN reviews r ON r.id = rr.reviewId
         LEFT JOIN users u ON u.id = rr.userId
         ORDER BY rr.created_at DESC`
      );
      return rows;
    } catch (err) {
      console.error("DB Error (ReviewReport.findAll):", err.message);
      throw new Error(`Error fetching review reports: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findByReview(reviewId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        `SELECT rr.*, u.firstName, u.lastName, u.email
         FROM review_reports rr
         LEFT JOIN users u ON u.id = rr.userId
         WHERE rr.reviewId = ?
         ORDER BY rr.created_at DESC`,
        [parseInt(reviewId)]
      );
      return rows;
    } catch (err) {
      console.error("DB Error (ReviewReport.findByReview):", err.message);
      throw new Error(`Error fetching review reports: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findByUserAndReview(reviewId, userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        "SELECT * FROM review_reports WHERE reviewId = ? AND userId = ?",
        [parseInt(reviewId), parseInt(userId)]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (ReviewReport.findByUserAndReview):", err.message);
      throw new Error(`Error checking review report: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async updateStatus(id, status) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [result] = await connection.execute(
        "UPDATE review_reports SET status = ? WHERE id = ?",
        [status, parseInt(id)]
      );

      if (result.affectedRows === 0) {
        throw new Error("Review report not found");
      }

      const [rows] = await connection.execute(
        "SELECT * FROM review_reports WHERE id = ?",
        [parseInt(id)]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (ReviewReport.updateStatus):", err.message);
      throw new Error(`Error updating review report: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default ReviewReport;
