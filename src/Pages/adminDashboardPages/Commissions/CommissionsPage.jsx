// Pages/adminDashboardPages/Commissions/CommissionsPage.jsx
// Configurable platform commission engine: global → category → vendor → product.
import { useState } from 'react';
import { FaPlus, FaTrash, FaSpinner, FaTimes, FaCoins } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetCommissionRulesQuery,
  useCreateCommissionRuleMutation,
  useDeleteCommissionRuleMutation,
} from '../../../slices/marketplaceApiSlice';

const SCOPES = [
  { value: 'global', label: 'Global' },
  { value: 'category', label: 'Category' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'product', label: 'Product' },
];

const scopeLabel = (s) => SCOPES.find((x) => x.value === s)?.label || s;

const CreateRuleModal = ({ onClose }) => {
  const [scope, setScope] = useState('global');
  const [target, setTarget] = useState('');
  const [rate, setRate] = useState(0.1);
  const [createRule, { isLoading }] = useCreateCommissionRuleMutation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const rateNum = parseFloat(rate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 0.5) {
      return toast.error('Rate must be between 0 and 0.5 (0%–50%)');
    }
    if (scope !== 'global' && !target.trim()) {
      return toast.error('A target is required (category name, vendor user id or product id)');
    }
    try {
      await createRule({
        scope,
        target: scope === 'global' ? null : target.trim(),
        rate: rateNum,
      }).unwrap();
      toast.success('Commission rule created');
      onClose();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to create rule');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2"><FaCoins /> New commission rule</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><FaTimes /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Scope (most specific wins)</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white">
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {scope !== 'global' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Target {scope === 'category' ? '(category name)' : scope === 'vendor' ? '(vendor user id)' : '(product id)'}
              </label>
              <input type="text" value={target} onChange={(e) => setTarget(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rate (0.00 – 0.50 = 0%–50%)</label>
            <input type="number" step="0.01" min="0" max="0.5" value={rate} onChange={(e) => setRate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          </div>
          <button type="submit" disabled={isLoading}
            className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
            {isLoading ? <FaSpinner className="animate-spin" /> : <FaPlus />} Create rule
          </button>
        </form>
      </div>
    </div>
  );
};

const CommissionsPage = () => {
  const [showCreate, setShowCreate] = useState(false);
  const { data: rules = [], isLoading, isError } = useGetCommissionRulesQuery();
  const [deleteRule, { isLoading: deleting }] = useDeleteCommissionRuleMutation();

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this commission rule?')) return;
    try {
      await deleteRule(id).unwrap();
      toast.success('Commission rule deleted');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to delete rule');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Commission Engine</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Resolution order: product → vendor → category → global. Hard-capped at 50%.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 inline-flex items-center gap-2 text-sm"
        >
          <FaPlus /> New rule
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center"><FaSpinner className="animate-spin h-10 w-10 text-indigo-600 mx-auto" /></div>
      ) : isError ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-red-600 dark:text-red-400 font-medium">Failed to load commission rules.</p>
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
          <FaCoins className="mx-auto text-4xl mb-4 opacity-50" />
          <p>No commission rules defined. The platform fallback rate applies.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="p-4">Scope</th>
                  <th>Target</th>
                  <th>Rate</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-4">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                        {scopeLabel(r.scope)}
                      </span>
                    </td>
                    <td className="text-sm text-gray-800 dark:text-white">{r.target || '—'}</td>
                    <td className="text-sm font-semibold text-gray-800 dark:text-white">{(r.rate * 100).toFixed(1)}%</td>
                    <td className="text-sm text-gray-500 dark:text-gray-400">
                      {new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td>
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={deleting}
                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900 rounded"
                        title="Delete"
                      >
                        <FaTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && <CreateRuleModal onClose={() => setShowCreate(false)} />}
    </div>
  );
};

export default CommissionsPage;