import React, { useState } from "react";
import { toast } from "react-toastify";
import { FaSpinner, FaPhoneAlt, FaCheckCircle, FaPalette, FaYarn, FaClock } from "react-icons/fa";
import {
  useGetAllCustomRequestsQuery,
  useGetCustomRequestStatsQuery,
  useMarkCustomRequestReviewedMutation,
} from "../../../slices/customRequestsApiSlice";
import type { CustomRequest } from "../../types/domain";

const PILL: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  quoted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  accepted: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  paid: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  in_progress: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  declined: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
};

const FILTERS = ["all", "pending", "quoted", "accepted", "paid", "in_progress", "completed", "cancelled", "declined"] as const;

export default function CustomRequestsAdmin() {
  const { data: requests, isLoading, isError } = useGetAllCustomRequestsQuery();
  const { data: stats } = useGetCustomRequestStatsQuery();
  const [markedReviewed, { isLoading: marking }] = useMarkCustomRequestReviewedMutation();
  const [filter, setFilter] = useState<string>("all");

  const list = (requests || []).filter((r) => filter === "all" || r.status === filter);
  const unreviewedPending = (requests || []).filter((r) => !r.adminReviewed).length;

  const handleMark = async (id: number | string) => {
    try {
      await markedReviewed(id as number).unwrap();
      toast.success("Marked as reviewed — support has followed up.");
    } catch {
      toast.error("Could not update the request.");
    }
  };

  const slaOverdue = (stats as { slaOverdue?: number } | undefined)?.slaOverdue ?? 0;

  const statCards: { label: string; value: number | string; alert?: boolean }[] = [
    { label: "Total requests", value: stats?.total ?? list.length },
    { label: "Awaiting follow-up call", value: unreviewedPending },
    { label: "SLA overdue (48h)", value: slaOverdue, alert: slaOverdue > 0 },
    { label: "Avg. quoted (GHS)", value: stats?.avgQuote ? Number(stats.avgQuote).toLocaleString() : "—" },
    { label: "Paid & weaving", value: stats?.paid ?? 0 },
  ];

  const cancelReasons: { reason: string; count: number }[] = Array.isArray(stats?.topCancelReasons) ? stats.topCancelReasons : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Custom Requests</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Buyers request a custom weave → the vendor quotes → the buyer pays. When a thread closes early we call the customer, then mark it reviewed.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 ${s.alert ? 'ring-2 ring-red-500/60' : ''}`}>
            <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.alert ? 'text-red-600 dark:text-red-400 animate-pulse' : 'text-gray-900 dark:text-white'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {cancelReasons.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Why custom requests fall through</h3>
          <div className="flex flex-wrap gap-2">
            {cancelReasons.map((r, i) => (
              <span key={i} className="px-3 py-1 rounded-full bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs font-medium">
                "{r.reason}" ×{r.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${
              filter === f ? "bg-primary text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-center py-12 text-gray-500"><FaSpinner className="animate-spin inline mr-2" /> Loading…</div>}
      {isError && <div className="text-center py-12 text-red-500">Could not load custom requests.</div>}

      {!isLoading && !isError && list.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center text-gray-500 dark:text-gray-400">No requests in this view.</div>
      )}

      <div className="space-y-3">
        {list.map((r: CustomRequest) => (
          <div key={String(r.id)} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-gray-900 dark:text-white">
                  #{r.id} · {r.baseProductTitle || "Custom kente"} · {r.yards} yd
                </p>
                <p className="text-gray-500 dark:text-gray-400">
                  {r.customerName} · {r.customerEmail}
                </p>
                <p className="text-gray-500 dark:text-gray-400">
                  Weaver: {r.vendorBusinessName} {r.vendorStatus && `(${r.vendorStatus})`} · order {r.orderId || "—"}
                </p>
                <p className="text-gray-500 dark:text-gray-400 flex items-center gap-1 flex-wrap">
                  <FaClock /> needed by {r.neededForDate?.slice(0, 10)} {r.neededForTime} ·{" "}
                  <FaPalette className="text-primary" /> {r.colours?.join(", ") || "—"} ·{" "}
                  <FaYarn className="text-primary" /> {r.threadTypes?.join(", ") || "—"}
                </p>
                {r.description && <p className="text-gray-600 dark:text-gray-300 italic">"{r.description}"</p>}
                {r.vendorMessage && <p className="text-gray-600 dark:text-gray-300">Weaver note: {r.vendorMessage}</p>}
                {r.customerCancelReason && <p className="text-red-500">Cancellation reason: {r.customerCancelReason}</p>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${PILL[r.status] || ""}`}>
                  {r.status.replace("_", " ")}{r.orderId ? " · paid" : ""}
                </span>
                {Number(r.vendorQuotePrice) > 0 && (
                  <span className="text-sm font-bold text-gray-900 dark:text-white">GHS {Number(r.vendorQuotePrice).toLocaleString()}</span>
                )}
                {!r.adminReviewed ? (
                  <button
                    onClick={() => handleMark(r.id as number)}
                    disabled={marking}
                    className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1"
                  >
                    {marking ? <FaSpinner className="animate-spin" /> : <FaPhoneAlt />} Follow-up call done
                  </button>
                ) : (
                  <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <FaCheckCircle /> Followed up
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}