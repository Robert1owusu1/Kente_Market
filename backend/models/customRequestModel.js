// FILE LOCATION: backend/models/customRequestModel.js
// DESCRIPTION: Model for buyer -> vendor customization requests (custom kente
//              orders: yards, colours, thread composition, timing, quotes).
import pool from "../config/db.js";

function parseJSON(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value.split(",").map((v) => v.trim()).filter(Boolean);
    }
  }
  return value;
}

class CustomRequest {
  static row(row) {
    if (!row) return null;
    return {
      ...row,
      colours: parseJSON(row.colours, []),
      threadTypes: parseJSON(row.threadTypes, []),
      yards: row.yards !== null ? parseFloat(row.yards) : null,
      vendorQuotePrice:
        row.vendorQuotePrice !== null && row.vendorQuotePrice !== undefined
          ? parseFloat(row.vendorQuotePrice)
          : null,
    };
  }

  // ✅ Create a new customization request (customer)
  static async create(data) {
    const connection = await pool.getConnection();
    try {
      const [result] = await connection.execute(
        `INSERT INTO custom_requests (
          customerId, vendorId, baseProductId, description, yards, colours,
          dominantColour, threadTypes, dominantThread, referenceImage,
          neededForDate, neededForTime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.customerId,
          data.vendorId,
          data.baseProductId || null,
          data.description || null,
          data.yards,
          JSON.stringify(data.colours || []),
          data.dominantColour || null,
          JSON.stringify(data.threadTypes || []),
          data.dominantThread || null,
          data.referenceImage || null,
          data.neededForDate || null,
          data.neededForTime || null,
        ]
      );
      return CustomRequest.findById(result.insertId);
    } catch (err) {
      console.error("DB Error (CustomRequest.create):", err.message);
      throw new Error(`Error creating custom request: ${err.message}`);
    } finally {
      connection.release();
    }
  }

  static async findById(id) {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        `SELECT r.*,
                v.businessName AS vendorBusinessName,
                v.status AS vendorStatus,
                CONCAT(c.firstName, ' ', c.lastName) AS customerName,
                c.email AS customerEmail,
                p.title AS baseProductTitle
         FROM custom_requests r
         LEFT JOIN vendors v ON v.userId = r.vendorId
         LEFT JOIN users c ON c.id = r.customerId
         LEFT JOIN product p ON p.id = r.baseProductId
         WHERE r.id = ?`,
        [parseInt(id)]
      );
      return CustomRequest.row(rows[0] || null);
    } catch (err) {
      console.error("DB Error (CustomRequest.findById):", err.message);
      throw new Error(`Error fetching custom request: ${err.message}`);
    } finally {
      connection.release();
    }
  }

  static async findByCustomer(customerId, { limit = 100 } = {}) {
    const connection = await pool.getConnection();
    try {
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 300));
      const [rows] = await connection.query(
        `SELECT r.*,
                v.businessName AS vendorBusinessName,
                CONCAT(c.firstName, ' ', c.lastName) AS customerName,
                p.title AS baseProductTitle
         FROM custom_requests r
         LEFT JOIN vendors v ON v.userId = r.vendorId
         LEFT JOIN users c ON c.id = r.customerId
         LEFT JOIN product p ON p.id = r.baseProductId
         WHERE r.customerId = ?
         ORDER BY r.created_at DESC
         LIMIT ?`,
        [parseInt(customerId), safeLimit]
      );
      return rows.map(CustomRequest.row);
    } catch (err) {
      console.error("DB Error (CustomRequest.findByCustomer):", err.message);
      throw new Error(`Error fetching custom requests: ${err.message}`);
    } finally {
      connection.release();
    }
  }

  static async findByVendor(vendorId, { status = null, limit = 100 } = {}) {
    const connection = await pool.getConnection();
    try {
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 300));
      let query = `SELECT r.*,
                v.businessName AS vendorBusinessName,
                CONCAT(c.firstName, ' ', c.lastName) AS customerName,
                c.phone AS customerPhone,
                p.title AS baseProductTitle
         FROM custom_requests r
         LEFT JOIN vendors v ON v.userId = r.vendorId
         LEFT JOIN users c ON c.id = r.customerId
         LEFT JOIN product p ON p.id = r.baseProductId
         WHERE r.vendorId = ?`;
      const params = [parseInt(vendorId)];
      if (status) {
        query += " AND r.status = ?";
        params.push(status);
      }
      query += " ORDER BY r.created_at DESC LIMIT ?";
      params.push(safeLimit);
      const [rows] = await connection.query(query, params);
      return rows.map(CustomRequest.row);
    } catch (err) {
      console.error("DB Error (CustomRequest.findByVendor):", err.message);
      throw new Error(`Error fetching custom requests: ${err.message}`);
    } finally {
      connection.release();
    }
  }

  static async findAllAdmin({ status = null, limit = 200 } = {}) {
    const connection = await pool.getConnection();
    try {
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 200, 500));
      let query = `SELECT r.*,
                v.businessName AS vendorBusinessName,
                CONCAT(c.firstName, ' ', c.lastName) AS customerName,
                c.email AS customerEmail,
                c.phone AS customerPhone,
                p.title AS baseProductTitle
         FROM custom_requests r
         LEFT JOIN vendors v ON v.userId = r.vendorId
         LEFT JOIN users c ON c.id = r.customerId
         LEFT JOIN product p ON p.id = r.baseProductId
         WHERE 1=1`;
      const params = [];
      if (status) {
        query += " AND r.status = ?";
        params.push(status);
      }
      query += " ORDER BY r.created_at DESC LIMIT ?";
      params.push(safeLimit);
      const [rows] = await connection.query(query, params);
      return rows.map(CustomRequest.row);
    } catch (err) {
      console.error("DB Error (CustomRequest.findAllAdmin):", err.message);
      throw new Error(`Error fetching custom requests: ${err.message}`);
    } finally {
      connection.release();
    }
  }

  // ✅ Whitelisted field updates (mirrors product model pattern)
  static async update(id, updateData) {
    const connection = await pool.getConnection();
    try {
      const allowedColumns = new Set([
        'status', 'vendorQuotePrice', 'vendorCanMeet', 'vendorMessage',
        'customerCancelReason', 'orderId', 'adminReviewed',
      ]);
      const setClause = [];
      const values = [];
      Object.keys(updateData).forEach((key) => {
        if (updateData[key] !== undefined && allowedColumns.has(key)) {
          if (key === 'vendorQuotePrice') {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] !== null && updateData[key] !== '' ? parseFloat(updateData[key]) : null);
          } else if (key === 'vendorCanMeet' || key === 'adminReviewed') {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] ? 1 : 0);
          } else {
            setClause.push(`${key} = ?`);
            values.push(updateData[key]);
          }
        }
      });
      if (setClause.length === 0) {
        throw new Error("No fields to update");
      }
      setClause.push("updated_at = CURRENT_TIMESTAMP");
      values.push(parseInt(id));
      await connection.execute(
        `UPDATE custom_requests SET ${setClause.join(", ")} WHERE id = ?`,
        values
      );
      return CustomRequest.findById(id);
    } catch (err) {
      console.error("DB Error (CustomRequest.update):", err.message);
      throw new Error(`Error updating custom request: ${err.message}`);
    } finally {
      connection.release();
    }
  }

  static async adminStats() {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(
        `SELECT status, COUNT(*) AS count FROM custom_requests GROUP BY status`
      );
      const statusCounts = {};
      rows.forEach((r) => { statusCounts[r.status] = parseInt(r.count); });

      const [[agg]] = await connection.query(
        `SELECT COUNT(*) AS total,
                COALESCE(AVG(vendorQuotePrice), 0) AS avgQuote,
                COALESCE(SUM(CASE WHEN adminReviewed = 0 THEN 1 ELSE 0 END), 0) AS unreviewed,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid
         FROM custom_requests`
      );

      const [cancelReasons] = await connection.query(
        `SELECT customerCancelReason, COUNT(*) AS count
         FROM custom_requests
         WHERE customerCancelReason IS NOT NULL AND customerCancelReason != ''
         GROUP BY customerCancelReason
         ORDER BY count DESC
         LIMIT 10`
      );

      return {
        total: parseInt(agg.total) || 0,
        avgQuote: parseFloat(parseFloat(agg.avgQuote).toFixed(2)),
        unreviewed: parseInt(agg.unreviewed) || 0,
        paid: parseInt(agg.paid) || 0,
        statusCounts,
        topCancelReasons: cancelReasons,
      };
    } catch (err) {
      console.error("DB Error (CustomRequest.adminStats):", err.message);
      throw new Error(`Error fetching custom request stats: ${err.message}`);
    } finally {
      connection.release();
    }
  }
}

export default CustomRequest;