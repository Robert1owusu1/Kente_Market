// Pges/Vendor/VendorDashboard.jsx
import { Link } from 'react-router-dom';
import { useGetMyVendorProfileQuery } from '../../slices/vendorsApiSlice';
import Loader from '../../components/loader/Loader.jsx';
import {
  FaStore,
  FaShieldAlt,
  FaCheckCircle,
  FaClock,
  FaExclamationTriangle,
  FaPlus,
} from 'react-icons/fa';

const fmt = (n) => `GH₵${(parseFloat(n) || 0).toFixed(2)}`;

const statusBadge = (status) => {
  const map = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };
  return map[status] || map.pending;
};

const allocationBadge = (status) => {
  const map = {
    pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    held: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    releasing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    released: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };
  return map[status] || map.pending;
};

const VendorDashboard = () => {
  const { data, isLoading, isError, error } = useGetMyVendorProfileQuery();

  if (isLoading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader /></div>;
  }

  // No vendor profile yet
  if (isError || !data?.vendor) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <FaStore className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-6" />
        <h1 className="text-2xl font-bold mb-4">Start Selling on Bonwire</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Register as a seller to list your Kente &amp; fabric products and get paid securely via escrow.
        </p>
        <Link to="/vendor/apply" className="inline-flex items-center gap-2 bg-primary text-white px-8 py-3 rounded-lg hover:bg-primary/90 font-semibold">
          <FaPlus /> Become a Seller
        </Link>
      </div>
    );
  }

  const { vendor, summary = {}, payouts = [] } = data;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <FaStore className="text-xl text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">{vendor.businessName}</h1>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge(vendor.status)}`}>
              {vendor.status}
            </span>
          </div>
        </div>
        <Link to="/vendor/apply" className="text-primary hover:underline text-sm">Edit bank details</Link>
      </div>

      {vendor.status === 'pending' && (
        <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
          <FaClock className="text-amber-500" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Your seller application is under review. You will be able to add products once approved.
          </p>
        </div>
      )}

      {vendor.status === 'suspended' && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <FaExclamationTriangle className="text-red-500" />
          <p className="text-sm text-red-800 dark:text-red-300">
            Your seller account is suspended. Please contact support.
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <FaShieldAlt className="text-amber-500" /> Held in escrow
          </p>
          <p className="text-2xl font-bold mt-1">{fmt(summary.pendingPayout)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <FaCheckCircle className="text-green-500" /> Released
          </p>
          <p className="text-2xl font-bold mt-1">{fmt(summary.releasedPayout)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <FaExclamationTriangle className="text-red-400" /> Failed payouts
          </p>
          <p className="text-2xl font-bold mt-1">{parseInt(summary.failedCount) || 0}</p>
        </div>
      </div>

      {/* Payout history */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 sm:p-6 mb-8">
        <h2 className="font-semibold text-lg mb-4">Escrow payouts</h2>
        {payouts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No payouts yet. They appear here once customers place orders with your products.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-4">Order</th>
                  <th className="pb-2 pr-4">Placed</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Fee</th>
                  <th className="pb-2 pr-4">Payout</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs">{p.orderNumber}</td>
                    <td className="py-3 pr-4">{new Date(p.orderPlacedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</td>
                    <td className="py-3 pr-4">{fmt(p.amount)}</td>
                    <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">- {fmt(p.platformFee)}</td>
                    <td className="py-3 pr-4 font-semibold">{fmt(p.payoutAmount)}</td>
                    <td className="py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${allocationBadge(p.status)}`}>
                        {p.status}
                      </span>
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

export default VendorDashboard;