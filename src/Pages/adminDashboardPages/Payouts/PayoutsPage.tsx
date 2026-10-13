// FILE LOCATION: src/Pages/adminDashboardPages/Payouts/PayoutsPage.tsx
// DESCRIPTION: Unresolved vendor payouts (PAYOUT_RECONCILIATION_RUNBOOK.md).
//
// Deliberately offers NO "force paid" / "retry transfer": the only action
// that can move money is "Verify with Paystack", which asks Paystack for the
// transfer's real status and applies exactly what Paystack confirms. The
// server enforces admin-only access and every rule here; the UI only explains.
import { Fragment, useState } from 'react';
import { FaSpinner, FaMoneyCheckAlt, FaSyncAlt, FaExclamationTriangle } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetUnresolvedPayoutsQuery,
  useGetPayoutDetailQuery,
  useReconcilePayoutMutation,
  useAddPayoutNoteMutation,
  type PayoutAttempt,
  type ReconcileResult,
} from '../../../slices/adminPayoutsApiSlice';

const errorMessage = (err: unknown): string | undefined =>
  (err as { data?: { message?: string } } | undefined)?.data?.message;

const formatAge = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
};

const formatWhen = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : '—';

const money = (amount: string | number, currency: string) =>
  `${currency} ${Number(amount).toFixed(2)}`;

const statusBadge: Record<string, string> = {
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  reconciliation_required: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  succeeded: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  reversed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
};

const severityClass: Record<string, string> = {
  success: 'border-green-300 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300',
  info: 'border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
  warning: 'border-yellow-300 bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
  error: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300',
};

const toastFor = (result: ReconcileResult) => {
  if (result.severity === 'success') toast.success(result.message);
  else if (result.severity === 'warning') toast.warning(result.message);
  else if (result.severity === 'error') toast.error(result.message);
  else toast.info(result.message);
};

const filters = [
  { id: '', label: 'All unresolved' },
  { id: 'reconciliation_required', label: 'Needs review' },
  { id: 'processing', label: 'Awaiting Paystack' },
];

const PayoutDetailPanel = ({ id, onClose }: { id: number; onClose: () => void }) => {
  const { data, isLoading, isError } = useGetPayoutDetailQuery(id);
  const [reconcile, { isLoading: verifying }] = useReconcilePayoutMutation();
  const [addNote, { isLoading: savingNote }] = useAddPayoutNoteMutation();
  const [ack, setAck] = useState(false);
  const [justification, setJustification] = useState('');
  const [note, setNote] = useState('');
  const [lastResult, setLastResult] = useState<ReconcileResult | null>(null);

  if (isLoading) {
    return <div className="p-6 text-center"><FaSpinner className="animate-spin h-6 w-6 text-[#92400e] mx-auto" /></div>;
  }
  if (isError || !data) {
    return <div className="p-6 text-sm text-red-600">Could not load this payout.</div>;
  }
  const { attempt, consistency, history, journal } = data;
  const needsJustification = data.reverifyNeedsJustification;
  const justificationOk = justification.trim().length >= 10;

  const handleVerify = async () => {
    if (needsJustification && (!ack || !justificationOk)) return;
    if (!needsJustification && !window.confirm('Ask Paystack for the real status of this transfer and apply only what Paystack confirms?')) return;
    try {
      const result = await reconcile(
        needsJustification ? { id, acknowledge: true, note: justification.trim() } : { id }
      ).unwrap();
      setLastResult(result);
      toastFor(result);
      setAck(false);
      setJustification('');
    } catch (err) {
      toast.error(errorMessage(err) || 'Verification failed; nothing was changed');
    }
  };

  const handleNote = async () => {
    if (note.trim().length < 10) return;
    try {
      await addNote({ id, note: note.trim() }).unwrap();
      toast.success('Note recorded');
      setNote('');
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to record note');
    }
  };

  return (
    <div className="p-5 space-y-5 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Payout attempt #{attempt.id} — {money(attempt.amount, attempt.currency)}
          </h3>
          <p className="text-xs text-gray-500 mt-1 break-all">Reference {attempt.reference}</p>
        </div>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Close</button>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300">{attempt.explanation}</p>

      {!consistency.ok && (
        <div className="flex gap-2 p-3 rounded border border-red-300 bg-red-50 text-red-800 text-sm dark:bg-red-900/20 dark:text-red-300">
          <FaExclamationTriangle className="mt-0.5 shrink-0" />
          <span>
            Vendor wallet out of balance: wallet {consistency.wallet.toFixed(2)} vs withdrawable {consistency.allocations.toFixed(2)} + in-flight {consistency.inFlight.toFixed(2)} (difference {consistency.delta.toFixed(2)}).
            Investigate before approving further payouts for this vendor.
          </span>
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        {[
          ['Vendor', `${attempt.businessName || 'Unknown'} (#${attempt.vendorId})`],
          ['Withdrawal request', attempt.withdrawalId ? `#${attempt.withdrawalId}` : '—'],
          ['State', attempt.status],
          ['Paystack status (latest)', attempt.providerStatus || 'not reported yet'],
          ['Last verified', formatWhen(attempt.lastCheckedAt)],
          ['Checks so far', String(attempt.checkCount)],
          ['Acknowledged by Paystack', attempt.initiatedAt ? formatWhen(attempt.initiatedAt) : 'no confirmation received'],
          ['Last error', attempt.lastError || '—'],
          ['Review reason', attempt.reviewReason || '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="text-gray-900 dark:text-white break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {data.canReverify && (
        <div className="space-y-2 p-4 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <h4 className="font-medium text-gray-900 dark:text-white">Verify with Paystack</h4>
          <p className="text-xs text-gray-500">
            Asks Paystack for this transfer&apos;s status and applies only a confirmed outcome. It never sends money.
            If Paystack cannot confirm, nothing changes and the funds stay reserved.
          </p>
          {needsJustification && (
            <>
              <label className="flex gap-2 items-start text-sm text-gray-800 dark:text-gray-200">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
                <span>I have checked this reference in the Paystack dashboard and followed the runbook for “{attempt.reviewReason?.split(':')[0]}”.</span>
              </label>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="What did you check, and why is re-verification safe? (min. 10 characters — recorded in the audit log)"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </>
          )}
          <button
            onClick={handleVerify}
            disabled={verifying || (needsJustification && (!ack || !justificationOk))}
            className="inline-flex items-center gap-2 px-4 py-1.5 bg-[#92400e] text-white text-sm rounded hover:bg-[#78350f] disabled:opacity-50"
          >
            <FaSyncAlt className={verifying ? 'animate-spin' : ''} /> {verifying ? 'Verifying…' : 'Verify with Paystack'}
          </button>
          {lastResult && (
            <div className={`p-3 rounded border text-sm ${severityClass[lastResult.severity] || severityClass.info}`}>
              <strong className="capitalize">{lastResult.outcome}:</strong> {lastResult.message}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="font-medium text-gray-900 dark:text-white">Investigation note</h4>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Findings, ticket numbers, Paystack support replies… (min. 10 characters; does not change money or state)"
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
        <button
          onClick={handleNote}
          disabled={savingNote || note.trim().length < 10}
          className="px-4 py-1.5 bg-gray-700 text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
        >
          {savingNote ? 'Saving…' : 'Add note'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <h4 className="font-medium text-gray-900 dark:text-white mb-2">Action history</h4>
          {history.length === 0 ? (
            <p className="text-xs text-gray-500">No admin actions yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {history.map((h) => {
                const after = (h.afterVal || {}) as { outcome?: string; note?: string; resolutionNote?: string };
                return (
                  <li key={h.id} className="p-2 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-gray-900 dark:text-white">{h.action}</span>
                      <span className="text-gray-500">{formatWhen(h.created_at)}</span>
                    </div>
                    <div className="text-gray-600 dark:text-gray-400">
                      by {h.actorEmail || `admin #${h.actorId}`}
                      {after.outcome ? ` · outcome: ${after.outcome}` : ''}
                    </div>
                    {(after.note || after.resolutionNote) && (
                      <p className="mt-1 text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{after.note || after.resolutionNote}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h4 className="font-medium text-gray-900 dark:text-white mb-2">Money journal</h4>
          {journal.length === 0 ? (
            <p className="text-xs text-gray-500">No journal entries for this attempt.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {journal.map((j, i) => (
                <li key={i} className="flex justify-between gap-2 p-2 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <span className="text-gray-900 dark:text-white">{j.eventType}</span>
                  <span className="text-gray-600 dark:text-gray-400">{Number(j.amount).toFixed(2)} · {formatWhen(j.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

const PayoutsPage = () => {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const { data, isLoading, isError, refetch, isFetching } = useGetUnresolvedPayoutsQuery(
    filter ? { status: filter } : undefined
  );
  const payouts: PayoutAttempt[] = data?.payouts ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Unresolved Payouts</h2>
          <p className="text-sm text-gray-500 mt-1">
            Vendor transfers awaiting Paystack confirmation for over 30 minutes, or parked for manual review.
            Never re-send a payout whose outcome is unknown.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
        >
          <FaSyncAlt className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id || 'all'}
            onClick={() => { setFilter(f.id); setSelected(null); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              filter === f.id
                ? 'bg-[#92400e] text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <FaSpinner className="animate-spin h-8 w-8 text-[#92400e] mx-auto" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading payouts...</p>
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-red-600">Could not load unresolved payouts.</div>
        ) : payouts.length === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">
            <FaMoneyCheckAlt className="mx-auto text-4xl mb-4 opacity-50" />
            <p>No unresolved payouts.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="px-4 py-3">Attempt</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Paystack (latest)</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => setSelected(selected === p.id ? null : p.id)}
                      className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                        #{p.id}{p.withdrawalId ? <span className="block text-xs text-gray-500">request #{p.withdrawalId}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {p.businessName || 'Unknown'} <span className="text-xs text-gray-500">#{p.vendorId}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{money(p.amount, p.currency)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge[p.status] || statusBadge.processing}`}>
                          {p.status === 'reconciliation_required' ? 'needs review' : p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {p.providerStatus || '—'}
                        <span className="block text-xs text-gray-500">{p.lastCheckedAt ? formatWhen(p.lastCheckedAt) : 'not verified yet'}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{formatAge(Number(p.ageMinutes))}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 max-w-sm">{p.explanation}</td>
                    </tr>
                    {selected === p.id && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <PayoutDetailPanel id={p.id} onClose={() => setSelected(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PayoutsPage;
