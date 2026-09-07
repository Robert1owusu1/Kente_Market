// Pages/Vendor/VendorPayouts.jsx
// Wallet balance, withdrawal, transaction history
import { useState } from 'react';
import { FaWallet, FaUniversity, FaMobileAlt, FaSpinner, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useGetMyVendorProfileQuery, useWithdrawVendorMutation } from '../../slices/vendorsApiSlice';
import { formatCurrency } from '../../utils/formatCurrency';
import Loader from '../../components/loader/Loader';

const txBadge: Record<string, string> = {
  credit: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  withdrawal: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  fee: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const VendorPayouts = () => {
  const { data, isLoading } = useGetMyVendorProfileQuery() as {
    data?: {
      vendor?: {
        payoutType?: string;
        momoProvider?: string;
        momoNumber?: string;
        bankName?: string;
        accountNumber?: string;
        [key: string]: unknown;
      };
      summary?: Record<string, any>;
      payouts?: Array<Record<string, any>>;
      walletTransactions?: Array<Record<string, any>>;
      [key: string]: unknown;
    };
    isLoading: boolean;
  };
  const [withdraw, { isLoading: withrawing }] = useWithdrawVendorMutation();
  const [amount, setAmount] = useState('');

  if (isLoading) return <div className="py-10 flex items-center justify-center"><Loader /></div>;
  if (!data?.vendor) return null;

  const { vendor, summary = {}, payouts = [], walletTransactions = [] } = data;

  const handleWithdraw = async () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) return toast.error('Enter a valid amount');
    try {
      const res = await withdraw({ amount: num }).unwrap();
      toast.success(res.message || 'Withdrawal initiated');
      setAmount('');
    } catch (err) {
      const e = err as { data?: { message?: string }; message?: string; error?: string } | undefined;
      toast.error(e?.data?.message || e?.message || 'Withdrawal failed');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Payouts & Wallet</h2>

      {/* Payout Method */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
        <h3 className="font-semibold text-lg mb-3 text-gray-800 dark:text-white">Payout Method</h3>
        {vendor.payoutType === 'momo' ? (
          <div className="flex items-center gap-3">
            <FaMobileAlt className="text-blue-500 text-lg" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white">{vendor.momoProvider}</span> mobile money ending in{' '}
              <span className="font-mono font-semibold">{vendor.momoNumber ? vendor.momoNumber.slice(-4) : ''}</span>
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <FaUniversity className="text-blue-500 text-lg" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white">{vendor.bankName}</span> account{' '}
              <span className="font-mono font-semibold">•••• {vendor.accountNumber ? vendor.accountNumber.slice(-4) : ''}</span>
            </p>
          </div>
        )}
      </div>

      {/* Wallet Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <FaWallet className="text-amber-500" /> Available Balance
          </p>
          <p className="text-2xl font-bold mt-1 text-green-600">{formatCurrency(summary.availableBalance || 0, 'GHS')}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <FaCheckCircle className="text-green-500" /> Total Earned
          </p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(summary.totalEarned || 0, 'GHS')}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <FaExclamationTriangle className="text-red-400" /> Held in Escrow
          </p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(summary.pendingPayout || 0, 'GHS')}</p>
        </div>
      </div>

      {/* Withdraw */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
        <h3 className="font-semibold text-lg mb-3 text-gray-800 dark:text-white">Withdraw Funds</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Max: GH₵${(summary.availableBalance || 0).toFixed(2)}`}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <button
            onClick={handleWithdraw}
            disabled={withrawing || !amount}
            className="inline-flex items-center justify-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-60 font-semibold"
          >
            {withrawing ? <FaSpinner className="animate-spin" /> : <FaWallet />}
            Withdraw
          </button>
        </div>
      </div>

      {/* Escrow Payout History */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
        <h3 className="font-semibold text-lg mb-4 text-gray-800 dark:text-white">Escrow Payouts</h3>
        {payouts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No payouts yet. They appear here once customers place orders with your products.</p>
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
                {payouts.slice(0, 20).map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs">{p.orderNumber}</td>
                    <td className="py-3 pr-4">{new Date(p.orderPlacedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</td>
                    <td className="py-3 pr-4">{formatCurrency(p.amount, 'GHS')}</td>
                    <td className="py-3 pr-4 text-gray-500">- {formatCurrency(p.platformFee, 'GHS')}</td>
                    <td className="py-3 pr-4 font-semibold">{formatCurrency(p.payoutAmount, 'GHS')}</td>
                    <td className="py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${txBadge[p.status] || 'bg-gray-100 text-gray-700'}`}>
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

      {/* Wallet Transactions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
        <h3 className="font-semibold text-lg mb-4 text-gray-800 dark:text-white">Wallet Transactions</h3>
        {walletTransactions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Reference</th>
                  <th className="pb-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {walletTransactions.slice(0, 30).map((t: any) => (
                  <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <td className="py-3 pr-4 text-xs">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${txBadge[t.type] || 'bg-gray-100 text-gray-700'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className={`py-3 pr-4 font-semibold ${t.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                      {t.type === 'credit' ? '+' : '-'}{formatCurrency(t.amount, 'GHS')}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-500">{t.reference || '-'}</td>
                    <td className="py-3 text-gray-500 text-xs">{t.note || '-'}</td>
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

export default VendorPayouts;
