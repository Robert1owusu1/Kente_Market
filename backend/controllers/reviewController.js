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
