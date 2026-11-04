// FILE LOCATION: src/Pages/AllProducts/BulkQuoteButton.tsx
// DESCRIPTION: Buyer action to request a B2B bulk quote on a wholesale-enabled
//   product (Phase 3, Step 9). Only shows when the product offers wholesale.
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaBoxes, FaSpinner } from 'react-icons/fa';
import { useCreateBulkQuoteMutation } from '../../slices/wholesaleApiSlice';
import type { RootState } from '../../store';

const BulkQuoteButton = ({ productId, minQty }: { productId: number; minQty?: number | null }) => {
  const navigate = useNavigate();
  const userInfo = useSelector((s: RootState) => s.auth?.userInfo);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(minQty && minQty > 0 ? String(minQty) : '10');
  const [companyName, setCompanyName] = useState('');
  const [message, setMessage] = useState('');
  const [create, { isLoading }] = useCreateBulkQuoteMutation();

  const submit = async () => {
    const qty = Math.floor(Number(quantity));
    if (!Number.isInteger(qty) || qty < 1) { toast.error('Enter a valid quantity'); return; }
    try {
      await create({ productId, quantity: qty, companyName: companyName || undefined, message: message || undefined }).unwrap();
      toast.success('Bulk quote request sent — the seller will respond with a price.');
      setOpen(false);
    } catch (e) {
      toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not send request');
    }
  };

  return (
    <div className="w-full mt-3">
      <button
        onClick={() => (userInfo ? setOpen((o) => !o) : navigate('/login'))}
        className="w-full px-6 py-3 border-2 border-emerald-600 text-emerald-700 dark:text-emerald-400 rounded-xl font-semibold hover:bg-emerald-50 dark:hover:bg-gray-800 transition flex items-center justify-center gap-2"
      >
        <FaBoxes /> Buying in bulk? Request a wholesale quote
      </button>

      {open && (
        <div className="mt-3 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-gray-800 space-y-3">
          {minQty ? <p className="text-xs text-gray-500 dark:text-gray-400">Minimum wholesale quantity: {minQty}</p> : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600 dark:text-gray-400">
              Quantity
              <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)}
                className="block mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </label>
            <label className="text-xs text-gray-600 dark:text-gray-400">
              Company / organisation (optional)
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                className="block mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </label>
          </div>
          <label className="text-xs text-gray-600 dark:text-gray-400 block">
            Message (optional)
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
              className="block mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </label>
          <button onClick={submit} disabled={isLoading}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-60">
            {isLoading ? <FaSpinner className="animate-spin" /> : <FaBoxes />} Send request
          </button>
        </div>
      )}
    </div>
  );
};

export default BulkQuoteButton;
