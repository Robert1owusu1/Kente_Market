// Pages/OrderDetails/SellItBackModal.tsx
// Customer offers a delivered item back to the marketplace. Approval is
// reviewed by an admin; on approval the stock is restocked and the customer
// is offered the buyback price.
import { useState } from 'react';
import { toast } from 'react-toastify';
import { FaRecycle, FaSpinner, FaTag, FaCommentAlt, FaMinus, FaPlus } from 'react-icons/fa';
import { useCreateBuybackRequestMutation } from '../../slices/buybackApiSlice';
import { resolveImageUrl } from '../../utils/imageUrl';

export interface SellBackProduct {
  productId?: number | string;
  /** Order-item JSON also stores the product id under `product`. */
  product?: number | string;
  name?: string;
  title?: string;
  image?: string;
  img?: string;
  price?: number | string;
  basePrice?: number | string;
  quantity?: number | string;
  qty?: number | string;
}

const qtyOf = (p: SellBackProduct) => parseInt(String(p?.quantity || p?.qty || 1), 10) || 1;
const priceOf = (p: SellBackProduct) => parseFloat(String(p?.price || p?.basePrice || 0)) || 0;
const nameOf = (p: SellBackProduct) => p?.name || p?.title || 'This item';
const imgOf = (p: SellBackProduct) => p?.image || p?.img || '';

const SellItBackModal = ({
  orderId,
  product,
  onClose,
  onSuccess,
}: {
  orderId: number | string;
  product: SellBackProduct;
  onClose: () => void;
  onSuccess?: () => void;
}) => {
  const [qty, setQty] = useState(1);
  const [conditionNote, setConditionNote] = useState('');
  const [expectedPrice, setExpectedPrice] = useState('');
  const [createRequest, { isLoading }] = useCreateBuybackRequestMutation();
  const maxQty = qtyOf(product);

  const submit = async () => {
    const productId = product?.productId ?? product?.product;
    if (!productId) {
      toast.error("This item can't be offered back right now.");
      return;
    }
    if (qty < 1 || qty > maxQty) {
      toast.error(`Choose between 1 and ${maxQty} of this item.`);
      return;
    }
    try {
      await createRequest({
        orderId,
        productId,
        quantity: qty,
        conditionNote: conditionNote.trim() || undefined,
        expectedPrice: expectedPrice ? Number(expectedPrice) : undefined,
      }).unwrap();
      toast.success("Sell-it-back request sent. We'll review it and get back to you.");
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(
        (err as { data?: { message?: string }; message?: string })?.data?.message ||
          (err as { message?: string })?.message ||
          'Could not submit the request.',
      );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !isLoading && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <FaRecycle className="text-primary text-xl" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Sell this kente back</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Offer your delivered piece back to the marketplace. An admin will review it and reply with a buyback offer — the stock goes back on sale.
        </p>

        <div className="flex gap-3 items-center mb-4">
          {imgOf(product) && (
            <img src={resolveImageUrl(imgOf(product))} alt={nameOf(product)} className="w-16 h-16 rounded-lg object-cover bg-gray-100 dark:bg-gray-700" />
          )}
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{nameOf(product)}</p>
            {priceOf(product) > 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                You paid {`GH₵${priceOf(product).toFixed(2)}`} for this item
              </p>
            )}
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Quantity ({maxQty} owned)</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <FaMinus />
            </button>
            <span className="w-10 text-center font-semibold text-gray-900 dark:text-white">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <FaPlus />
            </button>
          </div>
        </div>

        <label className="block mb-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <FaTag /> Expected price (GHS, optional)
          </span>
          <input
            type="number"
            min="1"
            value={expectedPrice}
            onChange={(e) => setExpectedPrice(e.target.value)}
            placeholder="e.g. 250"
            className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
        </label>

        <label className="block mb-5">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <FaCommentAlt /> Condition / note (optional)
          </span>
          <textarea
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value)}
            rows={2}
            placeholder="e.g. Worn once at a family celebration — like new, no stains."
            className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
        </label>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isLoading}
            className="flex-1 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <FaSpinner className="animate-spin" /> : <FaRecycle />} Send request
          </button>
        </div>
      </div>
    </div>
  );
};

export default SellItBackModal;