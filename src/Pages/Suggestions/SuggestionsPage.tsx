// Pages/Suggestions/SuggestionsPage.tsx
// Customer-facing suggestion box. Feedback lands with the main admin, who works
// through the list and ticks each item done.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaSpinner, FaLightbulb, FaCheckCircle, FaClock, FaSync, FaPaperPlane } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useAppSelector } from '../../store';
import {
  useCreateSuggestionMutation,
  useGetMySuggestionsQuery,
} from '../../slices/suggestionsApiSlice';
import type { Suggestion } from '../../slices/suggestionsApiSlice';

const statusBadge = (status: string | undefined) => {
  const map: Record<string, string> = {
    new: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    in_review: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    done: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  };
  return map[status || 'new'] || map.new;
};

const statusIcon = (status: string | undefined) => {
  if (status === 'done') return <FaCheckCircle className="text-green-500" />;
  if (status === 'in_review') return <FaSync className="text-blue-500" />;
  return <FaClock className="text-amber-500" />;
};

const formatDate = (d?: string) => {
  try {
    return new Date(d || '').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

const SuggestionsPage = () => {
  const { userInfo } = useAppSelector((state) => state.auth);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [createSuggestion] = useCreateSuggestionMutation();
  const { data: mine = [], isLoading } = useGetMySuggestionsQuery(undefined, {
    skip: !userInfo,
  });

  const handleSubmit = async () => {
    if (!subject.trim() || !body.trim()) return toast.error('Title and suggestion are required');
    setCreating(true);
    try {
      await createSuggestion({ subject: subject.trim(), body: body.trim() }).unwrap();
      toast.success('Suggestion sent to the admin team');
      setSubject('');
      setBody('');
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || 'Failed to send suggestion');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-[60vh] bg-gray-50 dark:bg-gray-900 py-12">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/40 mb-4">
            <FaLightbulb className="text-3xl text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Suggestions</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-xl mx-auto">
            We're building this store in the open and your ideas shape it. Tell the
            admin team what you'd like to see — features, designs, delivery options —
            and watch the list. When the admin completes an idea, it's ticked as done.
          </p>
        </div>

        {userInfo ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6 mb-8">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Send a suggestion</h2>
            <div className="space-y-4">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={255}
                placeholder="Title (e.g. 'Add a size guide to product pages')"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={5000}
                placeholder="Describe your suggestion..."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              />
              <button
                onClick={handleSubmit}
                disabled={creating}
                className="px-6 py-2.5 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {creating ? <FaSpinner className="animate-spin" /> : <FaPaperPlane />} Send suggestion
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 text-center mb-8">
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Sign in to send the admin team your suggestions.
            </p>
            <Link
              to="/login"
              className="inline-block px-6 py-2.5 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700"
            >
              Sign in
            </Link>
          </div>
        )}

        {userInfo && (
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">My suggestions</h2>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <FaSpinner className="animate-spin h-8 w-8 text-amber-600" />
              </div>
            ) : (mine as Suggestion[]).length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 text-center text-gray-500 dark:text-gray-400">
                You haven't sent any suggestions yet.
              </div>
            ) : (
              <div className="space-y-3">
                {(mine as Suggestion[]).map((s) => (
                  <div key={s.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{s.subject}</h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize inline-flex items-center gap-1 ${statusBadge(s.status)}`}>
                        {statusIcon(s.status)} {String(s.status || 'new').replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">{s.body}</p>
                    <p className="text-xs text-gray-400 mt-2">{formatDate(s.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SuggestionsPage;