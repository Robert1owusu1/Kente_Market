// Pages/Referrals/ReferralsPage.tsx
// "Refer & Earn": every registered user's ambassador page — personal link,
// earnings wallet, the purchases they referred (buyer masked by the server),
// payout account and withdrawals. Rules: REFERRAL_SYSTEM_DESIGN.md. Every
// amount shown comes from the server; the page never computes a commission.
import { useRef, useState, type FormEvent } from 'react';
import { FaSpinner, FaGift, FaCopy, FaWallet, FaMoneyBillWave } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetMyReferralsQuery,
  useSetReferralPayoutAccountMutation,
  useWithdrawReferralEarningsMutation,
  type ReferralCommissionStatus,
} from '../../slices/referralsApiSlice';

const money = (v: number | string) => `GH₵${(Number(v) || 0).toFixed(2)}`;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const errMsg = (e: unknown) => (e as { data?: { message?: string } })?.data?.message || 'Something went wrong';

const STATUS_LABEL: Record<ReferralCommissionStatus, { text: string; cls: string; hint: string }> = {
  pending: { text: 'Pending', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', hint: 'Paid — becomes available when the order is completed' },
  under_review: { text: 'Under review', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', hint: 'Being checked by our team' },
  available: { text: 'Available', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', hint: 'In your balance' },
  cancelled: { text: 'Cancelled', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', hint: 'Order refunded or not eligible' },
  reversed: { text: 'Reversed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', hint: 'Order refunded after it was credited' },
};

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ReferralsPage = () => {
  const { data, isLoading, isError } = useGetMyReferralsQuery();
  const [savePayout, { isLoading: savingPayout }] = useSetReferralPayoutAccountMutation();
  const [withdraw, { isLoading: withdrawing }] = useWithdrawReferralEarningsMutation();
  const [amount, setAmount] = useState('');
  const [acct, setAcct] = useState({ type: 'mobile_money' as 'mobile_money' | 'bank', name: '', accountNumber: '', bankCode: 'MTN' });
  // One request key per withdrawal intent: a double-click resubmits the same key.
  const keyRef = useRef<{ amount: string; key: string } | null>(null);

  if (isLoading) return <div className="flex justify-center py-20"><FaSpinner className="animate-spin text-3xl text-primary" /></div>;
  if (isError || !data) return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-600 dark:text-gray-300">Could not load your referral account.</div>;

  const pending = data.commissions.filter((c) => c.status === 'pending' || c.status === 'under_review')
    .reduce((s, c) => s + c.amount, 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.link);
      toast.success('Link copied');
    } catch {
      toast.info(data.link);
    }
  };

  const onPayout = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await savePayout(acct).unwrap();
      toast.success('Payout account saved');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const onWithdraw = async (e: FormEvent) => {
    e.preventDefault();
    if (!keyRef.current || keyRef.current.amount !== amount) keyRef.current = { amount, key: newKey() };
    try {
      const res = await withdraw({ amount, requestKey: keyRef.current.key }).unwrap();
      toast.success(res.message);
      keyRef.current = null;
      setAmount('');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FaGift className="text-primary" /> Refer &amp; Earn</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Share your link. When someone creates a new account through it and their order is paid and completed,
          you earn {data.rate !== null ? `${(data.rate * 100).toFixed(2).replace(/\.?0+$/, '')}%` : 'a commission'} of the
          product price (excluding VAT and shipping) on their purchases for {data.windowDays === 365 ? '1 year' : `${data.windowDays} days`} after they sign up.
        </p>
        {!data.enabled && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">The referral programme is not active yet. Your link will start earning once it is.</p>}
        {data.suspended && <p className="mt-2 text-sm text-red-700 dark:text-red-300">Your referral account is suspended. Contact support.</p>}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Your referral link {data.tier === 'super' && <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">Super ambassador</span>}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input readOnly aria-label="Your referral link" value={data.link} className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white text-sm" />
          <button onClick={copy} className="btn btn-primary"><FaCopy aria-hidden="true" /> Copy</button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{data.referredCount} people signed up with your link.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Available', data.wallet.balance],
          ['Pending', pending],
          ['Total earned', data.wallet.totalEarned],
          ['Withdrawn / spent', data.wallet.totalWithdrawn + data.wallet.totalSpent],
        ].map(([label, v]) => (
          <div key={String(label)} className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            <p className={`text-lg font-bold ${Number(v) < 0 ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{money(v as number)}</p>
          </div>
        ))}
      </div>
      {data.wallet.balance < 0 && (
        <p className="text-sm text-red-700 dark:text-red-300">A refunded order reversed earnings you had already used; this amount is deducted from future earnings.</p>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <form onSubmit={onPayout} className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><FaWallet /> Payout account</h2>
          {data.payoutAccount && <p className="text-sm text-gray-600 dark:text-gray-300">Current: {data.payoutAccount}</p>}
          <select aria-label="Payout method" value={acct.type} onChange={(e) => setAcct({ ...acct, type: e.target.value as 'mobile_money' | 'bank' })}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white">
            <option value="mobile_money">Mobile Money</option>
            <option value="bank">Bank account</option>
          </select>
          <input aria-label="Account name" placeholder="Account name" value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          <input aria-label={acct.type === 'mobile_money' ? 'MoMo number' : 'Account number'} placeholder={acct.type === 'mobile_money' ? 'MoMo number' : 'Account number'} inputMode="numeric" value={acct.accountNumber}
            onChange={(e) => setAcct({ ...acct, accountNumber: e.target.value.replace(/\D/g, '') })}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          <input aria-label={acct.type === 'mobile_money' ? 'Mobile network code' : 'Bank code'} placeholder={acct.type === 'mobile_money' ? 'Network code (MTN, VOD, ATL)' : 'Bank code'} value={acct.bankCode}
            onChange={(e) => setAcct({ ...acct, bankCode: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          <button disabled={savingPayout} className="w-full py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white disabled:opacity-60">
            {savingPayout ? <FaSpinner className="animate-spin inline" /> : 'Save payout account'}
          </button>
        </form>

        <form onSubmit={onWithdraw} className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><FaMoneyBillWave /> Withdraw</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Minimum {money(data.minWithdrawal)}. You can also pay for a whole order with your balance at checkout —
            orders paid with earnings are final and cannot be refunded.
          </p>
          <input aria-label="Withdrawal amount in Ghana cedis" placeholder="Amount (GH₵)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          <button disabled={withdrawing || !data.payoutAccount || data.wallet.balance < data.minWithdrawal}
            className="w-full py-2 rounded-lg bg-primary text-white disabled:opacity-60">
            {withdrawing ? <FaSpinner className="animate-spin inline" /> : 'Withdraw'}
          </button>
          {!data.payoutAccount && <p className="text-xs text-gray-500">Add a payout account first.</p>}
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden">
        <h2 className="font-semibold text-gray-900 dark:text-white p-5 pb-3">Referred purchases</h2>
        {data.commissions.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-gray-500">No referred purchases yet. Registrations and visits do not earn on their own — only paid, completed orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-left text-gray-600 dark:text-gray-300">
                <tr><th className="p-3">Date</th><th>Customer</th><th>Order</th><th>Commission</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.commissions.map((c) => (
                  <tr key={c.id} className="border-t dark:border-gray-700 text-gray-800 dark:text-gray-200">
                    <td className="p-3">{fmtDate(c.createdAt)}</td>
                    <td>{c.customer}</td>
                    <td>{c.order}</td>
                    <td>{money(c.amount)}{c.amount !== c.originalAmount && <span className="text-xs text-gray-500"> (was {money(c.originalAmount)})</span>}</td>
                    <td><span title={STATUS_LABEL[c.status].hint} className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABEL[c.status].cls}`}>{STATUS_LABEL[c.status].text}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.withdrawals.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden">
          <h2 className="font-semibold text-gray-900 dark:text-white p-5 pb-3">Withdrawals</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-left text-gray-600 dark:text-gray-300">
                <tr><th className="p-3">Date</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.withdrawals.map((w) => (
                  <tr key={w.id} className="border-t dark:border-gray-700 text-gray-800 dark:text-gray-200">
                    <td className="p-3">{fmtDate(w.created_at)}</td>
                    <td>{money(w.amount)}</td>
                    <td>{w.status === 'paid' ? 'Paid' : w.status === 'failed' ? 'Failed — returned to balance' : w.status === 'processing' ? 'Processing' : 'Being checked'}</td>
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

export default ReferralsPage;
