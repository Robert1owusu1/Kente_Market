import pool from "../config/db.js";

class Wishlist {
  static async add(userId, productId) {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.execute(
        `INSERT IGNORE INTO wishlist (userId, productId) VALUES (?, ?)`,
        [parseInt(userId), parseInt(productId)]
      );
      return await Wishlist.isInWishlist(userId, productId);
    } catch (err) {
      console.error("DB Error (Wishlist.add):", err.message);
      throw new Error(`Error adding to wishlist: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async remove(userId, productId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.execute(
        "DELETE FROM wishlist WHERE userId = ? AND productId = ?",
        [parseInt(userId), parseInt(productId)]
      );
      return result.affectedRows > 0;
    } catch (err) {
      console.error("DB Error (Wishlist.remove):", err.message);
      throw new Error(`Error removing from wishlist: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async getUserWishlist(userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        `SELECT w.id, w.userId, w.productId, w.created_at,
                p.title, p.img, p.price, p.originalPrice, p.rating, p.reviews, p.category
         FROM wishlist w
         LEFT JOIN product p ON p.id = w.productId
         WHERE w.userId = ?
         ORDER BY w.created_at DESC`,
        [parseInt(userId)]
      );
      return rows;
    } catch (err) {
      console.error("DB Error (Wishlist.getUserWishlist):", err.message);
      throw new Error(`Error fetching wishlist: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async isInWishlist(userId, productId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        "SELECT 1 FROM wishlist WHERE userId = ? AND productId = ? LIMIT 1",
        [parseInt(userId), parseInt(productId)]
      );
      return rows.length > 0;
    } catch (err) {
      console.error("DB Error (Wishlist.isInWishlist):", err.message);
      throw new Error(`Error checking wishlist: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async clear(userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.execute(
        "DELETE FROM wishlist WHERE userId = ?",
        [parseInt(userId)]
      );
      return result.affectedRows > 0;
    } catch (err) {
      console.error("DB Error (Wishlist.clear):", err.message);
      throw new Error(`Error clearing wishlist: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default Wishlist;
