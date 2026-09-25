import React, { useState } from "react";
import { toast } from "react-toastify";
import { FaHandshake, FaReply, FaSpinner, FaHammer, FaTimes, FaPalette, FaYarn, FaClock, FaUser } from "react-icons/fa";
import {
  useGetVendorCustomRequestsQuery,
  useQuoteCustomRequestMutation,
  useDeclineCustomRequestMutation,
  useStartCustomRequestMutation,
} from "../../slices/customRequestsApiSlice";
import type { CustomRequest } from "../../types/domain";
import { resolveImageUrl } from "../../utils/imageUrl";

export default function VendorCustomRequests() {
  const { data: requests, isLoading, isError } = useGetVendorCustomRequestsQuery();
  const [quoteTarget, setQuoteTarget] = useState<CustomRequest | null>(null);
  const [declineTarget, setDeclineTarget] = useState<CustomRequest | null>(null);

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500"><FaSpinner className="animate-spin inline mr-2" /> Loading requests…</div>;
  }
  if (isError) {
    return <div className="text-center py-12 text-red-500">Could not load custom requests.</div>;
  }

  const list = requests || [];
  const pending = list.filter((r) => r.status === "pending");
  const live = list.filter((r) => ["quoted", "accepted", "paid", "in_progress"].includes(r.status));
  const closed = list.filter((r) => ["completed", "cancelled", "declined"].includes(r.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Custom Requests</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{pending.length} waiting for your quote.</p>
        </div>
      </div>

      {pending.length > 0 && (
        <Section title={`New requests (${pending.length})`}>
          {pending.map((r) => (
            <RequestRow key={String(r.id)} req={r} onQuote={() => setQuoteTarget(r)} onDecline={() => setDeclineTarget(r)} />
          ))}
        </Section>
      )}

      {live.length > 0 && (
        <Section title="In conversation">
          {live.map((r) => <RequestRow key={String(r.id)} req={r} />)}
        </Section>
      )}

      {closed.length > 0 && (
        <Section title="Closed">
          {closed.map((r) => <RequestRow key={String(r.id)} req={r} />)}
        </Section>
      )}

      {list.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center text-gray-500 dark:text-gray-400">
          No custom requests yet. When a buyer picks "Customize this kente" on one of your products, the request lands here.
        </div>
      )}

      {quoteTarget && <QuoteModal req={quoteTarget} onClose={() => setQuoteTarget(null)} />}
      {declineTarget && <DeclineModal req={declineTarget} onClose={() => setDeclineTarget(null)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const STATUS_PILL: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  quoted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  accepted: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  paid: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  in_progress: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  declined: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
};

function RequestRow({ req, onQuote, onDecline }: {
  req: CustomRequest;
  onQuote?: () => void;
  onDecline?: () => void;
}) {
  const [startMutation, { isLoading: starting }] = useStartCustomRequestMutation();
  const price = Number(req.vendorQuotePrice);

  const handleStart = async () => {
    try {
      await startMutation(req.id as number).unwrap();
      toast.success("Marked as in progress.");
    } catch {
      toast.error("Could not update the request.");
    }
  };

  // Only hand a reference image to <a href> when it resolves to http(s):
  // javascript:, data:, vbscript: or other schemes in a user-supplied URL
  // would execute in our origin when the vendor clicks the link.
  const referenceImageUrl = resolveImageUrl(req.referenceImage);
  const safeReferenceImageUrl =
    referenceImageUrl && /^https?:\/\//i.test(referenceImageUrl) ? referenceImageUrl : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="font-semibold text-gray-900 dark:text-white">
            {req.baseProductTitle || "Custom kente"} · {req.yards} yd
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <FaUser /> {req.customerName} · {req.customerEmail}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <FaClock /> Needed by {req.neededForDate?.slice(0, 10)} {req.neededForTime}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 flex-wrap">
            <FaPalette className="text-primary" /> {req.colours?.join(", ") || "—"} {req.dominantColour && `(${req.dominantColour} dominant)`}
            <span className="mx-1">·</span>
            <FaYarn className="text-primary" /> {req.threadTypes?.join(", ") || "—"} {req.dominantThread && `(${req.dominantThread})`}
          </p>
          {req.description && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 italic">"{req.description}"</p>}
          {safeReferenceImageUrl && (
            <a href={safeReferenceImageUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">View reference image</a>
          )}
          {req.vendorMessage && <p className="text-xs bg-gray-100 dark:bg-gray-700/50 rounded p-2 text-gray-600 dark:text-gray-300">Your reply: {req.vendorMessage}</p>}
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_PILL[req.status] || ""}`}>
            {req.status.replace("_", " ")}
          </span>
          {price > 0 && <span className="text-sm font-bold text-gray-900 dark:text-white">GHS {price.toLocaleString()}</span>}
          {req.status === "pending" && onQuote && (
            <div className="flex gap-2">
              <button onClick={onQuote} className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-semibold">Respond with quote</button>
              {onDecline && <button onClick={onDecline} className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300">Decline</button>}
            </div>
          )}
          {req.status === "paid" && (
            <button onClick={handleStart} disabled={starting} className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-1">
              {starting ? <FaSpinner className="animate-spin" /> : <FaHammer />} Start weaving
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuoteModal({ req, onClose }: { req: CustomRequest; onClose: () => void }) {
  const [quote] = useQuoteCustomRequestMutation();
  const [price, setPrice] = useState("");
  const [canMeet, setCanMeet] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    const p = parseFloat(price);
    if (!p || p <= 0) {
      setError("Enter a valid quote price in GHS.");
      return;
    }
    try {
      await quote({ id: req.id as number, vendorQuotePrice: p, vendorCanMeet: canMeet, vendorMessage: message.trim() || undefined }).unwrap();
      toast.success("Quote sent to the customer.");
      onClose();
    } catch (err) {
      const msg = (err as { data?: { message?: string } })?.data?.message || "Could not send the quote.";
      setError(msg);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white">Quote for {req.yards} yd {req.baseProductTitle || "custom kente"}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Needed by {req.neededForDate?.slice(0, 10)} {req.neededForTime} · {req.customerName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><FaTimes /></button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Your price (GHS)</label>
          <input
            type="number"
            min="1"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 450"
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Can you meet the requested date?</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setCanMeet(true)}
              className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm font-medium ${canMeet ? "border-primary bg-primary text-white" : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"}`}>
              Yes, I can
            </button>
            <button type="button" onClick={() => setCanMeet(false)}
              className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm font-medium ${!canMeet ? "border-amber-500 bg-amber-500 text-white" : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"}`}>
              Not exactly
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message to the customer</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
            placeholder="Deposit rule, finish details, delivery estimate…"
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary" />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2">
          <button onClick={handleSubmit} className="flex-1 px-4 py-2 bg-primary text-white rounded-xl font-semibold flex items-center justify-center gap-2">
            <FaHandshake /> Send quote
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function DeclineModal({ req, onClose }: { req: CustomRequest; onClose: () => void }) {
  const [decline, { isLoading }] = useDeclineCustomRequestMutation();
  const [message, setMessage] = useState("");

  const handleDecline = async () => {
    try {
      await decline({ id: req.id as number, vendorMessage: message.trim() || undefined }).unwrap();
      toast.success("Request declined. The customer has been notified.");
      onClose();
    } catch {
      toast.error("Could not decline the request.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 dark:text-white">Decline this request?</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">A short note helps the buyer (and our team) understand why.</p>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          placeholder="e.g. Loom booked through the end of the month"
          className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary" />
        <div className="flex gap-2">
          <button onClick={handleDecline} disabled={isLoading}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {isLoading && <FaSpinner className="animate-spin" />} <FaReply className="rotate-180" /> Decline request
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300">Keep</button>
        </div>
      </div>
    </div>
  );
}