// Pages/Vendor/VendorReviews.jsx
// View reviews on vendor's products
import { useState } from 'react';
import { FaStar, FaSearch, FaUser } from 'react-icons/fa';
import { useGetVendorReviewsQuery } from '../../slices/vendorsApiSlice';
import Loader from '../../components/loader/Loader.jsx';

const VendorReviews = () => {
  const { data: reviews = [], isLoading } = useGetVendorReviewsQuery();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredReviews = reviews.filter((r) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (r.productTitle || '').toLowerCase().includes(term) ||
      (r.name || '').toLowerCase().includes(term) ||
      (r.comment || '').toLowerCase().includes(term)
    );
  });

  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : 0;

  if (isLoading) return <div className="py-10 flex items-center justify-center"><Loader /></div>;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Reviews</h2>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-md text-center">
          <p className="text-3xl font-bold text-amber-500">{avgRating}</p>
          <div className="flex justify-center gap-1 mt-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <FaStar key={s} className={`text-sm ${s <= Math.round(avgRating) ? 'text-amber-400' : 'text-gray-300'}`} />
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-1">Average Rating</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-md text-center">
          <p className="text-3xl font-bold text-blue-600">{reviews.length}</p>
          <p className="text-sm text-gray-500 mt-1">Total Reviews</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-md text-center">
          <p className="text-3xl font-bold text-green-600">{reviews.filter((r) => r.rating >= 4).length}</p>
          <p className="text-sm text-gray-500 mt-1">Positive (4-5★)</p>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        <div className="relative">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search reviews..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {/* Reviews List */}
      {filteredReviews.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
          <FaStar className="text-4xl text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No reviews yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredReviews.map((review) => (
            <div key={review.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    {review.profile_picture ? (
                      <img src={review.profile_picture} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <FaUser className="text-gray-400" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{review.name || 'Anonymous'}</p>
                    <p className="text-xs text-gray-500">{review.productTitle || 'Unknown Product'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <FaStar key={s} className={`text-sm ${s <= review.rating ? 'text-amber-400' : 'text-gray-300'}`} />
                  ))}
                </div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">{review.comment}</p>
              <p className="text-xs text-gray-400 mt-2">{new Date(review.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VendorReviews;
