// FILE LOCATION: src/components/reviews/ProductReviews.jsx
// DESCRIPTION: Review section for a single product - shows the average rating,
//              lists existing reviews, and lets logged-in users submit a review.
import React, { useState } from "react";
import { FaStar, FaRegStar, FaUser, FaSpinner } from "react-icons/fa";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  useGetProductReviewsQuery,
  useCreateReviewMutation,
} from "../../slices/miscApiSlice";

const StarRatingInput = ({ value, onChange, disabled }) => {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => !disabled && onChange(star)}
          disabled={disabled}
          aria-label={`${star} star`}
          className={`text-2xl transition-colors ${disabled ? "cursor-not-allowed" : "cursor-pointer hover:scale-110"}`}
        >
          {star <= value ? (
            <FaStar className="text-amber-400" />
          ) : (
            <FaRegStar className="text-gray-400" />
          )}
        </button>
      ))}
    </div>
  );
};

const StarDisplay = ({ value }) => {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star}>
          {star <= Math.round(value || 0) ? (
            <FaStar className="text-amber-400 text-sm" />
          ) : (
            <FaRegStar className="text-gray-400 text-sm" />
          )}
        </span>
      ))}
    </div>
  );
};

const formatDate = (d) => {
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
};

const getAvatar = (review) => {
  const pic = review.profile_picture || review.profilePicture;
  if (pic) return pic;
  return null;
};

const ProductReviews = ({ productId, productTitle }) => {
  const { userInfo } = useSelector((state) => state.auth);
  const { data: reviews = [], isLoading } = useGetProductReviewsQuery(productId, {
    skip: !productId,
  });
  const [createReview, { isLoading: submitting }] = useCreateReviewMutation();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rating < 1) {
      toast.error("Please select a star rating");
      return;
    }
    if (!comment.trim()) {
      toast.error("Please write a review");
      return;
    }
    try {
      await createReview({ productId, rating, comment }).unwrap();
      toast.success("Thank you for your review!");
      setRating(0);
      setComment("");
    } catch (err) {
      toast.error(err?.data?.message || "Failed to submit review");
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-5 sm:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b dark:border-gray-700 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Customer Reviews</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
          </p>
        </div>
        {reviews.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{avgRating}</span>
            <div>
              <StarDisplay value={avgRating} />
              <p className="text-xs text-gray-500 dark:text-gray-400">Average rating</p>
            </div>
          </div>
        )}
      </div>

      {/* Review form */}
      {userInfo ? (
        <form onSubmit={handleSubmit} className="border-b dark:border-gray-700 py-6 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">Write a Review</h3>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-300">Your rating:</span>
            <StarRatingInput value={rating} onChange={setRating} disabled={submitting} />
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows="3"
            placeholder="Share your experience with this product..."
            className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-yellow-400 text-black font-semibold rounded-lg hover:bg-yellow-500 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting ? (
              <>
                <FaSpinner className="animate-spin" /> Submitting...
              </>
            ) : (
              "Submit Review"
            )}
          </button>
        </form>
      ) : (
        <div className="border-b dark:border-gray-700 py-6">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <Link to="/login" className="text-yellow-500 hover:underline font-medium">
              Sign in
            </Link>{" "}
            to write a review.
          </p>
        </div>
      )}

      {/* Reviews list */}
      <div className="pt-6 space-y-6">
        {isLoading ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-4">Loading reviews...</p>
        ) : reviews.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-4">
            No reviews yet. Be the first to share your experience!
          </p>
        ) : (
          reviews.map((review) => (
            <div key={review.id} className="flex gap-4">
              <div className="flex-shrink-0">
                {getAvatar(review) ? (
                  <img
                    src={getAvatar(review)}
                    alt={review.name}
                    className="w-10 h-10 rounded-full object-cover"
                    onError={(e) => { e.target.onerror = null; e.target.style.display = "none"; }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                    <FaUser className="text-gray-500 dark:text-gray-400" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {review.name || `${review.firstName || ""} ${review.lastName || ""}`.trim() || "Anonymous"}
                  </p>
                  <span className="text-xs text-gray-400">{formatDate(review.created_at)}</span>
                </div>
                <div className="mt-1">
                  <StarDisplay value={review.rating} />
                </div>
                {review.comment && (
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{review.comment}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ProductReviews;
