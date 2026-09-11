// Pages/adminDashboardPages/Moderation/ModerationPage.jsx
// Admin product moderation queue: approve, reject or request changes.
import { useState } from 'react';
import { FaCheck, FaTimes, FaExclamationTriangle, FaSpinner, FaClipboardCheck } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetModerationProductsQuery,
  useGetModerationStatsQuery,
  useModerateProductMutation,
} from '../../../slices/marketplaceApiSlice';
import { resolveImageUrl } from '../../../utils/imageUrl';
import type { Product } from '../../../types/domain';

interface ProductRow extends Product {
  businessName?: string;
}

const errorMessage = (err: unknown): string | undefined =>
  (err as { data?: { message?: string }; message?: string; error?: string })?.data?.message;

const STATUSES = [
  { value: 'pending', label: 'Pending', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  { value: 'approved', label: 'Approved', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  { value: 'rejected', label: 'Rejected', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  { value: 'changes_requested', label: 'Changes Requested', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
];

const formatDate = (d: string) => {
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return 'N/A';
  }
};

const ModerationPage = () => {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [note, setNote] = useState('');
  const [targetId, setTargetId] = useState<number | string | null>(null);

  const { data: rawProducts = [], isLoading, isError, refetch } = useGetModerationProductsQuery(statusFilter);
  const products = rawProducts as ProductRow[];
  const { data: statsData } = useGetModerationStatsQuery();
  const [moderate, { isLoading: moderating }] = useModerateProductMutation();

  const stats = statsData || {};
  const statCards = [
    { label: 'Pending', value: stats.pending ?? 0, cls: 'text-amber-600' },
    { label: 'Approved', value: stats.approved ?? 0, cls: 'text-green-600' },
    { label: 'Rejected', value: stats.rejected ?? 0, cls: 'text-red-600' },
    { label: 'Changes Requested', value: stats.changes_requested ?? 0, cls: 'text-blue-600' },
  ];

  const handleModerate = async (product: ProductRow, status: string) => {
    if (status !== 'approved' && !note.trim()) {
      toast.error('A note/reason is required');
      return;
    }
    try {
      await moderate({ id: product.id, status, note: note.trim() || undefined }).unwrap();
      toast.success(`Product ${status.replace('_', ' ')}`);
      setNote('');
      setTargetId(null);
      refetch();
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to moderate product');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Product Moderation</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-md text-center">
            <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              statusFilter === s.value
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="p-8 text-center"><FaSpinner className="animate-spin h-10 w-10 text-indigo-600 mx-auto" /></div>
      )}

      {isError && (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-red-600 dark:text-red-400 font-medium">Failed to load moderation queue.</p>
        </div>
      )}

      {!isLoading && !isError && products.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
          <FaClipboardCheck className="mx-auto text-4xl mb-4 opacity-50" />
          <p>No products with status "{statusFilter.replace('_', ' ')}".</p>
        </div>
      )}

      <div className="space-y-4">
        {products.map((p) => (
          <div key={p.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
            <div className="flex flex-col md:flex-row gap-4">
              {p.img ? (
                <img src={resolveImageUrl(p.img)} alt={p.title} className="w-24 h-24 rounded-lg object-cover" />
              ) : (
                <div className="w-24 h-24 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 text-xs">No image</div>
              )}
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-gray-900 dark:text-white">{p.title}</h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUSES.find((s) => s.value === p.approvalStatus)?.cls || 'bg-gray-100 text-gray-600'}`}>
                    {(p.approvalStatus as string).replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {p.businessName || `Vendor #${p.vendorId}`} · {p.category || 'Uncategorised'} · GH₵ {p.price}
                </p>
                {p.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{p.description}</p>
                )}
                {p.approvalNote && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 italic">Note: {p.approvalNote}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">Listed {formatDate(p.created_at as string)}</p>
              </div>
              {p.approvalStatus === 'pending' && (
                <div className="md:w-72 space-y-2">
                  <textarea
                    value={targetId === p.id ? note : ''}
                    onChange={(e) => { setTargetId(p.id); setNote(e.target.value); }}
                    rows={2}
                    placeholder="Approval note / rejection reason..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleModerate(p, 'approved')}
                      disabled={moderating}
                      className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700 disabled:opacity-60 inline-flex items-center justify-center gap-1"
                    >
                      {moderating ? <FaSpinner className="animate-spin" /> : <FaCheck />} Approve
                    </button>
                    <button
                      onClick={() => handleModerate(p, 'rejected')}
                      disabled={moderating}
                      className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700 disabled:opacity-60 inline-flex items-center justify-center gap-1"
                    >
                      <FaTimes /> Reject
                    </button>
                    <button
                      onClick={() => handleModerate(p, 'changes_requested')}
                      disabled={moderating}
                      className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-60 inline-flex items-center justify-center gap-1"
                    >
                      <FaExclamationTriangle /> Request Changes
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ModerationPage;