// Pges/adminDashboardPages/Vendors/VendorsPage.jsx
import { useState, useCallback } from 'react';
import { FaStore, FaSpinner, FaSearch, FaCheck, FaBan } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetAllVendorsQuery,
  useUpdateVendorStatusMutation,
} from '../../../slices/vendorsApiSlice';

const statusBadge = (status) => {
  const map = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    suspended: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };
  return map[status] || map.pending;
};

const formatDate = (d) => {
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return 'N/A';
  }
};

const maskAccount = (acc) => {
  if (!acc) return '—';
  return acc.length > 4 ? `•••• ${acc.slice(-4)}` : acc;
};

const VendorsPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const { data: vendors = [], isLoading, error, refetch } = useGetAllVendorsQuery(
    { status: filterStatus === 'all' ? undefined : filterStatus, search: searchQuery || undefined },
    { skipPollingIfUnfocused: true }
  );
  const [updateVendorStatus, { isLoading: updating }] = useUpdateVendorStatusMutation();

  const handleStatus = useCallback(async (id, status) => {
    try {
      await updateVendorStatus({ id, status }).unwrap();
      toast.success(`Vendor ${status}`);
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update vendor status');
    }
  }, [updateVendorStatus, refetch]);

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <FaSpinner className="animate-spin h-12 w-12 text-indigo-600 mx-auto" />
        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading vendors...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
        <p className="text-red-600 dark:text-red-400 font-medium">
          Error: {error?.data?.message || 'Failed to load vendors'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Vendor Management</h2>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search by business name, contact, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-gray-800 dark:text-white"
          />
          <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {vendors.length === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">
            <FaStore className="mx-auto text-4xl mb-4 opacity-50" />
            <p>No vendors found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="p-4">Business</th>
                  <th>Contact</th>
                  <th>Bank Account</th>
                  <th>Fee</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-4">
                      <p className="font-medium text-gray-800 dark:text-white">{v.businessName}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {v.firstName} {v.lastName} · {v.email}
                      </p>
                    </td>
                    <td className="text-sm text-gray-800 dark:text-white">{v.contactPhone || '—'}</td>
                    <td className="text-sm text-gray-800 dark:text-white">
                      {v.bankName}
                      <span className="text-gray-500 dark:text-gray-400"> ({maskAccount(v.accountNumber)})</span>
                    </td>
                    <td className="text-sm text-gray-800 dark:text-white">
                      {((parseFloat(v.platformFeeRate) || 0) * 100).toFixed(1)}%
                    </td>
                    <td className="text-sm text-gray-800 dark:text-white">{formatDate(v.created_at)}</td>
                    <td>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge(v.status)}`}>
                        {v.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        {v.status !== 'approved' && (
                          <button
                            onClick={() => handleStatus(v.id, 'approved')}
                            disabled={updating}
                            className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900 rounded"
                            title="Approve"
                          >
                            <FaCheck />
                          </button>
                        )}
                        {v.status === 'approved' && (
                          <button
                            onClick={() => handleStatus(v.id, 'suspended')}
                            disabled={updating}
                            className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded"
                            title="Suspend"
                          >
                            <FaBan />
                          </button>
                        )}
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

export default VendorsPage;