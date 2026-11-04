// FILE LOCATION: src/Pages/GiftCards/GiftCardsPage.tsx
// DESCRIPTION: Buy a Bonwire Kente gift card or redeem a code into store credit
//   (Phase 3, Step 7). Buying redirects to Paystack; redeeming adds the value to
//   the signed-in user's spend-only store credit.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaGift, FaSpinner, FaWallet } from 'react-icons/fa';
import {
  useGetStoreCreditQuery, usePurchaseGiftCardMutation, useRedeemGiftCardMutation,
} from '../../slices/giftCardsApiSlice';
import { formatCurrency } from '../../utils/formatCurrency';

const PRESETS = [50, 100, 200, 500];

const GiftCardsPage = () => {
  const [params] = useSearchParams();
  const { data: credit } = useGetStoreCreditQuery();
  const [purchase, { isLoading: buying }] = usePurchaseGiftCardMutation();
  const [redeem, { isLoading: redeeming }] = useRedeemGiftCardMutation();

  const [amount, setAmount] = useState(100);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState(params.get('code') || '');

  const buy = async () => {
    if (!recipientEmail) { toast.error("Enter the recipient's email"); return; }
    try {
      const res = await purchase({ amount, recipientEmail, message: message || undefined }).unwrap();
      if (res.authorizationUrl) window.location.href = res.authorizationUrl;
    } catch (e) {
      toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not start purchase');
    }
  };

  const doRedeem = async () => {
    if (!code.trim()) { toast.error('Enter a gift card code'); return; }
    try {
      const res = await redeem({ code: code.trim() }).unwrap();
      toast.success(`Redeemed! ${formatCurrency(res.amount, 'GHS')} added to your store credit.`);
      setCode('');
    } catch (e) {
      toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not redeem code');
    }
  };

  const input = 'w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-primary/10 rounded-full mb-3"><FaGift className="text-2xl text-primary" /></div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Gift Cards</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">Send the gift of authentic Kente — or redeem a code you've received.</p>
      </div>

      {credit && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 flex items-center justify-center gap-2 text-amber-800 dark:text-amber-300">
          <FaWallet /> Your store credit: <strong>{formatCurrency(credit.balance, 'GHS')}</strong>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Buy */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6">
          <h2 className="font-semibold text-lg text-gray-900 dark:text-white mb-4">Buy a gift card</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-400">Amount (GHS)</label>
              <div className="flex gap-2 mt-1 mb-2 flex-wrap">
                {PRESETS.map((p) => (
                  <button key={p} type="button" onClick={() => setAmount(p)}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${amount === p ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 dark:border-gray-600'}`}>
                    {p}
                  </button>
                ))}
              </div>
              <input type="number" min={10} max={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className={input} />
            </div>
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-400">Recipient email</label>
              <input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="them@example.com" className={input} />
            </div>
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-400">Message (optional)</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className={input} />
            </div>
            <button onClick={buy} disabled={buying} className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-60">
              {buying ? <FaSpinner className="animate-spin" /> : <FaGift />} {buying ? 'Redirecting…' : `Buy ${formatCurrency(amount, 'GHS')} gift card`}
            </button>
          </div>
        </div>

        {/* Redeem */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6">
          <h2 className="font-semibold text-lg text-gray-900 dark:text-white mb-4">Redeem a code</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Enter the code from your email to add its value to your store credit.</p>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BK-XXXX-XXXX-XXXX" className={`${input} tracking-widest font-mono`} />
          <button onClick={doRedeem} disabled={redeeming} className="mt-4 w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-60">
            {redeeming ? <FaSpinner className="animate-spin" /> : <FaWallet />} {redeeming ? 'Redeeming…' : 'Redeem to store credit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GiftCardsPage;
