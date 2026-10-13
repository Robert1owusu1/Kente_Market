// Pages/adminDashboardPages/Referrals/ReferralsAdminPage.tsx
// Admin → Referrals (REFERRAL_SYSTEM_DESIGN.md): programme settings, ambassador
// tiers/rates/suspension, commission review, referral withdrawals. The server
// enforces every rule (rates <= platform commission, audited decisions, notes
// required); there is deliberately NO manual "mark paid" or balance edit —
// withdrawals settle only from Paystack evidence ("Verify with Paystack").
import { useEffect, useState } from 'react';
import { FaSpinner, FaGift, FaCheck, FaTimes, FaSync } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetReferralSettingsQuery,
  useUpdateReferralSettingsMutation,
  useGetAmbassadorsQuery,
  useUpdateAmbassadorMutation,
  useGetReferralCommissionsQuery,
  useReviewReferralCommissionMutation,
  useGetReferralWithdrawalsQuery,
  useVerifyReferralWithdrawalMutation,
  type ReferralCommissionStatus,
  type AdminAmbassador,
} from '../../../slices/referralsApiSlice';

const money = (v: number | string) => `GH₵${(Number(v) || 0).toFixed(2)}`;
const pct = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : `${(Number(v) * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const errMsg = (e: unknown) => (e as { data?: { message?: string } })?.data?.message || 'Request failed';
const inputCls = 'px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm';

const REASON_TEXT: Record<string, string> = {
  same_payment_instrument: 'Same card / MoMo as the referrer',
  shared_device: 'Device also used by the referrer',
  same_phone: 'Same phone number as the referrer',
  same_delivery_address: "Delivered to the referrer's address",
  same_signup_ip: 'Signed up from the referrer\'s network',
};

const SettingsCard = () => {
  const { data, isLoading } = useGetReferralSettingsQuery();
  const [save, { isLoading: saving }] = useUpdateReferralSettingsMutation();
  const [rate, setRate] = useState('');
  const [windowDays, setWindowDays] = useState(30);
  useEffect(() => {
    if (data) {
      setRate(data.standardRate === null ? '' : String(data.standardRate));
      setWindowDays(data.windowDays);
    }
  }, [data]);
  if (isLoading || !data) return <FaSpinner className="animate-spin" />;

  const submit = async (enabled?: boolean) => {
    try {
      await save({ standardRate: rate === '' ? null : rate, windowDays, ...(enabled !== undefined ? { enabled } : {}) }).unwrap();
      toast.success('Referral settings saved');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Programme settings</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs ${data.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{data.enabled ? 'Active' : 'Off'}</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Platform commission (global rule): {pct(data.platformRate)}. The referral rate cannot exceed it, and each item's referral is
        also capped at the platform commission left after any admin coupon. Base: seller's product price, no VAT or shipping.
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm text-gray-700 dark:text-gray-300">Standard rate (0–0.5)
          <input aria-label="Standard rate" className={`${inputCls} block w-32`} type="number" step="0.0001" min="0" max="0.5" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">Qualifying purchases after signup
          <select aria-label="Window" className={`${inputCls} block`} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={365}>1 year</option>
          </select>
        </label>
        <button disabled={saving} onClick={() => submit()} className="px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-sm">Save</button>
        <button disabled={saving} onClick={() => submit(!data.enabled)} className="px-4 py-2 rounded-lg bg-primary text-white text-sm">
          {data.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    </div>
  );
};

const AmbassadorRow = ({ a }: { a: AdminAmbassador }) => {
  const [update, { isLoading }] = useUpdateAmbassadorMutation();
  const [rate, setRate] = useState(a.ambassadorRate === null ? '' : String(a.ambassadorRate));
  const run = async (body: Parameters<typeof update>[0]) => {
    try {
      await update(body).unwrap();
      toast.success('Ambassador updated');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <tr className="border-t dark:border-gray-700 text-gray-800 dark:text-gray-200">
      <td className="p-3">{a.firstName} {a.lastName}<div className="text-xs text-gray-500">{a.email} · {a.referralCode || 'no code yet'}</div></td>
      <td>{a.ambassadorTier === 'super' ? `Super (${pct(a.ambassadorRate)})` : 'Standard'}{Number(a.ambassadorSuspended) ? ' · suspended' : ''}</td>
      <td>{a.referredCount}</td>
      <td>{money(a.totalEarned)}</td>
      <td>{money(a.balance)}</td>
      <td className="whitespace-nowrap">
        <input aria-label={`Super rate for ${a.email}`} className={`${inputCls} w-24`} type="number" step="0.0001" min="0" max="0.5" value={rate} onChange={(e) => setRate(e.target.value)} />
        <button disabled={isLoading} onClick={() => run({ userId: a.id, tier: 'super', rate })} className="ml-1 px-2 py-1 text-xs rounded bg-primary text-white">Make super</button>
        {a.ambassadorTier === 'super' && <button disabled={isLoading} onClick={() => run({ userId: a.id, tier: 'standard' })} className="ml-1 px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-600">Standard</button>}
        <button disabled={isLoading} onClick={() => run({ userId: a.id, suspended: !Number(a.ambassadorSuspended) })} className="ml-1 px-2 py-1 text-xs rounded bg-red-100 text-red-700">
          {Number(a.ambassadorSuspended) ? 'Unsuspend' : 'Suspend'}
        </button>
      </td>
    </tr>
  );
};

const AmbassadorsCard = () => {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const { data = [], isFetching } = useGetAmbassadorsQuery(query ? { search: query } : undefined);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      <div className="p-5 flex flex-wrap gap-2 items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Ambassadors</h3>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }} className="flex gap-2">
          <input className={inputCls} placeholder="Email, name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-sm">Search</button>
        </form>
      </div>
      {isFetching ? <div className="p-5"><FaSpinner className="animate-spin" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-left text-gray-600 dark:text-gray-300">
              <tr><th className="p-3">User</th><th>Tier</th><th>Referred</th><th>Earned</th><th>Balance</th><th>Actions</th></tr>
            </thead>
            <tbody>{data.map((a) => <AmbassadorRow key={a.id} a={a} />)}</tbody>
          </table>
          {data.length === 0 && <p className="p-5 text-sm text-gray-500">No ambassadors with activity yet. Search to find any user.</p>}
        </div>
      )}
    </div>
  );
};

const CommissionsCard = () => {
  const [status, setStatus] = useState<ReferralCommissionStatus | ''>('under_review');
  const { data = [], isFetching } = useGetReferralCommissionsQuery(status ? { status } : undefined);
  const [review, { isLoading }] = useReviewReferralCommissionMutation();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const decide = async (id: number, decision: 'approve' | 'reject') => {
    try {
      await review({ id, decision, note: notes[id] || '' }).unwrap();
      toast.success(decision === 'approve' ? 'Approved — becomes available when the order completes' : 'Rejected');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      <div className="p-5 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-white">Referral commissions</h3>
        <select aria-label="Status filter" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as ReferralCommissionStatus | '')}>
          <option value="under_review">Under review</option>
          <option value="pending">Pending</option>
          <option value="available">Available</option>
          <option value="reversed">Reversed</option>
          <option value="cancelled">Cancelled</option>
          <option value="">All</option>
        </select>
      </div>
      {isFetching ? <div className="p-5"><FaSpinner className="animate-spin" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-left text-gray-600 dark:text-gray-300">
              <tr><th className="p-3">Order</th><th>Referrer → customer</th><th>Base × rate (cap)</th><th>Commission</th><th>Status</th><th>Review</th></tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t dark:border-gray-700 text-gray-800 dark:text-gray-200 align-top">
                  <td className="p-3">{c.orderNumber}<div className="text-xs text-gray-500">{c.paymentStatus} / {c.orderStatus}</div></td>
                  <td>{c.referrerEmail}<div className="text-xs text-gray-500">→ {c.customerEmail}</div></td>
                  <td>{money(c.base)} × {pct(c.rate)} <span className="text-xs text-gray-500">(cap {money(c.cap)})</span></td>
                  <td>{money(c.currentAmount)}{Number(c.currentAmount) !== Number(c.amount) && <div className="text-xs text-gray-500">was {money(c.amount)}</div>}</td>
                  <td>{c.status}{c.reviewReasons?.length ? <ul className="text-xs text-amber-700 dark:text-amber-300">{c.reviewReasons.map((r) => <li key={r}>{REASON_TEXT[r] || r}</li>)}</ul> : null}</td>
                  <td className="min-w-[220px]">
                    {c.status === 'under_review' ? (
                      <div className="space-y-1">
                        <input aria-label={`Note for ${c.id}`} className={`${inputCls} w-full`} placeholder="Justification (required)" value={notes[c.id] || ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
                        <button disabled={isLoading} onClick={() => decide(c.id, 'approve')} className="px-2 py-1 text-xs rounded bg-green-600 text-white inline-flex items-center gap-1"><FaCheck /> Approve</button>
                        <button disabled={isLoading} onClick={() => decide(c.id, 'reject')} className="ml-1 px-2 py-1 text-xs rounded bg-red-600 text-white inline-flex items-center gap-1"><FaTimes /> Reject</button>
                      </div>
                    ) : (c.reviewNote || '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="p-5 text-sm text-gray-500">Nothing here.</p>}
        </div>
      )}
    </div>
  );
};

const WithdrawalsCard = () => {
  const { data = [], isFetching } = useGetReferralWithdrawalsQuery();
  const [verify, { isLoading }] = useVerifyReferralWithdrawalMutation();
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      <h3 className="font-semibold text-gray-900 dark:text-white p-5 pb-2">Referral withdrawals</h3>
      <p className="px-5 text-xs text-gray-500 dark:text-gray-400">A withdrawal is marked paid only from Paystack's own record. Never re-send one whose outcome is unknown.</p>
      {isFetching ? <div className="p-5"><FaSpinner className="animate-spin" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm mt-2">
            <thead className="bg-gray-50 dark:bg-gray-700 text-left text-gray-600 dark:text-gray-300">
              <tr><th className="p-3">User</th><th>Amount</th><th>Status</th><th>Reference</th><th></th></tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id} className="border-t dark:border-gray-700 text-gray-800 dark:text-gray-200">
                  <td className="p-3">{w.email}</td>
                  <td>{money(w.amount)}</td>
                  <td>{w.status}{w.lastError ? <div className="text-xs text-red-600">{w.lastError}</div> : null}</td>
                  <td className="text-xs">{w.reference}</td>
                  <td>{w.status === 'processing' && (
                    <button disabled={isLoading} onClick={async () => {
                      try { await verify(w.id).unwrap(); toast.success('Checked with Paystack'); } catch (e) { toast.error(errMsg(e)); }
                    }} className="px-2 py-1 text-xs rounded bg-gray-900 dark:bg-gray-700 text-white inline-flex items-center gap-1"><FaSync /> Verify with Paystack</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="p-5 text-sm text-gray-500">No referral withdrawals.</p>}
        </div>
      )}
    </div>
  );
};

const ReferralsAdminPage = () => (
  <div className="space-y-6">
    <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FaGift /> Referrals</h2>
    <SettingsCard />
    <CommissionsCard />
    <AmbassadorsCard />
    <WithdrawalsCard />
  </div>
);

export default ReferralsAdminPage;
