import React, { useState } from 'react';
import { FaSpinner, FaExchangeAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetAllReturnsQuery,
  useUpdateReturnStatusMutation,
} from '../../../slices/returnsApiSlice';

const statusTabs = ['all', 'pending', 'approved', 'rejected'];

const statusBadge = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
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

const ReturnsPage = () => {
  const { data: returns = [], isLoading } = useGetAllReturnsQuery();
  const [updateReturnStatus] = useUpdateReturnStatusMutation();

  const [statusFilter, setStatusFilter] = useState('all');
  const [updatingId, setUpdatingId] = useState(null);
  const [notes, setNotes] = useState({});

  const filtered = returns.filter((r) => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  const handleStatusUpdate = async (id, status) => {
    if (!window.confirm(`Are you sure you want to ${status} this return request?`)) return;
    setUpdatingId(id);
    try {
      await updateReturnStatus({ id, status, adminNotes: notes[id] || '' }).unwrap();
      toast.success(`Return request ${status}`);
      setNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update return status');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Return Requests</h2>
          <p className="text-sm text-gray-500 mt-1">Manage customer return and refund requests</p>
        </div>
      </div>

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

      {/* Returns Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <FaSpinner className="animate-spin h-8 w-8 text-indigo-600 mx-auto" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading returns...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">
            <FaExchangeAlt className="mx-auto text-4xl mb-4 opacity-50" />
            <p>{statusFilter === 'all' ? 'No return requests' : `No ${statusFilter} return requests`}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="px-4 py-3">Order ID</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ret) => (
                  <tr key={ret.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                      #{ret.orderId}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {ret.customerName || ret.userName || ret.email || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-xs truncate">
                      {ret.reason || 'No reason provided'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge[ret.status] || statusBadge.pending}`}>
                        {ret.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {formatDate(ret.createdAt || ret.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {ret.status === 'pending' ? (
                        <div className="flex flex-col gap-2 min-w-[200px]">
                          <textarea
                            value={notes[ret.id] || ''}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [ret.id]: e.target.value }))}
                            placeholder="Admin notes (optional)"
                            rows={2}
                            className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-600 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleStatusUpdate(ret.id, 'approved')}
                              disabled={updatingId === ret.id}
                              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {updatingId === ret.id ? '...' : 'Approve'}
                            </button>
                            <button
                              onClick={() => handleStatusUpdate(ret.id, 'rejected')}
                              disabled={updatingId === ret.id}
                              className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              {updatingId === ret.id ? '...' : 'Reject'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {ret.adminNotes || '—'}
                        </span>
                      )}
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

export default ReturnsPage;
