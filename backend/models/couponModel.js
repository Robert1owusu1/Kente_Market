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
    let connection;
    try {
      connection = await pool.getConnection();

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
    } finally {
      if (connection) connection.release();
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
      // Conditional increment: never let usesUsed exceed maxUses. Validation
      // (Coupon.validate) and this consumption are deliberately not the same
      // statement — usage is deferred until payment confirms — so N in-flight
      // checkouts that all saw "1 use left" must not push the counter past the
      // cap here. affectedRows 0 = limit reached at consumption time.
      const [result] = await connection.execute(
        "UPDATE coupons SET usesUsed = usesUsed + 1 WHERE id = ? AND (maxUses IS NULL OR usesUsed < maxUses)",
        [parseInt(id)]
      );
      // P0-5: report the race loser instead of silently keeping the discount.
      if (result.affectedRows === 0) {
 console.warn(` Coupon ${id}: usage not consumed — limit reached at payment time`);
      }
      const consumed = result.affectedRows > 0;
      return { consumed, coupon: await Coupon.findById(id) };
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
      return await Coupon.findById(id);
    } catch (err) {
      console.error("DB Error (Coupon.decrementUses):", err.message);
      throw new Error(`Error decrementing coupon uses: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default Coupon;
