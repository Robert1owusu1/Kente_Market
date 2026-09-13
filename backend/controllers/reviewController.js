// FILE LOCATION: backend/controllers/reviewController.js
// DESCRIPTION: Product reviews (create, list by product, list all, verified
//              order reviews, admin moderation + analytics)
import pool from "../config/db.js";
import Review from "../models/reviewModel.js";

// ✅ POST /api/reviews - create/update a review (authenticated user only)
export const createReview = async (req, res) => {
  try {
    const { productId, rating, comment } = req.body || {};
    const userId = req.user.id;

    if (!productId || isNaN(productId)) {
      return res.status(400).json({ message: "A valid product is required" });
    }
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }
    if (!comment || !comment.trim()) {
      return res.status(400).json({ message: "Please write a review comment" });
    }

    const userName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim();

    const review = await Review.create({
      userId,
      productId: parseInt(productId),
      rating: ratingNum,
      comment: comment.trim(),
      userName,
    });

    res.status(201).json({
      message: "Thank you for your review!",
      review,
    });
  } catch (error) {
    console.error("❌ createReview error:", error.message);
    res.status(500).json({ message: "Failed to save review" });
  }
};

// ✅ GET /api/reviews/product/:productId - reviews for a product (public)
export const getProductReviews = async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    if (isNaN(productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }
    const reviews = await Review.findByProduct(productId, req.query.limit);
    res.json(reviews);
  } catch (error) {
    console.error("❌ getProductReviews error:", error.message);
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
};

// ✅ GET /api/reviews - all reviews (public)
export const getAllReviews = async (req, res) => {
  try {
    const reviews = await Review.findAll(req.query.limit);
    res.json(reviews);
  } catch (error) {
    console.error("❌ getAllReviews error:", error.message);
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
};

// ✅ PUT /api/reviews/:id - edit own review
export const updateReview = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid review id" });

    const review = await Review.findById(id);
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (review.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }

    const { rating, comment } = req.body;
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    const updated = await Review.update(id, {
      rating: ratingNum,
      comment: (comment || "").trim().slice(0, 2000),
    });
    res.json({ message: "Review updated", review: updated });
  } catch (error) {
    console.error("❌ updateReview error:", error.message);
    res.status(500).json({ message: "Failed to update review" });
  }
};

// ✅ DELETE /api/reviews/:id - delete review
export const deleteReview = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid review id" });

    const review = await Review.findById(id);
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (review.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }

    await Review.delete(id);
    res.json({ message: "Review deleted" });
  } catch (error) {
    console.error("❌ deleteReview error:", error.message);
    res.status(500).json({ message: "Failed to delete review" });
  }
};

// ✅ POST /api/reviews/order — verified purchase review (after delivery)
export const addOrderReview = async (req, res) => {
  try {
    const { orderId, productId, rating, comment, vendorRating, platformSuggestion } = req.body || {};
    const userId = req.user.id;

    if (!orderId || isNaN(orderId) || !productId || isNaN(productId)) {
      return res.status(400).json({ message: "A valid order and product are required" });
    }
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }
    if (!comment || !comment.trim()) {
      return res.status(400).json({ message: "Please write a review comment" });
    }

    // Order must belong to the user and be delivered to be reviewable.
    const [[order]] = await pool.execute(
      `SELECT id, items, orderStatus, paymentStatus FROM orders WHERE id = ? AND userId = ?`,
      [parseInt(orderId), userId]
    );
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ message: "Only paid orders can be reviewed" });
    }
    if (!['delivered'].includes(order.orderStatus)) {
      return res.status(400).json({ message: "Please wait until the order is delivered before reviewing" });
    }

    // The product must be part of this order.
    const parseItems = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : Array.isArray(v) ? v : []);
    const items = parseItems(order.items);
    const item = items.find((it) =>
      Number(it.product) === Number(productId) ||
      Number(it.productId) === Number(productId) ||
      Number(it.id) === Number(productId)
    );
    if (!item) {
      return res.status(400).json({ message: "That product is not part of this order" });
    }

    // Vendor for the review: prefer the vendor recorded on the item, else the product.
    const [[product]] = await pool.execute(
      "SELECT vendorId FROM product WHERE id = ?",
      [parseInt(productId)]
    );
    const vendorId = item.vendorId || product?.vendorId || null;

    const userName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim();

    const review = await Review.create({
      userId,
      productId: parseInt(productId),
      rating: ratingNum,
      comment: comment.trim(),
      userName,
      orderId: parseInt(orderId),
      vendorId,
      vendorRating:
        vendorRating !== undefined && vendorRating !== null
          ? Math.max(1, Math.min(5, parseInt(vendorRating) || 5))
          : null,
      platformSuggestion: platformSuggestion || null,
      isVerified: 1,
    });

    res.status(201).json({
      message: "Thank you for your review! Verified feedback helps the whole community.",
      review,
    });
  } catch (error) {
    console.error("❌ addOrderReview error:", error.message);
    res.status(500).json({ message: "Failed to save review" });
  }
};

// ✅ GET /api/reviews/analytics — admin: review + vendor satisfaction stats
export const getReviewAnalytics = async (req, res) => {
  try {
    const [stats] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COALESCE(AVG(rating), 0) AS avgRating,
         COALESCE(AVG(vendorRating), 0) AS avgVendorRating,
         COALESCE(SUM(isVerified), 0) AS verifiedCount,
         COALESCE(SUM(CASE WHEN platformSuggestion IS NOT NULL AND platformSuggestion != '' THEN 1 ELSE 0 END), 0) AS suggestionCount
       FROM reviews`
    );

    const [distribution] = await pool.query(
      `SELECT rating, COUNT(*) AS count FROM reviews GROUP BY rating ORDER BY rating`
    );

    const [suggestions] = await pool.query(
      `SELECT r.id, r.platformSuggestion, r.created_at,
              CONCAT(u.firstName, ' ', u.lastName) AS customerName
       FROM reviews r
       LEFT JOIN users u ON u.id = r.userId
       WHERE r.platformSuggestion IS NOT NULL AND r.platformSuggestion != ''
       ORDER BY r.created_at DESC
       LIMIT 50`
    );

    const [ratingMap] = await pool.query(
      `SELECT v.businessName AS vendorName, COALESCE(AVG(r.vendorRating), 0) AS avgRating, COUNT(r.id) AS reviews
       FROM reviews r
       LEFT JOIN vendors v ON v.userId = r.vendorId
       WHERE r.vendorId IS NOT NULL
       GROUP BY r.vendorId
       ORDER BY avgRating DESC`
    );

    res.json({
      total: parseInt(stats[0].total) || 0,
      avgRating: parseFloat(parseFloat(stats[0].avgRating).toFixed(2)),
      avgVendorRating: parseFloat(parseFloat(stats[0].avgVendorRating).toFixed(2)),
      verifiedCount: parseInt(stats[0].verifiedCount) || 0,
      suggestionCount: parseInt(stats[0].suggestionCount) || 0,
      distribution,
      suggestions,
      vendorRatings: ratingMap,
    });
  } catch (error) {
    console.error("❌ getReviewAnalytics error:", error.message);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
};

// ✅ PUT /api/reviews/:id/status - admin moderation
export const updateReviewStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid review id" });

    const { status } = req.body;
    if (!['pending', 'approved', 'hidden'].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const review = await Review.findById(id);
    if (!review) return res.status(404).json({ message: "Review not found" });

    await Review.updateStatus(id, status);
    res.json({ message: `Review ${status}` });
  } catch (error) {
    console.error("❌ updateReviewStatus error:", error.message);
    res.status(500).json({ message: "Failed to update review status" });
  }
};
