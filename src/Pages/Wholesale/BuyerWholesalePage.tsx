// FILE LOCATION: src/Pages/Wholesale/BuyerWholesalePage.tsx
// DESCRIPTION: Buyer's B2B bulk quotes (Phase 3, Step 9 + Phase B). See quotes,
//   accept/decline, and pay an accepted quote on-platform (Paystack) — which
//   creates an escrowed order so the platform earns its commission.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { FaBoxes, FaSpinner } from 'react-icons/fa';
import {
  useGetMyBulkQuotesQuery, useRespondBulkQuoteMutation,
  useLazyGetBulkQuoteCheckoutTotalQuery, useCheckoutBulkQuoteMutation,
} from '../../slices/wholesaleApiSlice';
import { formatCurrency } from '../../utils/formatCurrency';
import type { RootState } from '../../store';

const hasPaystack = () => Boolean((window as unknown as { PaystackPop?: unknown }).PaystackPop);
const makePopup = () => new (window as unknown as { PaystackPop: new () => { newTransaction(c: Record<string, unknown>): void } }).PaystackPop();

const chip: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  quoted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  closed: 'bg-gray-800 text-white',
  declined: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const BuyerWholesalePage = () => {
  const navigate = useNavigate();
  const userInfo = useSelector((s: RootState) => s.auth?.userInfo) as { email?: string } | undefined;
  const { data = [], isLoading } = useGetMyBulkQuotesQuery();
  const [respond] = useRespondBulkQuoteMutation();
  const [getTotal] = useLazyGetBulkQuoteCheckoutTotalQuery();
  const [checkout] = useCheckoutBulkQuoteMutation();
  const [busyId, setBusyId] = useState<number | null>(null);

  const act = async (id: number, decision: 'accept' | 'decline') => {
    try { await respond({ id, decision }).unwrap(); toast.success(decision === 'accept' ? 'Quote accepted' : 'Quote declined'); }
    catch (e) { toast.error((e as { data?: { message?: string } })?.data?.message || 'Failed'); }
  };

  const pay = async (id: number) => {
    if (!hasPaystack()) { toast.error('Payment is still loading, please try again in a moment.'); return; }
    const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
    if (!key) { toast.error('Payments are not configured.'); return; }
    setBusyId(id);
    try {
      const priced = await getTotal(id).unwrap();
      const reference = `WHL_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const popup = makePopup();
      popup.newTransaction({
        key, email: userInfo?.email || '', amount: Math.round(priced.total * 100), currency: 'GHS', ref: reference,
        channels: ['card', 'mobile_money'],
        onSuccess: async (resp: { reference?: string }) => {
          try {
            const r = await checkout({ id, paymentReference: resp.reference || reference, shippingAddress: {} }).unwrap();
            toast.success('Wholesale order placed!');
            navigate(`/order/${r.orderId}`);
          } catch (e) {
            toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not finalise the order — contact support with your payment reference.');
          } finally { setBusyId(null); }
        },
        onCancel: () => { toast.info('Payment cancelled.'); setBusyId(null); },
      });
    } catch (e) {
      toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not start payment');
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FaBoxes /> My bulk quotes</h1>
      {isLoading ? <div className="flex justify-center py-16"><FaSpinner className="animate-spin h-8 w-8 text-primary" /></div>
        : data.length === 0 ? <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-10 text-center text-gray-500 dark:text-gray-400">No bulk quote requests yet. Find a wholesale product and request a quote.</div>
        : (
          <div className="space-y-3">
            {data.map((q) => (
              <div key={q.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{q.productTitle}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Qty {q.quantity}{q.quotedUnitPrice != null ? ` · quoted ${formatCurrency(q.quotedUnitPrice, 'GHS')}/unit` : ''}
                  </div>
                  {q.quoteNote && <div className="text-xs text-gray-400 mt-1 italic">"{q.quoteNote}"</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${chip[q.status] || chip.declined}`}>{q.status === 'closed' ? 'ordered' : q.status}</span>
                  {q.status === 'quoted' && (
                    <>
                      <button onClick={() => act(q.id, 'accept')} className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white">Accept</button>
                      <button onClick={() => act(q.id, 'decline')} className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">Decline</button>
                    </>
                  )}
                  {q.status === 'accepted' && (
                    <button onClick={() => pay(q.id)} disabled={busyId === q.id} className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white font-semibold disabled:opacity-60">
                      {busyId === q.id ? 'Processing…' : 'Pay now'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
};

export default BuyerWholesalePage;
