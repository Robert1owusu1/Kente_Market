import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FaReply, FaSpinner, FaTimes, FaCheckCircle, FaHourglassHalf, FaHandshake, FaCreditCard, FaHammer, FaBoxOpen, FaClock, FaPalette, FaYarn, FaMagic } from "react-icons/fa";
import {
  useGetMyCustomRequestsQuery,
  useAcceptCustomRequestMutation,
  useCancelCustomRequestMutation,
} from "../../slices/customRequestsApiSlice";
import type { CustomRequest, CustomRequestStatus } from "../../types/domain";

const STATUS_META: Record<CustomRequestStatus, { label: string; icon: React.ComponentType; color: string }> = {
  pending: { label: "Awaiting quote", icon: FaHourglassHalf, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  quoted: { label: "Quote received", icon: FaHandshake, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  accepted: { label: "Approved — awaiting payment", icon: FaCreditCard, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  paid: { label: "Paid — on the loom", icon: FaHammer, color: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  in_progress: { label: "Cut & finished", icon: FaHammer, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  completed: { label: "Completed", icon: FaBoxOpen, color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  cancelled: { label: "Cancelled", icon: FaTimes, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  declined: { label: "Declined", icon: FaTimes, color: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300" },
};

const STATUS_STEPS: CustomRequestStatus[] = ["pending", "quoted", "accepted", "paid", "in_progress", "completed"];

function StatusTimeline({ status }: { status: CustomRequestStatus }) {
  const currentIndex = STATUS_STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1 mb-3 flex-wrap">
      {STATUS_STEPS.map((step, i) => {
        const done = currentIndex >= i;
        return (
          <React.Fragment key={step}>
            {i > 0 && <span className={`w-6 sm:w-10 h-0.5 ${done ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"}`} />}
            <span
              className={`w-3 h-3 rounded-full ${done ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"}`}
              title={STATUS_META[step].label}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RequestCard({ request }: { request: CustomRequest }) {
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const [acceptMutation] = useAcceptCustomRequestMutation();
  const [cancelMutation] = useCancelCustomRequestMutation();

  const meta = STATUS_META[request.status] || STATUS_META.pending;
  const Icon = meta.icon;
  const price = Number(request.vendorQuotePrice);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await acceptMutation(request.id as number).unwrap();
      toast.success("Quote accepted — you can now pay to lock it in.");
    } catch {
      toast.error("Could not accept the quote. Try again.");
    } finally {
      setAccepting(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please tell us why you're cancelling — it helps the weavers.");
      return;
    }
    setCancelling(true);
    try {
      await cancelMutation({ id: request.id as number, customerCancelReason: cancelReason.trim() }).unwrap();
      toast.success("Request cancelled.");
      setShowCancel(false);
      setCancelReason("");
    } catch {
      toast.error("Could not cancel the request.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">
              {request.baseProductTitle || "Custom kente"} · {request.yards} yd
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{request.vendorBusinessName}</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${meta.color}`}>
          <Icon /> {meta.label}
        </span>
      </div>

      <StatusTimeline status={request.status} />

      {!request.status.includes("ed") && (request.status === "pending" || request.status === "quoted") && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Needed by: <span className="font-medium">{request.neededForDate?.slice(0, 10)} {request.neededForTime}</span> ·{" "}
          <FaPalette className="inline text-primary" /> {request.colours?.length ? request.colours.join(", ") : "—"} ·{request.dominantColour ? ` ${request.dominantColour} dominant ·` : ""}{" "}
          <FaYarn className="inline text-primary" /> {request.threadTypes?.length ? request.threadTypes.join(", ") : "—"}
        </p>
      )}

      {request.vendorMessage && (
        <div className="rounded-xl bg-gray-100 dark:bg-gray-700/50 p-3 text-sm text-gray-700 dark:text-gray-300 mb-3">
          <span className="font-semibold text-primary">{request.vendorBusinessName}:</span> {request.vendorMessage}
        </div>
      )}

      {(request.status === "quoted" || request.status === "accepted") && price > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary/5 border border-primary/20 p-3 mb-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Vendor quote</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">GHS {price.toLocaleString()}</p>
            {request.vendorCanMeet ? (
              <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><FaCheckCircle /> Can meet your timeline</p>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">Range: cannot meet your exact date</p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              You pay the full quote now. Half releases to the weaver right away; the rest is held in escrow until your kente is delivered.
            </p>
          </div>
          {request.status === "quoted" ? (
            <div className="flex gap-2">
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="px-4 py-2 bg-primary text-white rounded-xl font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                {accepting ? <FaSpinner className="animate-spin" /> : <FaHandshake />} Accept & Pay
              </button>
              <button onClick={() => setShowCancel(true)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300">
                Decline
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate(`/custom-requests/${request.id}/checkout`)}
              className="px-4 py-2 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-semibold flex items-center gap-2"
            >
              <FaCreditCard /> Proceed to Payment
            </button>
          )}
        </div>
      )}

      {request.status === "paid" || request.status === "in_progress" ? (
        <div className="text-sm text-teal-600 dark:text-teal-400 flex flex-col gap-1">
          <p className="flex items-center gap-2">
            <FaHammer /> Payment received — your weaver is on it. Track it in{" "}
            <Link to={`/order/${request.orderId}`} className="underline">your order</Link>.
          </p>
          <p className="flex items-center gap-2 text-xs opacity-80">
            <FaCheckCircle /> Only half was taken now — the balance releases on delivery.
            {request.orderId && (
              <Link to="/certificates" className="underline text-primary">
                View your certificate
              </Link>
            )}
          </p>
        </div>
      ) : null}

      {request.status === "cancelled" && request.customerCancelReason && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Reason: {request.customerCancelReason}</p>
      )}

      {(request.status === "pending" || request.status === "quoted" || request.status === "accepted") && (
        <button onClick={() => setShowCancel(true)} className="mt-2 text-xs text-red-500 hover:underline">
          Cancel this request
        </button>
      )}

      {showCancel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setShowCancel(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 dark:text-white">Cancel this request?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Your reason helps us understand demand and advise weavers. No charge — this just closes the thread.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Why are you cancelling? (e.g. found another weaver, timeline, price…)"
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cancelling && <FaSpinner className="animate-spin" />} Cancel Request
              </button>
              <button onClick={() => setShowCancel(false)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300">
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyCustomRequests() {
  const navigate = useNavigate();
  const { data: requests, isLoading, isError } = useGetMyCustomRequestsQuery();

  const active = (requests || []).filter((r) => !["cancelled", "declined", "completed"].includes(r.status));
  const archived = (requests || []).filter((r) => ["cancelled", "declined", "completed"].includes(r.status));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10">
      <div className="max-w-3xl mx-auto px-4 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">My Custom Requests</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Request a one-of-a-kind weave, approve the quote, and pay securely.</p>
          </div>
          <button onClick={() => navigate("/products")} className="px-4 py-2 bg-primary text-white rounded-xl font-semibold flex items-center gap-2">
            <FaReply className="rotate-180" /> Start a new request
          </button>
        </div>

        {isLoading && <div className="text-center py-12 text-gray-500"><FaSpinner className="animate-spin inline mr-2" /> Loading…</div>}
        {isError && <div className="text-center py-12 text-red-500">Could not load your requests. Please try again.</div>}

        {!isLoading && !isError && requests?.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 text-center">
            <FaMagic className="mx-auto text-4xl text-primary mb-3" />
            <p className="text-gray-600 dark:text-gray-300 mb-4">No custom requests yet. Pick any kente marked "Customizable" and describe your vision.</p>
            <button onClick={() => navigate("/products")} className="px-6 py-3 bg-primary text-white rounded-xl font-semibold">Browse Kente</button>
          </div>
        )}

        {active.length > 0 && (
          <section>
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">In progress</h2>
            <div className="space-y-4">
              {active.map((r) => <RequestCard key={String(r.id)} request={r} />)}
            </div>
          </section>
        )}

        {archived.length > 0 && (
          <section>
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Closed</h2>
            <div className="space-y-4 opacity-75">
              {archived.map((r) => <RequestCard key={String(r.id)} request={r} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}