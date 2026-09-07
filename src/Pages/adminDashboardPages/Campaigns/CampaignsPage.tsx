// Pages/adminDashboardPages/Campaigns/CampaignsPage.jsx
// Admin marketing campaigns (e.g. KENTE WEEK) with industry-wide discounts.
import { useState, type FormEvent } from 'react';
import { FaPlus, FaTrash, FaSpinner, FaTimes, FaTag, FaCalendarAlt, FaPercent } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetCampaignsQuery,
  useCreateCampaignMutation,
  useDeleteCampaignMutation,
} from '../../../slices/marketplaceApiSlice';
import type { Campaign } from '../../../slices/apiTypes';

interface CampaignRow extends Campaign {
  id: number | string;
  status: string;
  discountType: string;
  discountValue: number;
  startsAt: string;
  endsAt: string;
  productCount: number;
  vendorCount: number;
}

const errorMessage = (err: unknown): string | undefined =>
  (err as { data?: { message?: string }; message?: string; error?: string })?.data?.message;

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    ended: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return map[status] || map.draft;
};

const formatDate = (d: string) => {
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return 'N/A';
  }
};

const toLocalInput = (d: string | Date) => {
  if (!d) return '';
  try {
    const dt = new Date(d);
    return dt.toISOString().slice(0, 16);
  } catch {
    return '';
  }
};

const CampaignModal = ({ onClose }: { onClose: () => void }) => {
  const [title, setTitle] = useState('');
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState(10);
  const [startsAt, setStartsAt] = useState(toLocalInput(new Date()));
  const [endsAt, setEndsAt] = useState('');
  const [createCampaign, { isLoading }] = useCreateCampaignMutation();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error('Campaign title is required');
    if (!startsAt || !endsAt) return toast.error('Start and end dates are required');
    try {
      await createCampaign({
        title: title.trim(),
        discountType,
        discountValue: parseFloat(String(discountValue)),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      }).unwrap();
      toast.success('Campaign created');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to create campaign');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2"><FaTag /> New campaign</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><FaTimes /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. KENTE WEEK"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount type</label>
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white">
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed (GH₵)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Value</label>
              <input type="number" min="1" value={discountValue} onChange={(e) => setDiscountValue(e.target.value as unknown as number)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Starts</label>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ends</label>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
            </div>
          </div>
          <button type="submit" disabled={isLoading}
            className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
            {isLoading ? <FaSpinner className="animate-spin" /> : <FaPlus />} Create campaign
          </button>
        </form>
      </div>
    </div>
  );
};

const CampaignsPage = () => {
  const [showCreate, setShowCreate] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { data: rawCampaigns = [], isLoading, isError } = useGetCampaignsQuery(showAll);
  const campaigns = rawCampaigns as CampaignRow[];
  const [deleteCampaign, { isLoading: deleting }] = useDeleteCampaignMutation();

  const handleDelete = async (id: number | string, title?: string) => {
    if (!window.confirm(`Delete campaign "${title}"?`)) return;
    try {
      await deleteCampaign(id).unwrap();
      toast.success('Campaign deleted');
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to delete campaign');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Marketing Campaigns</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAll(!showAll)}
            className="px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-semibold text-sm border dark:border-gray-700"
          >
            {showAll ? 'Show active' : 'Show all'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 inline-flex items-center gap-2 text-sm"
          >
            <FaPlus /> New campaign
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center"><FaSpinner className="animate-spin h-10 w-10 text-indigo-600 mx-auto" /></div>
      ) : isError ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-red-600 dark:text-red-400 font-medium">Failed to load campaigns.</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
          <FaTag className="mx-auto text-4xl mb-4 opacity-50" />
          <p>No campaigns yet. Create one to power a site-wide promotion.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map((c) => (
            <div key={c.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">{c.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    <FaPercent className="inline mr-1" />
                    {c.discountType === 'percentage' ? `${c.discountValue}% off` : `GH₵ ${c.discountValue} off`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge(c.status)}`}>
                    {c.status}
                  </span>
                  <button
                    onClick={() => handleDelete(c.id, c.title)}
                    disabled={deleting}
                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900 rounded"
                    title="Delete"
                  >
                    <FaTrash />
                  </button>
                </div>
              </div>
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <p className="flex items-center gap-1"><FaCalendarAlt /> <span className="line-through">{formatDate(c.startsAt as string)}</span></p>
                <p className="flex items-center gap-1"><FaCalendarAlt /> Ends {formatDate(c.endsAt as string)}</p>
              </div>
              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                {c.productCount || 0} products · {c.vendorCount || 0} vendors
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CampaignModal onClose={() => setShowCreate(false)} />}
    </div>
  );
};

export default CampaignsPage;