// FILE LOCATION: models/cartModel.js
// DESCRIPTION: Server-side cart persistence. A cart belongs to either a signed-in
//   user (userId) or an anonymous visitor (guestId cookie). Items are stored as a
//   JSON array mirroring the client's CartItem shape. lastRecoveryEmailAt
//   debounces abandoned-cart recovery emails so a cart is re-targeted at most
//   once per interval.

import pool from "../config/db.js";

class Cart {
  constructor(cartData) {
    this.id = cartData.id;
    this.userId = cartData.userId || null;
    this.guestId = cartData.guestId || null;
    this.items = Cart.safeParse(cartData.items, []);
    this.lastRecoveryEmailAt = cartData.lastRecoveryEmailAt || null;
    this.created_at = cartData.created_at;
    this.updated_at = cartData.updated_at;
  }

  static safeParse(data, fallback) {
    if (!data) return fallback;
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return fallback;
      }
    }
    return Array.isArray(data) ? data : fallback;
  }

  // @@desc   Find the cart for a user or guest (one row per owner).
  static async findByOwner({ userId = null, guestId = null }) {
    const connection = await pool.getConnection();
    try {
      if (!userId && !guestId) return null;
      const [rows] = userId
        ? await connection.execute(
            `SELECT * FROM carts WHERE userId = ?`,
            [parseInt(userId, 10)]
          )
        : await connection.execute(
            `SELECT * FROM carts WHERE guestId = ? AND userId IS NULL`,
            [guestId]
          );
      return rows.length > 0 ? new Cart(rows[0]) : null;
    } catch (error) {
      throw new Error("Error fetching cart: " + error.message);
    } finally {
      connection.release();
    }
  }

  // @@desc   Upsert the given items for an owner (replaces whatever is stored).
  static async save({ userId = null, guestId = null, items }) {
    const connection = await pool.getConnection();
    try {
      const safeItems = JSON.stringify(Array.isArray(items) ? items : []);
      if (userId) {
        const [existing] = await connection.execute(
          `SELECT id FROM carts WHERE userId = ?`,
          [parseInt(userId, 10)]
        );
        if (existing.length > 0) {
          await connection.execute(
            `UPDATE carts SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [safeItems, existing[0].id]
          );
          return { id: existing[0].id, userId, guestId: null, items };
        }
        const [result] = await connection.execute(
          `INSERT INTO carts (userId, items) VALUES (?, ?)`,
          [parseInt(userId, 10), safeItems]
        );
        return { id: result.insertId, userId, guestId: null, items };
      }

      const [existing] = await connection.execute(
        `SELECT id FROM carts WHERE guestId = ? AND userId IS NULL`,
        [guestId]
      );
      if (existing.length > 0) {
        await connection.execute(
          `UPDATE carts SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [safeItems, existing[0].id]
        );
        return { id: existing[0].id, userId: null, guestId, items };
      }
      const [result] = await connection.execute(
        `INSERT INTO carts (guestId, items) VALUES (?, ?)`,
        [guestId, safeItems]
      );
      return { id: result.insertId, userId: null, guestId, items };
    } catch (error) {
      throw new Error("Error saving cart: " + error.message);
    } finally {
      connection.release();
    }
  }

  // @@desc   Merge incoming items into the stored cart (product+color+yards keys,
  //   quantities summed). Returns the merged array so the client can adopt it as
  //   its single source of truth for the session.
  static merge(existingItems, incomingItems) {
    const merged = new Map();
    for (const item of [...existingItems, ...incomingItems]) {
      const qty = Math.max(1, parseInt(item.quantity ?? item.qty ?? 1, 10) || 1);
      const key = `${item.product ?? item.productId ?? item.id}_${item.selectedColor || ''}_${item.yards ?? item.selectedSize ?? ''}`;
      const prev = merged.get(key);
      if (prev) {
        prev.quantity = prev.quantity + qty;
      } else {
        merged.set(key, {
          ...item,
          id: item.product ?? item.productId ?? item.id,
          quantity: qty,
        });
      }
    }
    return [...merged.values()];
  }

  // @@desc   Clear a user's cart (after checkout). Best-effort.
  static async clear({ userId = null, guestId = null }) {
    const connection = await pool.getConnection();
    try {
      if (userId) {
        await connection.execute(`DELETE FROM carts WHERE userId = ?`, [parseInt(userId, 10)]);
      } else if (guestId) {
        await connection.execute(`DELETE FROM carts WHERE guestId = ? AND userId IS NULL`, [guestId]);
      }
      return true;
    } catch (error) {
      throw new Error("Error clearing cart: " + error.message);
    } finally {
      connection.release();
    }
  }
}

export default Cart;