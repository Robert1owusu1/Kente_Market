import React, { useState } from 'react';
import { FaSpinner, FaCheck, FaEyeSlash, FaTrash, FaFlag, FaStar } from 'react-icons/fa';
import { toast } from 'react-toastify';
import axios from 'axios';
import { useGetAllReviewsQuery } from '../../../slices/miscApiSlice';
import { useGetAllReportsQuery, useUpdateReportStatusMutation } from '../../../slices/reportsApiSlice';

const statusTabs = ['all', 'pending', 'approved', 'hidden'];

const statusBadge = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  hidden: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(dateString));
  } catch {
    return 'Invalid Date';
  }
};

const StarRating = ({ rating }) => {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className={star <= rating ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}>
          {star <= rating ? <FaStar /> : <FaStar />}
        </span>
      ))}
    </div>
  );
};

const ReviewsAdminPage = () => {
  const { data: reviews = [], isLoading } = useGetAllReviewsQuery();
  const { data: reports = [] } = useGetAllReportsQuery();
  const [updateReportStatus] = useUpdateReportStatusMutation();

  const [statusFilter, setStatusFilter] = useState('all');
  const [showReports, setShowReports] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const filtered = reviews.filter((r) => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  const reportedReviews = reports.filter((r) => r.status === 'pending');

  const handleStatusUpdate = async (reviewId, status) => {
    setUpdatingId(reviewId);
    try {
      await axios.put(`/api/reviews/${reviewId}/status`, { status });
      toast.success(`Review ${status}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update review status');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (reviewId) => {
    if (!window.confirm('Are you sure you want to delete this review? This action cannot be undone.')) return;
    setUpdatingId(reviewId);
    try {
      await axios.delete(`/api/reviews/${reviewId}`);
      toast.success('Review deleted successfully');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete review');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleReportAction = async (reportId, status) => {
    try {
      await updateReportStatus({ id: reportId, status }).unwrap();
      toast.success(`Report ${status}`);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update report');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Review Moderation</h2>
          <p className="text-sm text-gray-500 mt-1">Moderate customer reviews and manage reports</p>
        </div>
        {reportedReviews.length > 0 && (
          <button
            onClick={() => setShowReports(!showReports)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
          >
            <FaFlag /> {reportedReviews.length} Reported
          </button>
        )}
      </div>

      {/* Reports Section */}
      {showReports && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Reported Reviews</h3>
          {reportedReviews.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No pending reports</p>
          ) : (
            <div className="space-y-3">
              {reportedReviews.map((report) => (
                <div key={report.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Review #{report.reviewId} — {report.reason || 'No reason'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Reported by user #{report.userId || 'N/A'} • {formatDate(report.createdAt || report.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReportAction(report.id, 'dismissed')}
                      className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={() => {
                        handleReportAction(report.id, 'resolved');
                        handleStatusUpdate(report.reviewId, 'hidden');
                      }}
                      className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Hide Review
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition ${
              statusFilter === tab
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Reviews Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <FaSpinner className="animate-spin h-8 w-8 text-indigo-600 mx-auto" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading reviews...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">
            <FaStar className="mx-auto text-4xl mb-4 opacity-50" />
            <p>No reviews to moderate</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Rating</th>
                  <th className="px-4 py-3">Comment</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((review) => (
                  <tr key={review.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white max-w-[150px] truncate">
                      {review.productTitle || review.productName || `#${review.productId}`}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {review.userName || review.customerName || review.email || 'Anonymous'}
                    </td>
                    <td className="px-4 py-3">
                      <StarRating rating={review.rating} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-xs truncate">
                      {review.comment || review.text || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge[review.status] || statusBadge.pending}`}>
                        {review.status || 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {formatDate(review.createdAt || review.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {review.status !== 'approved' && (
                          <button
                            onClick={() => handleStatusUpdate(review.id, 'approved')}
                            disabled={updatingId === review.id}
                            className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900 rounded disabled:opacity-50"
                            title="Approve"
                          >
                            <FaCheck />
                          </button>
                        )}
                        {review.status !== 'hidden' && (
                          <button
                            onClick={() => handleStatusUpdate(review.id, 'hidden')}
                            disabled={updatingId === review.id}
                            className="p-2 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900 rounded disabled:opacity-50"
                            title="Hide"
                          >
                            <FaEyeSlash />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(review.id)}
                          disabled={updatingId === review.id}
                          className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded disabled:opacity-50"
                          title="Delete"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReviewsAdminPage;
