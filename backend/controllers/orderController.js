// FILE LOCATION: controllers/orderController.js
// DESCRIPTION: Complete order controller with all CRUD operations and analytics

import Order from "../models/orderModel.js";
import pool from "../config/db.js";

// ============================================
// UTILITY FUNCTIONS
// ============================================

// ✅ Validate ID
const isValidId = (id) => {
  return !isNaN(id) && parseInt(id) > 0;
};

// ============================================
// CRUD OPERATIONS (Your existing functions)
// ============================================

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
export const addOrderItems = async (req, res) => {
  try {
    const orderData = {
      userId: req.user.id,
      orderNumber: "ORD-" + Date.now(),
      items: req.body.items || [],
      totalAmount: req.body.totalAmount,
      shippingAddress: req.body.shippingAddress || {},
      billingAddress: req.body.billingAddress || {},
      paymentMethod: req.body.paymentMethod || "pending",
      paymentStatus: req.body.paymentStatus || "unpaid",
      orderStatus: "pending",
      shippingCost: req.body.shippingCost || 0,
      tax: req.body.tax || 0,
      discount: req.body.discount || 0,
      notes: req.body.notes || null,
    };

    const newOrder = await Order.create(orderData);
    res.status(201).json({ message: "Order created successfully", order: newOrder });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all orders with pagination
// @route   GET /api/orders
// @access  Private/Admin
export const getOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || null;
    const paymentStatus = req.query.paymentStatus || null;
    const search = req.query.search || null;
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'DESC';

    const result = await Order.findAll({
      page,
      limit,
      status,
      paymentStatus,
      search,
      sortBy,
      sortOrder,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single order by ID
// @route   GET /api/orders/:id
// @access  Private
export const getOrderById = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Security: Only allow user to see their own orders, or admin
    if (req.user.role !== 'admin' && order.userId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to view this order" });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged-in user's orders
// @route   GET /api/orders/myorders
// @access  Private
export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.findByUserId(req.user.id);
    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update order
// @route   PUT /api/orders/:id
// @access  Private
export const updateOrder = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    // Check if order exists and user has permission
    const existingOrder = await Order.findById(req.params.id);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Only admin or order owner can update
    if (req.user.role !== 'admin' && existingOrder.userId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to update this order" });
    }

    const updatedOrder = await Order.update(req.params.id, req.body);
    res.json({ message: "Order updated successfully", order: updatedOrder });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark order as paid
// @route   PUT /api/orders/:id/pay
// @access  Private
export const updateOrderToPaid = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    await Order.update(req.params.id, {
      paymentStatus: "paid",
      orderStatus: "processing",
    });

    res.json({ message: "Order marked as paid" });
  } catch (error) {
    console.error('Error marking order as paid:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark order as delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
export const updateOrderToDelivered = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const updatedOrder = await Order.update(req.params.id, {
      orderStatus: "delivered",
    });

    res.json({ message: "Order marked as delivered", order: updatedOrder });
  } catch (error) {
    console.error('Error marking order as delivered:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete order
// @route   DELETE /api/orders/:id
// @access  Private/Admin
export const deleteOrder = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    await Order.delete(req.params.id);
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ message: error.message });
  }
};

// ============================================
// ANALYTICS FUNCTIONS (Enhanced)
// ============================================

// @desc    Get order statistics
// @route   GET /api/orders/statistics
// @access  Private/Admin
export const getOrderStatistics = async (req, res) => {
  try {
    const stats = await Order.getStatistics();
    
    // Calculate additional metrics
    const totalRevenue = parseFloat(stats.totalRevenue) || 0;
    const totalOrders = parseInt(stats.totalOrders) || 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    // Calculate conversion rate
    const deliveredOrders = parseInt(stats.deliveredOrders) || 0;
    const conversionRate = totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0;

    const response = {
      totalOrders,
      totalRevenue,
      avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
      conversionRate: parseFloat(conversionRate.toFixed(2)),
      pendingOrders: parseInt(stats.pendingOrders) || 0,
      processingOrders: parseInt(stats.processingOrders) || 0,
      deliveredOrders,
      cancelledOrders: parseInt(stats.cancelledOrders) || 0,
      paidOrders: parseInt(stats.paidOrders) || 0,
      unpaidOrders: parseInt(stats.unpaidOrders) || 0,
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get sales analytics by date range
// @route   GET /api/orders/analytics
// @access  Private/Admin
export const getSalesAnalytics = async (req, res) => {
  let connection;
  try {
    const { startDate, endDate, groupBy = 'month' } = req.query;
    
    connection = await pool.getConnection();
    
    let dateFormat;
    switch(groupBy) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%Y-%u';
        break;
      case 'month':
      default:
        dateFormat = '%Y-%m';
        break;
    }

    let query = `
      SELECT 
        DATE_FORMAT(created_at, ?) as period,
        COUNT(*) as orderCount,
        SUM(totalAmount) as revenue,
        AVG(totalAmount) as avgOrderValue
      FROM orders
      WHERE 1=1
    `;

    const params = [dateFormat];

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }

    query += ' GROUP BY period ORDER BY period ASC';

    const [results] = await connection.execute(query, params);

    res.json(results);
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};

// @desc    Get top selling products from orders
// @route   GET /api/orders/top-products
// @access  Private/Admin
export const getTopProducts = async (req, res) => {
  let connection;
  try {
    const { limit = 10 } = req.query;
    
    connection = await pool.getConnection();
    
    const [orders] = await connection.execute(`
      SELECT items 
      FROM orders 
      WHERE orderStatus != 'cancelled'
    `);

    // Aggregate product sales
    const productSales = {};
    
    orders.forEach(order => {
      try {
        const items = JSON.parse(order.items);
        items.forEach(item => {
          const key = item.productId || item.id || item.title;
          if (!productSales[key]) {
            productSales[key] = {
              productId: key,
              name: item.title || item.name || 'Unknown Product',
              quantity: 0,
              revenue: 0
            };
          }
          productSales[key].quantity += item.quantity || 1;
          productSales[key].revenue += (item.price || 0) * (item.quantity || 1);
        });
      } catch (e) {
        console.error('Error parsing order items:', e);
      }
    });

    // Sort by revenue and limit
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, parseInt(limit));

    res.json(topProducts);
  } catch (error) {
    console.error('Error fetching top products:', error);
    res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};