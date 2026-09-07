// Pages/Vendor/VendorReturns.jsx
// View return requests for vendor's products
import { useState } from 'react';
import { FaUndo, FaSearch } from 'react-icons/fa';
import { useGetVendorReturnsQuery } from '../../slices/vendorsApiSlice';
import Loader from '../../components/loader/Loader';
import type { ReturnRequest } from '../../slices/apiTypes';

interface VendorReturnRow extends ReturnRequest {
  orderNumber?: string;
  firstName?: string;
  lastName?: string;
  totalAmount?: number | string;
  created_at?: string;
}

const statusBadge: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
};

const reasonLabels: Record<string, string> = {
  damaged: 'Damaged',
  wrong_item: 'Wrong Item',
  not_as_described: 'Not as Described',
  changed_mind: 'Changed Mind',
  other: 'Other',
};

const VendorReturns = () => {
  const { data: returns = [], isLoading } = useGetVendorReturnsQuery() as {
    data?: VendorReturnRow[];
    isLoading: boolean;
  };
  const [searchTerm, setSearchTerm] = useState('');

  const filteredReturns = returns.filter((r: VendorReturnRow) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (r.orderNumber || '').toLowerCase().includes(term) ||
      (r.firstName || '').toLowerCase().includes(term) ||
      (r.lastName || '').toLowerCase().includes(term)
    );
  });

  if (isLoading) return <div className="py-10 flex items-center justify-center"><Loader /></div>;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Returns</h2>

      {/* Search */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        <div className="relative">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order #, customer name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {filteredReturns.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
          <FaUndo className="text-4xl text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No return requests</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 text-left text-gray-500 dark:text-gray-400">
                  <th className="px-6 py-3">Order</th>
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Reason</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredReturns.map((r: VendorReturnRow) => (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 font-mono text-xs">{r.orderNumber || `#${r.orderId}`}</td>
                    <td className="px-6 py-4 text-gray-900 dark:text-white">{r.firstName} {r.lastName}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{reasonLabels[r.reason || ''] || r.reason}</td>
                    <td className="px-6 py-4 font-semibold">GH₵{parseFloat(String(r.totalAmount || 0)).toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge[r.status || ''] || statusBadge.pending}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(r.created_at || '').toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorReturns;
