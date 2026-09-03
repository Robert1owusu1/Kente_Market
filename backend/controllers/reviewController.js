// FILE LOCATION: backend/controllers/reviewController.js
// DESCRIPTION: Product reviews (create, list by product, list all)
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
    res.status(500).json({ message: error.message || "Failed to save review" });
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
    res.status(500).json({ message: error.message || "Failed to fetch reviews" });
  }
};

// ✅ GET /api/reviews - all reviews (public)
export const getAllReviews = async (req, res) => {
  try {
    const reviews = await Review.findAll(req.query.limit);
    res.json(reviews);
  } catch (error) {
    console.error("❌ getAllReviews error:", error.message);
    res.status(500).json({ message: error.message || "Failed to fetch reviews" });
  }
};
