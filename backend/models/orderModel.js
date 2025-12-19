import pool from "../config/db.js";

class Order {
  constructor(orderData) {
    this.id = orderData.id;
    this.userId = orderData.userId;
    this.orderNumber = orderData.orderNumber;
    this.items = Order.safeParse(orderData.items, []);
    this.totalAmount = orderData.totalAmount;
    this.shippingAddress = Order.safeParse(orderData.shippingAddress, {});
    this.billingAddress = Order.safeParse(orderData.billingAddress, {});
    this.paymentMethod = orderData.paymentMethod;
    this.paymentStatus = orderData.paymentStatus;
    this.orderStatus = orderData.orderStatus;
    this.shippingCost = orderData.shippingCost;
    this.tax = orderData.tax;
    this.discount = orderData.discount;
    this.notes = orderData.notes;
    this.created_at = orderData.created_at;
    this.updated_at = orderData.updated_at;
    // Include user info if joined
    this.firstName = orderData.firstName;
    this.lastName = orderData.lastName;
    this.email = orderData.email;
  }

  // ✅ Utility: safely parse JSON
  static safeParse(data, fallback) {
    if (!data) return fallback;
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return fallback;
      }
    }
    return data;
  }

  // ✅ Validate order data
  static validateOrder(orderData) {
    const errors = [];

    if (!orderData.userId || orderData.userId <= 0) {
      errors.push("Valid user ID is required");
    }
    if (!orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
      errors.push("Order must have at least one item");
    }
    if (!orderData.totalAmount || orderData.totalAmount <= 0) {
      errors.push("Total amount must be greater than 0");
    }

    return errors;
  }

  // ✅ Create new order with validation
  static async create(orderData) {
    const validation = Order.validateOrder(orderData);
    if (validation.length > 0) {
      throw new Error(`Validation failed: ${validation.join(", ")}`);
    }

    const connection = await pool.getConnection();
    try {
      const [result] = await connection.execute(
        `INSERT INTO orders 
        (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
         paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderData.userId,
          orderData.orderNumber,
          JSON.stringify(orderData.items || []),
          orderData.totalAmount,
          JSON.stringify(orderData.shippingAddress || {}),
          JSON.stringify(orderData.billingAddress || {}),
          orderData.paymentMethod || 'pending',
          orderData.paymentStatus || 'unpaid',
          orderData.orderStatus || 'pending',
          orderData.shippingCost || 0,
          orderData.tax || 0,
          orderData.discount || 0,
          orderData.notes || null,
        ]
      );
      return { id: result.insertId, ...orderData };
    } catch (error) {
      throw new Error("Error creating order: " + error.message);
    } finally {
      connection.release();
    }
  }

  // ✅ Find all orders with pagination and filters
  // ✅ Find all orders with pagination and filters - FIXED VERSION
static async findAll(options = {}) {
  let connection;
  try {
    connection = await pool.getConnection();
    
    const {
      page = 1,
      limit = 100,
      status = null,
      paymentStatus = null,
      userId = null,
      search = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    // Validate and sanitize pagination values
    const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 1000));
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    // Security: Whitelist sortBy columns
    const allowedSortColumns = ['created_at', 'totalAmount', 'orderStatus', 'id'];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("o.orderStatus = ?");
      params.push(status);
    }
    if (paymentStatus) {
      conditions.push("o.paymentStatus = ?");
      params.push(paymentStatus);
    }
    if (userId) {
      conditions.push("o.userId = ?");
      params.push(parseInt(userId));
    }
    if (search) {
      conditions.push("(o.orderNumber LIKE ? OR u.firstName LIKE ? OR u.lastName LIKE ? OR u.email LIKE ?)");
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    console.log('Fetching orders with options:', { page: safePage, limit: safeLimit, offset: safeOffset });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total 
                        FROM orders o 
                        LEFT JOIN users u ON o.userId = u.id 
                        ${whereClause}`;
    
    const [countResult] = params.length > 0
      ? await connection.execute(countQuery, params)
      : await connection.query(countQuery);

    // Get paginated results - LIMIT and OFFSET directly in query string
    const dataQuery = `SELECT o.*, u.firstName, u.lastName, u.email 
                       FROM orders o 
                       LEFT JOIN users u ON o.userId = u.id 
                       ${whereClause}
                       ORDER BY o.${safeSortBy} ${safeSortOrder} 
                       LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = params.length > 0
      ? await connection.execute(dataQuery, params)
      : await connection.query(dataQuery);

    console.log(`Found ${rows.length} orders out of ${countResult[0].total} total`);

    return {
      orders: rows.map((row) => new Order(row)),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / safeLimit),
      },
    };
  } catch (error) {
    console.error('Error in Order.findAll:', error.message);
    console.error('Stack:', error.stack);
    throw new Error("Error fetching orders: " + error.message);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

  // ✅ Find order by ID
  static async findById(id) {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        `SELECT o.*, u.firstName, u.lastName, u.email 
         FROM orders o 
         LEFT JOIN users u ON o.userId = u.id 
         WHERE o.id = ?`,
        [id]
      );
      if (rows.length === 0) return null;
      return new Order(rows[0]);
    } catch (error) {
      throw new Error("Error fetching order: " + error.message);
    } finally {
      connection.release();
    }
  }

  // ✅ Find orders by userId
  static async findByUserId(userId) {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        `SELECT o.*, u.firstName, u.lastName, u.email 
         FROM orders o 
         LEFT JOIN users u ON o.userId = u.id 
         WHERE o.userId = ? 
         ORDER BY o.created_at DESC`,
        [userId]
      );
      return rows.map((row) => new Order(row));
    } catch (error) {
      throw new Error("Error fetching user orders: " + error.message);
    } finally {
      connection.release();
    }
  }

  // ✅ Update order with field whitelisting
  static async update(id, updateData) {
    const connection = await pool.getConnection();
    try {
      // Check existence
      const [check] = await connection.execute(`SELECT id FROM orders WHERE id = ?`, [id]);
      if (check.length === 0) throw new Error("Order not found");

      const allowedFields = [
        'orderStatus', 'paymentStatus', 'paymentMethod', 'shippingCost',
        'tax', 'discount', 'notes', 'items', 'shippingAddress', 'billingAddress'
      ];

      const fields = [];
      const values = [];

      for (let [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key)) {
          if (["items", "shippingAddress", "billingAddress"].includes(key)) {
            fields.push(`${key} = ?`);
            values.push(JSON.stringify(value || (key === "items" ? [] : {})));
          } else {
            fields.push(`${key} = ?`);
            values.push(value);
          }
        }
      }

      if (fields.length === 0) {
        throw new Error("No valid fields to update");
      }

      values.push(id);

      await connection.execute(
        `UPDATE orders SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );

      return await Order.findById(id);
    } catch (error) {
      throw new Error("Error updating order: " + error.message);
    } finally {
      connection.release();
    }
  }

  // ✅ Delete order (with check)
  static async delete(id) {
    const connection = await pool.getConnection();
    try {
      const [check] = await connection.execute(`SELECT id FROM orders WHERE id = ?`, [id]);
      if (check.length === 0) throw new Error("Order not found");
      await connection.execute("DELETE FROM orders WHERE id = ?", [id]);
      return { message: "Order deleted successfully" };
    } catch (error) {
      throw new Error("Error deleting order: " + error.message);
    } finally {
      connection.release();
    }
  }

  // ✅ Get order statistics
  static async getStatistics() {
    const connection = await pool.getConnection();
    try {
      const [stats] = await connection.execute(`
        SELECT 
          COUNT(*) as totalOrders,
          SUM(totalAmount) as totalRevenue,
          SUM(CASE WHEN orderStatus = 'pending' THEN 1 ELSE 0 END) as pendingOrders,
          SUM(CASE WHEN orderStatus = 'processing' THEN 1 ELSE 0 END) as processingOrders,
          SUM(CASE WHEN orderStatus = 'delivered' THEN 1 ELSE 0 END) as deliveredOrders,
          SUM(CASE WHEN orderStatus = 'cancelled' THEN 1 ELSE 0 END) as cancelledOrders,
          SUM(CASE WHEN paymentStatus = 'paid' THEN 1 ELSE 0 END) as paidOrders,
          SUM(CASE WHEN paymentStatus = 'unpaid' THEN 1 ELSE 0 END) as unpaidOrders
        FROM orders
      `);
      return stats[0];
    } catch (error) {
      throw new Error("Error fetching statistics: " + error.message);
    } finally {
      connection.release();
    }
  }
}

export default Order;