// FILE LOCATION: backend/models/reviewModel.js
// DESCRIPTION: Model for product reviews (star rating + comment)
import pool from "../config/db.js";

class Review {
  // ✅ Create a review (one review per user per product; verified order
  //    reviews are keyed on orderId so a buyer can review after each order).
  static async create({ userId, productId, rating, comment, userName,
    orderId = null, vendorId = null, vendorRating = null,
    platformSuggestion = null, isVerified = 0 }) {
    let connection;
    try {
      connection = await pool.getConnection();

      const ratingNum = Math.max(1, Math.min(5, parseInt(rating) || 5));
      const commentText = (comment || "").trim().slice(0, 2000);
      const vendorRatingNum = vendorRating !== null && vendorRating !== undefined
        ? Math.max(1, Math.min(5, parseInt(vendorRating) || 5))
        : null;
      const suggestion = platformSuggestion ? String(platformSuggestion).trim().slice(0, 4000) : null;

      // Prefer the review row that matches this order; otherwise the buyer's
      // existing review for the product (keeps one row per product+order).
      const [existing] = await connection.execute(
        `SELECT id, orderId FROM reviews
         WHERE userId = ? AND productId = ?
         ORDER BY (orderId = ?) DESC, (orderId IS NOT NULL) DESC, id ASC LIMIT 1`,
        [userId, productId, orderId]
      );

      let reviewId;
      if (existing.length > 0) {
        reviewId = existing[0].id;
        await connection.execute(
          `UPDATE reviews SET
             name = ?, rating = ?, comment = ?, orderId = ?, vendorId = ?,
             vendorRating = ?, platformSuggestion = ?, isVerified = ?,
             status = 'approved', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            (userName || "Anonymous").trim().slice(0, 100),
            ratingNum,
            commentText,
            existing[0].orderId || orderId,
            vendorId,
            vendorRatingNum,
            suggestion,
            isVerified ? 1 : 0,
            reviewId,
          ]
        );
      } else {
        const [result] = await connection.execute(
          `INSERT INTO reviews (
            userId, productId, name, rating, comment, orderId, vendorId,
            vendorRating, platformSuggestion, isVerified, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
          [
            userId,
            productId,
            (userName || "Anonymous").trim().slice(0, 100),
            ratingNum,
            commentText,
            orderId,
            vendorId,
            vendorRatingNum,
            suggestion,
            isVerified ? 1 : 0,
          ]
        );
        reviewId = result.insertId;
      }

      await Review.recalculateProductStats(connection, productId);

      const [rows] = await connection.execute(
        "SELECT * FROM reviews WHERE id = ?",
        [reviewId]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Review.create):", err.message);
      throw new Error(`Error saving review: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ Reviews for a product
  static async findByProduct(productId, limit = 50) {
    let connection;
    try {
      connection = await pool.getConnection();
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 50, 200));
      const [rows] = await connection.query(
        `SELECT r.*, u.firstName, u.lastName, u.profile_picture
         FROM reviews r
         LEFT JOIN users u ON u.id = r.userId
         WHERE r.productId = ?
         ORDER BY r.created_at DESC
         LIMIT ?`,
        [parseInt(productId), safeLimit]
      );
      return rows;
    } catch (err) {
      console.error("DB Error (Review.findByProduct):", err.message);
      throw new Error(`Error fetching reviews: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ A user's review for a specific product (for the review form)
  static async findOneByUserAndProduct(userId, productId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        "SELECT * FROM reviews WHERE userId = ? AND productId = ?",
        [userId, productId]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Review.findOneByUserAndProduct):", err.message);
      throw new Error(`Error fetching review: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ All reviews across the site (for the /reviews page)
  static async findAll(limit = 100) {
    let connection;
    try {
      connection = await pool.getConnection();
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 300));
      const [rows] = await connection.query(
        `SELECT r.*, u.firstName, u.lastName, u.profile_picture, p.title AS productTitle
         FROM reviews r
         LEFT JOIN users u ON u.id = r.userId
         LEFT JOIN product p ON p.id = r.productId
         ORDER BY r.created_at DESC
         LIMIT ?`,
        [safeLimit]
      );
      return rows;
    } catch (err) {
      console.error("DB Error (Review.findAll):", err.message);
      throw new Error(`Error fetching reviews: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ Recompute the product's average rating and review count
  static async recalculateProductStats(connection, productId) {
    const [agg] = await connection.execute(
      `SELECT COALESCE(AVG(rating), 0) AS avgRating, COUNT(*) AS count
       FROM reviews WHERE productId = ?`,
      [productId]
    );
    await connection.execute(
      `UPDATE product SET rating = ?, reviews = ? WHERE id = ?`,
      [Number(agg[0].avgRating).toFixed(1), parseInt(agg[0].count), productId]
    );
  }

  // ✅ Find review by id
  static async findById(id) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute("SELECT * FROM reviews WHERE id = ?", [id]);
      return rows[0] || null;
    } catch (err) {
      throw new Error(`Error fetching review: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ Update a review
  static async update(id, fields) {
    let connection;
    try {
      connection = await pool.getConnection();
      const allowed = ['rating', 'comment'];
      const sets = [];
      const vals = [];
      for (const key of allowed) {
        if (fields[key] !== undefined) {
          sets.push(`${key} = ?`);
          vals.push(fields[key]);
        }
      }
      if (sets.length === 0) return null;
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(id);
      await connection.execute(`UPDATE reviews SET ${sets.join(', ')} WHERE id = ?`, vals);

      // Recalculate product stats
      const [[row]] = await connection.execute("SELECT productId FROM reviews WHERE id = ?", [id]);
      if (row) await Review.recalculateProductStats(connection, row.productId);

      const [[updated]] = await connection.execute("SELECT * FROM reviews WHERE id = ?", [id]);
      return updated || null;
    } catch (err) {
      throw new Error(`Error updating review: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ Delete a review
  static async delete(id) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [[row]] = await connection.execute("SELECT productId FROM reviews WHERE id = ?", [id]);
      await connection.execute("DELETE FROM reviews WHERE id = ?", [id]);
      if (row) await Review.recalculateProductStats(connection, row.productId);
    } catch (err) {
      throw new Error(`Error deleting review: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // ✅ Update review status (admin moderation)
  static async updateStatus(id, status) {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.execute("UPDATE reviews SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, id]);
    } catch (err) {
      throw new Error(`Error updating review status: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default Review;
