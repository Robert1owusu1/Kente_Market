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
      // If the item is in stock right now, they can buy it immediately — no
      // "back in stock" alert needed until the next 0 -> >0 transition.
      const [[product]] = await connection.execute(
        `SELECT stock, price FROM product WHERE id = ?`,
        [parseInt(productId)]
      );
      if (product && parseInt(product.stock) > 0) {
        await connection.execute(
          `UPDATE wishlist
           SET lastRestockNotifiedAt = NOW()
           WHERE userId = ? AND productId = ? AND lastRestockNotifiedAt IS NULL`,
          [parseInt(userId), parseInt(productId)]
        );
      }
      // Snapshot the price it was saved at — the baseline a future price-drop
      // alert compares against (only set once, so re-wishlisting keeps the
      // original baseline and we never re-alert for the same level).
      if (product && product.price != null) {
        await connection.execute(
          `UPDATE wishlist SET lastAlertedPrice = ?
           WHERE userId = ? AND productId = ? AND lastAlertedPrice IS NULL`,
          [parseFloat(product.price), parseInt(userId), parseInt(productId)]
        );
      }
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
                w.lastAlertedPrice, w.lastPriceDropNotifiedAt,
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
