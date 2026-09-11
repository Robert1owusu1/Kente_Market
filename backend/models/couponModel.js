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

  static async validate(code, cartTotal) {
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
    };
  }

  static async incrementUses(id) {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.execute(
        "UPDATE coupons SET usesUsed = usesUsed + 1 WHERE id = ?",
        [parseInt(id)]
      );
      return await Coupon.findById(id);
    } catch (err) {
      console.error("DB Error (Coupon.incrementUses):", err.message);
      throw new Error(`Error incrementing coupon uses: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default Coupon;
