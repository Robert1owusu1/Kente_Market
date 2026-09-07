// FILE LOCATION: src/Pages/Reviews/ReviewsPage.jsx
// DESCRIPTION: Dedicated /reviews page showing all customer reviews site-wide.
import React from "react";
import { FaStar, FaRegStar, FaUser, FaQuoteLeft, FaSpinner } from "react-icons/fa";
import { Link } from "react-router-dom";
import { useGetAllReviewsQuery } from "../../slices/miscApiSlice";

interface ReviewView {
  id?: number | string;
  rating: number;
  profile_picture?: string;
  profilePicture?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  comment?: string;
  productId?: number | string;
  productTitle?: string;
  created_at?: string;
  [key: string]: unknown;
}

const StarDisplay = ({ value }: { value: number | string }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((star) =>
      star <= Math.round(Number(value) || 0) ? (
        <FaStar key={star} className="text-amber-400 text-sm" />
      ) : (
        <FaRegStar key={star} className="text-gray-400 text-sm" />
      )
    )}
  </div>
);

const formatDate = (d: string | number) => {
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
};

const ReviewsPage = () => {
  const { data: reviewData = [], isLoading, isError } = useGetAllReviewsQuery();
  const reviews = (reviewData as unknown as ReviewView[]);

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 py-12 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Customer Reviews</h1>
          <p className="text-gray-400 mt-3 max-w-2xl mx-auto">
            Hear from our community about the quality, craftsmanship, and authenticity of our handwoven Kente cloth.
          </p>
          {reviews.length > 0 && (
            <div className="mt-5 inline-flex items-center gap-3 bg-white/10 border border-white/10 rounded-full px-6 py-3">
              <span className="text-3xl font-bold text-yellow-400">{avgRating}</span>
              <div>
                <StarDisplay value={avgRating} />
                <p className="text-xs text-gray-400">based on {reviews.length} reviews</p>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <FaSpinner className="animate-spin text-4xl text-yellow-400" />
          </div>
        ) : isError ? (
          <p className="text-center text-red-400">Failed to load reviews.</p>
        ) : reviews.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <FaQuoteLeft className="text-4xl mx-auto mb-4 opacity-40" />
            <p>No reviews yet. Be the first to share your experience after your next purchase!</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {reviews.map((review) => (
              <div
                key={review.id}
                className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-3 hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {review.profile_picture || review.profilePicture ? (
                    <img
                      src={review.profile_picture || review.profilePicture}
                      alt={review.name}
                      className="w-11 h-11 rounded-full object-cover"
                      onError={(e) => { const t = e.target as HTMLImageElement; t.onerror = null; t.style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center">
                      <FaUser className="text-gray-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">
                      {review.name || `${review.firstName || ""} ${review.lastName || ""}`.trim() || "Anonymous"}
                    </p>
                    <p className="text-xs text-gray-400">{formatDate(review.created_at || '')}</p>
                  </div>
                </div>

                <StarDisplay value={review.rating} />

                {review.comment && (
                  <p className="text-sm text-gray-300 leading-relaxed flex-1">
                    {review.comment}
                  </p>
                )}

                {review.productId && (
                  <Link
                    to={`/product/${review.productId}`}
                    className="text-xs text-yellow-400 hover:underline mt-2"
                  >
                    {review.productTitle || "View product"} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReviewsPage;
