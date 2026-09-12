// Pages/adminDashboardPages/Suggestions/SuggestionsPage.tsx
// Admin suggestion queue: read user feedback, work through it, tick each done.
import { useState } from 'react';
import { FaLightbulb, FaSpinner, FaCheckDouble, FaCheckCircle, FaClock, FaSync } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetAllSuggestionsQuery,
  useUpdateSuggestionStatusMutation,
} from '../../../slices/suggestionsApiSlice';
import type { Suggestion } from '../../../slices/suggestionsApiSlice';

const statusBadge: Record<string, string> = {
  new: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400',
  in_review: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400',
  done: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400',
};

const statusIcon = (status: string | undefined) => {
  if (status === 'done') return <FaCheckCircle className="text-green-500" />;
  if (status === 'in_review') return <FaSync className="text-blue-500" />;
  return <FaClock className="text-amber-500" />;
};

const formatDate = (d?: string) => {
  try {
    return new Date(d || '').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const countBy = (list: Suggestion[], status: string) =>
  list.filter((s) => s.status === status).length;

const SuggestionsAdminPage = () => {
  const { data: raw = [], isLoading, isError } = useGetAllSuggestionsQuery();
  const [updateStatus] = useUpdateSuggestionStatusMutation();
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const suggestions = (raw as Suggestion[]);

  const handleStatus = async (id: number | string, status: string) => {
    setBusyId(id);
    try {
      await updateStatus({ id, status }).unwrap();
      toast.success(`Suggestion ${status.replace('_', ' ')}`);
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || 'Failed to update suggestion');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">User Suggestions</h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400 font-medium">
            {countBy(suggestions, 'new')} new
          </span>
          <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400 font-medium">
            {countBy(suggestions, 'in_review')} in review
          </span>
          <span className="px-3 py-1 rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400 font-medium">
            {countBy(suggestions, 'done')} done
          </span>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <FaSpinner className="animate-spin h-10 w-10 text-amber-600" />
        </div>
      )}
      {isError && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-6 text-red-600 dark:text-red-400">
          Failed to load suggestions.
        </div>
      )}

      {!isLoading && !isError && suggestions.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-12 text-center text-gray-500 dark:text-gray-400">
          <FaLightbulb className="mx-auto text-5xl mb-4 opacity-40" />
          <p>No suggestions yet.</p>
          <p className="text-sm mt-1">They'll appear here the moment a user submits one.</p>
        </div>
      )}

      <div className="space-y-3">
        {suggestions.map((s) => (
          <div key={s.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{s.subject}</h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize inline-flex items-center gap-1 ${statusBadge[s.status || 'new']}`}>
                    {statusIcon(s.status)} {String(s.status || 'new').replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line mb-3">{s.body}</p>
                <p className="text-xs text-gray-400">
                  {s.firstName || ''} {s.lastName || ''} {s.email ? `· ${s.email}` : ''} ·{' '}
                  {formatDate(s.created_at)}
                </p>
              </div>

              <div className="flex flex-col gap-2 items-end shrink-0">
                {s.status !== 'done' ? (
                  <button
                    onClick={() => handleStatus(s.id as number | string, 'done')}
                    disabled={busyId === s.id}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-60 inline-flex items-center gap-2 text-sm"
                  >
                    {busyId === s.id ? <FaSpinner className="animate-spin" /> : <FaCheckDouble />} Tick done
                  </button>
                ) : (
                  <span className="px-4 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg font-semibold inline-flex items-center gap-2 text-sm">
                    <FaCheckCircle /> Completed
                  </span>
                )}
                <select
                  value={s.status || 'new'}
                  disabled={busyId === s.id}
                  onChange={(e) => handleStatus(s.id as number | string, e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-white"
                >
                  <option value="new">New</option>
                  <option value="in_review">In review</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SuggestionsAdminPage;