import pool from "../config/db.js";

class ReturnRequest {
  static async create({ orderId, userId, reason, description }) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `INSERT INTO return_requests (orderId, userId, reason, description, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [
          parseInt(orderId),
          parseInt(userId),
          reason,
          description || null,
        ]
      );

      return await ReturnRequest.findById(result.insertId);
    } catch (err) {
      console.error("DB Error (ReturnRequest.create):", err.message);
      throw new Error(`Error creating return request: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findById(id) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        `SELECT rr.*, o.orderNumber, o.totalAmount, o.orderStatus,
                u.firstName, u.lastName, u.email
         FROM return_requests rr
         LEFT JOIN orders o ON o.id = rr.orderId
         LEFT JOIN users u ON u.id = rr.userId
         WHERE rr.id = ?`,
        [parseInt(id)]
      );
      return rows[0] || null;
    } catch (err) {
      console.error("DB Error (ReturnRequest.findById):", err.message);
      throw new Error(`Error fetching return request: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findByOrder(orderId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        `SELECT rr.*, u.firstName, u.lastName, u.email
         FROM return_requests rr
         LEFT JOIN users u ON u.id = rr.userId
         WHERE rr.orderId = ?
         ORDER BY rr.created_at DESC`,
        [parseInt(orderId)]
      );
      return rows;
    } catch (err) {
      console.error("DB Error (ReturnRequest.findByOrder):", err.message);
      throw new Error(`Error fetching return requests: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findByUser(userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.execute(
        `SELECT rr.*, o.orderNumber, o.totalAmount
         FROM return_requests rr
         LEFT JOIN orders o ON o.id = rr.orderId
         WHERE rr.userId = ?
         ORDER BY rr.created_at DESC`,
        [parseInt(userId)]
      );
      return rows;
    } catch (err) {
      console.error("DB Error (ReturnRequest.findByUser):", err.message);
      throw new Error(`Error fetching return requests: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async findAll() {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(
        `SELECT rr.*, o.orderNumber, o.totalAmount,
                u.firstName, u.lastName, u.email
         FROM return_requests rr
         LEFT JOIN orders o ON o.id = rr.orderId
         LEFT JOIN users u ON u.id = rr.userId
         ORDER BY rr.created_at DESC`
      );
      return rows;
    } catch (err) {
      console.error("DB Error (ReturnRequest.findAll):", err.message);
      throw new Error(`Error fetching return requests: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  static async updateStatus(id, status, adminNotes) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `UPDATE return_requests SET status = ?, adminNotes = ? WHERE id = ?`,
        [status, adminNotes || null, parseInt(id)]
      );

      if (result.affectedRows === 0) {
        throw new Error("Return request not found");
      }

      return await ReturnRequest.findById(id);
    } catch (err) {
      console.error("DB Error (ReturnRequest.updateStatus):", err.message);
      throw new Error(`Error updating return request: ${err.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default ReturnRequest;
