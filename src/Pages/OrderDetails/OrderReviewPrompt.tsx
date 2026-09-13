import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaStar, FaSpinner, FaQuoteLeft } from "react-icons/fa";
import { useAddOrderReviewMutation } from "../../slices/miscApiSlice";

interface LineItem {
  name?: string;
  title?: string;
  product?: number | string;
  productId?: number | string;
  selectedColor?: string | null;
  yards?: string | number | null;
  selectedSize?: string | null;
}

function Stars({ value, onChange, size = 26 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-label={`${s} star`}
          className={`transition ${s <= value ? "text-amber-400" : "text-gray-300 dark:text-gray-600"}`}
        >
          <FaStar size={size} />
        </button>
      ))}
    </div>
  );
}

export default function OrderReviewPrompt({ orderId, items }: { orderId: number | string; items: LineItem[] }) {
  const navigate = useNavigate();
  const [addReview, { isLoading }] = useAddOrderReviewMutation();

  const reviewable = (items || [])
    .map((it) => ({ product: it.product ?? it.productId, name: it.name || it.title }))
    .filter((p) => p.product != null);

  const [productId, setProductId] = useState<string>(String(reviewable[0]?.product ?? ""));
  const [rating, setRating] = useState(5);
  const [vendorRating, setVendorRating] = useState(5);
  const [comment, setComment] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [done, setDone] = useState(false);

  if (reviewable.length === 0) return null;

  const currentName = reviewable.find((p) => String(p.product) === productId)?.name || "this piece";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) {
      toast.error("Choose the piece you're reviewing.");
      return;
    }
    if (comment.trim().length < 5) {
      toast.error("Please write a short review (5+ characters).");
      return;
    }
    try {
      await addReview({
        orderId: Number(orderId),
        productId: Number(productId),
        rating,
        comment: comment.trim(),
        vendorRating,
        platformSuggestion: suggestion.trim() || undefined,
      }).unwrap();
      toast.success("Thank you! Your verified review helps the community.");
      setDone(true);
    } catch (err) {
      const msg = (err as { data?: { message?: string } })?.data?.message || "Could not save your review. Try again.";
      toast.error(msg);
    }
  };

  if (done) {
    return (
      <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-5 flex items-center justify-between gap-3">
        <p className="text-sm text-green-700 dark:text-green-300 font-medium">
          ✓ Your verified review is live. Thanks for helping other buyers choose well!
        </p>
        <button onClick={() => navigate("/reviews")} className="text-sm text-primary hover:underline whitespace-nowrap">
          See reviews
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6 border-t-4 border-primary">
      <div className="flex items-center gap-2 mb-4">
        <FaQuoteLeft className="text-primary" />
        <h2 className="font-semibold text-gray-900 dark:text-white text-lg">How was your delivery?</h2>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        You've earned a <span className="font-semibold text-green-600 dark:text-green-400">verified purchase</span> review — it carries a badge
        and higher weight on storefronts.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {reviewable.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reviewing</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full max-w-xs px-4 py-2.5 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary"
            >
              {reviewable.map((p) => (
                <option key={String(p.product)} value={String(p.product)}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{currentName}</p>
            <Stars value={rating} onChange={setRating} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">How was the weaver?</p>
            <Stars value={vendorRating} onChange={setVendorRating} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Your review</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            required
            placeholder="Colours, finish, punctuality, packaging — what should the next buyer know?"
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Suggest an improvement for the platform <span className="text-gray-400">(optional)</span>
          </label>
          <input
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            placeholder="e.g. a live progress tracker for woven orders"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {isLoading ? <FaSpinner className="animate-spin" /> : <FaStar />} Post verified review
          </button>
          <button type="button" onClick={() => setDone(true)} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            Not now
          </button>
        </div>
      </form>
    </div>
  );
}