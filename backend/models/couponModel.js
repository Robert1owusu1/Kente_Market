import pool from "../config/db.js";

class Coupon {
  static async create({ code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive }) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          (code || "").toUpperCase().trim(),
          discountType,
          parseFloat(discountValue),
          parseFloat(minPurchase) || 0,
          maxUses ? parseInt(maxUses) : null,
          expiresAt || null,
          isActive !== undefined ? (isActive ? 1 : 0) : 1,
        ]
      );

      return await Coupon.findById(result.insertId);
    } catch (err) {
      console.error("DB Error (Coupon.create):", err.message);
      if (err.code === "ER_DUP_ENTRY") {
        throw new Error("Coupon with this code already exists");
      }
      throw new Error(`Error creating coupon: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findAll() {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(
        "SELECT * FROM coupons ORDER BY created_at DESC"
      );
      return rows;
    } catch (err) {
      console.error("DB Error (Coupon.findAll):", err.message);
      throw new Error(`Error fetching coupons: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findById(id) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        "SELECT * FROM coupons WHERE id = ?",
        [parseInt(id)]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Coupon.findById):", err.message);
      throw new Error(`Error fetching coupon: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findByCode(code) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        "SELECT * FROM coupons WHERE UPPER(code) = UPPER(?)",
        [code]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Coupon.findByCode):", err.message);
      throw new Error(`Error fetching coupon: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async update(id, fields) {
    let connection;
    try {
      connection = await pool.getConnection();

      const allowedColumns = new Set([
        "discountType",
        "discountValue",
        "minPurchase",
        "maxUses",
        "expiresAt",
        "isActive",
      ]);

      const setClause = [];
      const values = [];

      Object.keys(fields).forEach((key) => {
        if (fields[key] !== undefined && allowedColumns.has(key)) {
          if (key === "isActive") {
            setClause.push(`${key} = ?`);
            values.push(fields[key] ? 1 : 0);
          } else if (key === "discountValue" || key === "minPurchase") {
            setClause.push(`${key} = ?`);
            values.push(parseFloat(fields[key]));
          } else if (key === "maxUses") {
            setClause.push(`${key} = ?`);
            values.push(fields[key] ? parseInt(fields[key]) : null);
          } else {
            setClause.push(`${key} = ?`);
            values.push(fields[key]);
          }
        }
      });

      if (setClause.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(id));

      await connection.execute(
        `UPDATE coupons SET ${setClause.join(", ")} WHERE id = ?`,
        values
      );

      return await Coupon.findById(id);
    } catch (err) {
      console.error("DB Error (Coupon.update):", err.message);
      throw new Error(`Error updating coupon: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async delete(id) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.execute(
        "DELETE FROM coupons WHERE id = ?",
        [parseInt(id)]
      );
      return result.affectedRows > 0;
    } catch (err) {
      console.error("DB Error (Coupon.delete):", err.message);
      throw new Error(`Error deleting coupon: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Validate a coupon code against the cart.
   * Vendor coupons (coupon.vendorId != null) are valid ONLY when every cart
   * line belongs to the issuing vendor (P0-4) — otherwise one vendor's promo
   * discounts (and via pro-rata escrow, is part-funded by) another vendor's
   * goods. Platform coupons (vendorId NULL) apply to any mix. Omitting
   * vendorIds preserves the legacy base checks; order placement always passes
   * them, so checkout is authoritative.
   */
  static async validate(code, cartTotal, { vendorIds } = {}) {
    // No pooled connection is held here on purpose: findByCode acquires its own,
    // and nesting two acquires per checkout deadlocks the pool once N
    // concurrent checkouts validate the same moment (pool size is finite).
    // Every check below is a pure function of the coupon row already fetched.
    try {
      const coupon = await Coupon.findByCode(code);

      if (!coupon) {
        return { valid: false, coupon: null, message: "Coupon not found" };
      }

      if (!coupon.isActive) {
        return { valid: false, coupon, message: "Coupon is no longer active" };
      }

      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        return { valid: false, coupon, message: "Coupon has expired" };
      }

      if (coupon.maxUses !== null && coupon.usesUsed >= coupon.maxUses) {
        return { valid: false, coupon, message: "Coupon usage limit reached" };
      }

      if (cartTotal < coupon.minPurchase) {
        return {
          valid: false,
          coupon,
          message: `Minimum purchase of $${coupon.minPurchase} required`,
        };
      }

      // P0-4 vendor scope.
      if (coupon.vendorId !== null && coupon.vendorId !== undefined) {
        const scope = parseInt(coupon.vendorId, 10);
        const ids = [...new Set(
          (Array.isArray(vendorIds) ? vendorIds : [])
            .map((v) => parseInt(v, 10))
            .filter((v) => Number.isFinite(v))
        )];
        if (ids.length === 0 || !ids.every((v) => v === scope)) {
          return {
            valid: false,
            coupon: Coupon.toPublic(coupon),
            message: "This coupon is only valid for products from its issuing store",
          };
        }
      }

      return { valid: true, coupon: Coupon.toPublic(coupon), message: "Coupon is valid" };
    } catch (err) {
      console.error("DB Error (Coupon.validate):", err.message);
      throw new Error(`Error validating coupon: ${err.message}`);
    }
  }

  /**
   * Strip internal fields before a coupon is exposed to the public validate
   * endpoint. Leaking the full row (usesUsed, tracking columns, etc.) is
   * unnecessary info disclosure (see audit — /api/coupons/validate returns the
   * entire coupon row).
   */
  static toPublic(coupon) {
    if (!coupon) return null;
    return {
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minPurchase: coupon.minPurchase,
      maxUses: coupon.maxUses,
      expiresAt: coupon.expiresAt,
      isActive: coupon.isActive,
      vendorId: coupon.vendorId ?? null,
    };
  }

  static async incrementUses(id) {
    let connection;
    try {
      connection = await pool.getConnection();
      // Conditional increment: never let usesUsed exceed maxUses. This single
      // statement is the authority behind BOTH the reservation taken when a
      // coupon is booked onto an order (reserveUse) and the legacy settlement
      // path for orders created before that fix — N concurrent checkouts that
      // all saw "1 use left" cannot push the counter past the cap. affectedRows
      // 0 = the limit was already reached.
      const [result] = await connection.execute(
        "UPDATE coupons SET usesUsed = usesUsed + 1 WHERE id = ? AND (maxUses IS NULL OR usesUsed < maxUses)",
        [parseInt(id)]
      );
      // P0-5: report the race loser instead of silently keeping the discount.
      if (result.affectedRows === 0) {
 console.warn(` Coupon ${id}: usage not consumed — limit reached at settlement time`);
      }
      const consumed = result.affectedRows > 0;
      // Re-read on the SAME connection: findById/findByCode would take a second
      // pooled connection while this one is held, and two nested acquires per
      // checkout deadlock the pool under concurrent checkouts.
      const [rows] = await connection.execute(
        "SELECT * FROM coupons WHERE id = ?",
        [parseInt(id)]
      );
      return { consumed, coupon: rows[0] || null };
    } catch (err) {
      console.error("DB Error (Coupon.incrementUses):", err.message);
      throw new Error(`Error incrementing coupon uses: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
  /**
   * Release one coupon use when a paid order is cancelled/refunded (P0-6).
   * Only call when the order actually consumed a use (i.e. it was paid).
   * Never drops below zero.
   */
  static async decrementUses(id) {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.execute(
        "UPDATE coupons SET usesUsed = GREATEST(usesUsed - 1, 0) WHERE id = ?",
        [parseInt(id)]
      );
      // Same-connection re-read (no nested pool acquire — see incrementUses).
      const [rows] = await connection.execute(
        "SELECT * FROM coupons WHERE id = ?",
        [parseInt(id)]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (Coupon.decrementUses):", err.message);
      throw new Error(`Error decrementing coupon uses: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // =========================================================================
  // N-7 / V-04 — coupon maxUses enforced on the MONEY, not on the counter.
  //
  // orders.couponUseState: 0 = none, 1 = reserved, 2 = settled.
  // The slot itself lives in coupons.usesUsed; this column records whether
  // THIS order already accounted for its slot, which is what makes reserve,
  // settle and release safe to run more than once.
  // =========================================================================

  /**
   * Atomically take ONE use of a coupon for an order that is being booked.
   * Validation (Coupon.validate) is advisory — this is the authority: the
   * conditional UPDATE cannot exceed maxUses no matter how many concurrent
   * checkouts saw "1 use left".
   * @returns {Promise<{reserved: boolean, coupon: any}>}
   */
  static async reserveUse(id) {
    const { consumed, coupon } = await Coupon.incrementUses(id);
    return { reserved: consumed, coupon };
  }

  /**
   * Read an order's coupon-slot state.
   * @returns {Promise<number|null>} 0/1/2, or null when the order does not
   * carry this coupon (or there is no such order).
   */
  static async getOrderCouponState(orderId, couponId) {
    if (!orderId || !couponId) return null;
    const [rows] = await pool.execute(
      `SELECT couponUseState FROM orders WHERE id = ? AND couponId = ? LIMIT 1`,
      [orderId, couponId]
    );
    if (rows.length === 0) return null;
    return Number(rows[0]?.couponUseState ?? 0);
  }

  /**
   * CAS an order's coupon-slot state between two DIFFERENT values.
   * Returns true only when this call performed the transition, so a caller can
   * safely own the matching side effect exactly once.
   */
  static async transitionOrderCoupon(orderId, couponId, fromState, toState) {
    if (!orderId || !couponId || fromState === toState) return false;
    const [res] = await pool.execute(
      `UPDATE orders SET couponUseState = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND couponId = ? AND couponUseState = ?`,
      [toState, orderId, couponId, fromState]
    );
    return res.affectedRows === 1;
  }

  /**
   * Settle a legacy/crash-recovered order: claim the slot FOR THIS ORDER and
   * take it in ONE transaction, so it is impossible to either
   *   (a) settle the same order twice (retry/webhook/verify), or
   *   (b) mark an order settled without actually holding a slot.
   * If the cap is already reached the transaction rolls back and the order is
   * left unclaimed — the caller reports it instead of honouring the discount.
   * @returns {Promise<{consumed: boolean, exhausted: boolean}>}
   */
  static async consumeForOrderOnce(orderId, couponId) {
    if (!orderId || !couponId) return { consumed: false, exhausted: false };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [claim] = await connection.execute(
        `UPDATE orders SET couponUseState = 2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND couponId = ? AND couponUseState = 0`,
        [orderId, couponId]
      );
      if (claim.affectedRows !== 1) {
        await connection.rollback();
        return { consumed: false, exhausted: false };
      }

      const [take] = await connection.execute(
        `UPDATE coupons SET usesUsed = usesUsed + 1
         WHERE id = ? AND (maxUses IS NULL OR usesUsed < maxUses)`,
        [parseInt(couponId)]
      );
      if (take.affectedRows !== 1) {
        // Cap reached: undo the claim so the order is not left marked settled
        // while holding no slot, then let the caller journal the over-redeem.
        await connection.rollback();
        return { consumed: false, exhausted: true };
      }

      await connection.commit();
      return { consumed: true, exhausted: false };
    } catch (err) {
      try { await connection.rollback(); } catch { /* connection may be gone */ }
      throw new Error(`Error settling coupon for order: ${err.message}`);
    } finally {
      connection.release();
    }
  }

  /**
   * Give back a slot held by an order that will never settle (cancelled or
   * expired before payment). The 1 -> 0 CAS inside the transaction is the
   * ownership test: cancelOrder and the expiry sweeper can both try, and only
   * the winner decrements — so a slot can never be released twice.
   * @returns {Promise<boolean>} true when this call released the slot
   */
  static async releaseForOrder(orderId, couponId) {
    if (!orderId || !couponId) return false;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [claim] = await connection.execute(
        `UPDATE orders SET couponUseState = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND couponId = ? AND couponUseState = 1 AND paymentStatus <> 'paid'`,
        [orderId, couponId]
      );
      if (claim.affectedRows !== 1) {
        await connection.rollback();
        return false;
      }
      await connection.execute(
        `UPDATE coupons SET usesUsed = GREATEST(usesUsed - 1, 0) WHERE id = ?`,
        [parseInt(couponId)]
      );
      await connection.commit();
      return true;
    } catch (err) {
      try { await connection.rollback(); } catch { /* connection may be gone */ }
      throw new Error(`Error releasing coupon reservation: ${err.message}`);
    } finally {
      connection.release();
    }
  }
}

export default Coupon;
