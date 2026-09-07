// Pages/adminDashboardPages/Vendors/VendorsPage.jsx
import { useState, useCallback } from 'react';
import { FaStore, FaSpinner, FaSearch, FaCheck, FaBan, FaAward, FaTimes } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetAllVendorsQuery,
  useUpdateVendorStatusMutation,
} from '../../../slices/vendorsApiSlice';
import { useUpdateVendorVerificationMutation } from '../../../slices/marketplaceApiSlice';

const VERIFICATION_LEVELS = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'trusted_artisan', label: 'Trusted Artisan' },
  { value: 'master_weaver', label: 'Master Weaver' },
];

const ALL_BADGES = [
  'top_weaver',
  'verified_vendor',
  'best_seller',
  'international_seller',
  'five_star_vendor',
  'master_artisan',
];

interface VendorRow {
  id: number | string;
  businessName: string;
  firstName: string;
  lastName: string;
  email: string;
  contactPhone: string;
  payoutType: string;
  momoProvider: string;
  momoNumber: string;
  bankName: string;
  accountNumber: string;
  platformFeeRate: string | number;
  created_at: string;
  status: string;
  verificationLevel: string;
  badges: string[] | string;
}

interface VendorEditor {
  vendor: VendorRow;
  level: string;
  badges: string[];
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    suspended: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };
  return map[status] || map.pending;
};

const formatDate = (d: string) => {
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return 'N/A';
  }
};

const maskAccount = (acc: string) => {
  if (!acc) return '—';
  return acc.length > 4 ? `•••• ${acc.slice(-4)}` : acc;
};

const VendorsPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [editor, setEditor] = useState<VendorEditor | null>(null);

  const { data: vendors = [], isLoading, error, refetch } = useGetAllVendorsQuery(
    { status: filterStatus === 'all' ? undefined : filterStatus, search: searchQuery || undefined },
    { skipPollingIfUnfocused: true }
  );
  const [updateVendorStatus, { isLoading: updating }] = useUpdateVendorStatusMutation();
  const [updateVerification, { isLoading: savingVerification }] = useUpdateVendorVerificationMutation();

  const handleStatus = useCallback(async (id: number | string, status: string) => {
    try {
      await updateVendorStatus({ id, status }).unwrap();
      toast.success(`Vendor ${status}`);
      refetch();
    } catch (error) {
      const err = error as { data?: { message?: string }; message?: string } | undefined;
      toast.error(err?.data?.message || 'Failed to update vendor status');
    }
  }, [updateVendorStatus, refetch]);

  const openEditor = (v: VendorRow) => {
    let badges: string[] | string = v.badges;
    if (typeof badges === 'string') { try { badges = JSON.parse(badges || '[]'); } catch { badges = []; } }
    setEditor({ vendor: v, level: v.verificationLevel || 'pending', badges: Array.isArray(badges) ? badges : [] });
  };

  const toggleBadge = (b: string) =>
    setEditor((prev) => prev ? ({
      ...prev,
      badges: prev.badges.includes(b) ? prev.badges.filter((x) => x !== b) : [...prev.badges, b],
    }) : prev);

  const saveVerification = async () => {
    if (!editor) return;
    try {
      await updateVerification({ id: editor.vendor.id, level: editor.level, badges: editor.badges }).unwrap();
      toast.success('Verification level updated');
      setEditor(null);
      refetch();
    } catch (error) {
      const err = error as { data?: { message?: string }; message?: string } | undefined;
      toast.error(err?.data?.message || 'Failed to update verification');
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <FaSpinner className="animate-spin h-12 w-12 text-indigo-600 mx-auto" />
        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading vendors...</p>
      </div>
    );
  }

  if (error) {
    const errData = error as { data?: { message?: string }; message?: string };
    return (
      <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
        <p className="text-red-600 dark:text-red-400 font-medium">
          Error: {errData?.data?.message || 'Failed to load vendors'}
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
                  <th>Payout Method</th>
                  <th>Fee</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th>Verified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => {
                  const vr = v as unknown as VendorRow;
                  return (
                    <tr key={vr.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="p-4">
                        <p className="font-medium text-gray-800 dark:text-white">{vr.businessName}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {vr.firstName} {vr.lastName} · {vr.email}
                        </p>
                      </td>
                      <td className="text-sm text-gray-800 dark:text-white">{vr.contactPhone || '—'}</td>
                      <td className="text-sm text-gray-800 dark:text-white">
                        {vr.payoutType === 'momo' ? (
                          <>
                            {vr.momoProvider}
                            <span className="text-gray-500 dark:text-gray-400"> (Momo · {maskAccount(vr.momoNumber)})</span>
                          </>
                        ) : (
                          <>
                            {vr.bankName}
                            <span className="text-gray-500 dark:text-gray-400"> ({maskAccount(vr.accountNumber)})</span>
                          </>
                        )}
                      </td>
                      <td className="text-sm text-gray-800 dark:text-white">
                        {((parseFloat(String(vr.platformFeeRate)) || 0) * 100).toFixed(1)}%
                      </td>
                      <td className="text-sm text-gray-800 dark:text-white">{formatDate(vr.created_at)}</td>
                      <td>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge(vr.status)}`}>
                          {vr.status}
                        </span>
                      </td>
                      <td className="text-sm">
                        <span className="capitalize text-gray-800 dark:text-white">
                          {(vr.verificationLevel || 'pending').replace('_', ' ')}
                        </span>
                        {(Array.isArray(vr.badges) ? vr.badges : []).filter(Boolean).length > 0 && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{(Array.isArray(vr.badges) ? vr.badges : []).join(', ')}</p>
                        )}
                      </td>
                      <td>
                        <div className="flex gap-2">
                          {vr.status !== 'approved' && (
                            <button
                              onClick={() => handleStatus(vr.id, 'approved')}
                              disabled={updating}
                              className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900 rounded"
                              title="Approve"
                            >
                              <FaCheck />
                            </button>
                          )}
                          {vr.status === 'approved' && (
                            <button
                              onClick={() => handleStatus(vr.id, 'suspended')}
                              disabled={updating}
                              className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded"
                              title="Suspend"
                            >
                              <FaBan />
                            </button>
                          )}
                          {vr.status === 'approved' && (
                            <button
                              onClick={() => openEditor(vr)}
                              className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded"
                              title="Manage verification level & badges"
                            >
                              <FaAward />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setEditor(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <FaAward /> {editor.vendor.businessName}
              </h3>
              <button onClick={() => setEditor(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <FaTimes />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Verification level</label>
                <select
                  value={editor.level}
                  onChange={(e) => setEditor((prev) => prev ? ({ ...prev, level: e.target.value }) : prev)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                >
                  {VERIFICATION_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Badges</label>
                <div className="space-y-2">
                  {ALL_BADGES.map((b) => (
                    <label key={b} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={editor.badges.includes(b)}
                        onChange={() => toggleBadge(b)}
                        className="w-4 h-4 accent-indigo-600"
                      />
                      {b.replace(/_/g, ' ')}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditor(null)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={saveVerification}
                  disabled={savingVerification}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {savingVerification ? <FaSpinner className="animate-spin" /> : <FaCheck />} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorsPage;
