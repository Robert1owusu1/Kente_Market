import React from 'react';
import { FaSpinner, FaEnvelope, FaDownload } from 'react-icons/fa';
import { useListSubscribersQuery, useGetSubscriberCountQuery } from '../../../slices/miscApiSlice';

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

const SubscribersPage = () => {
  const { data: subscribers = [], isLoading } = useListSubscribersQuery();
  const { data: countData, isLoading: countLoading } = useGetSubscriberCountQuery();

  const totalSubscribers = countData?.count ?? subscribers.length;

  const handleExportCSV = () => {
    const header = 'ID,Email,Subscribed,Created At\n';
    const rows = subscribers
      .map((s) => `${s.id},"${(s.email || '').replace(/"/g, '""')}",${s.subscribed ? 'Yes' : 'No'},${s.created_at || ''}`)
      .join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'subscribers.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Subscriber Management</h2>
          <p className="text-sm text-gray-500 mt-1">View and manage newsletter subscribers</p>
        </div>
        <button
          onClick={handleExportCSV}
          disabled={subscribers.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition font-semibold"
        >
          <FaDownload /> Export CSV
        </button>
      </div>

      {/* Subscriber Count Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
              <FaEnvelope className="text-indigo-600 text-xl" />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Subscribers</p>
              <p className="text-2xl font-bold text-indigo-600">
                {countLoading ? '...' : totalSubscribers}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <FaEnvelope className="text-green-600 text-xl" />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Active Subscribers</p>
              <p className="text-2xl font-bold text-green-600">
                {subscribers.filter((s) => s.subscribed).length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <FaEnvelope className="text-gray-500 text-xl" />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Unsubscribed</p>
              <p className="text-2xl font-bold text-gray-600 dark:text-gray-300">
                {subscribers.filter((s) => !s.subscribed).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Subscribers Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <FaSpinner className="animate-spin h-8 w-8 text-indigo-600 mx-auto" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading subscribers...</p>
          </div>
        ) : subscribers.length === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">
            <FaEnvelope className="mx-auto text-4xl mb-4 opacity-50" />
            <p>No subscribers yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Subscribed</th>
                  <th className="px-4 py-3">Date Joined</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((sub) => (
                  <tr key={sub.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                      {sub.email}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        sub.subscribed
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                      }`}>
                        {sub.subscribed ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {formatDate(sub.created_at || sub.createdAt)}
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

export default SubscribersPage;
