// Pages/adminDashboardPages/Buyback/BuybackAdmin.tsx
// Admin reviews sell-back requests: approve with an offer price (stock is
// restocked on approval) or decline. Mirror of the customer's Sell-It-Back flow.
import { useState } from "react";
import { toast } from "react-toastify";
import { FaSpinner, FaUndo, FaRecycle, FaCheckCircle, FaTimesCircle, FaImage } from "react-icons/fa";
import { useGetAllBuybackRequestsQuery, useReviewBuybackRequestMutation, type BuybackRequest } from "../../../slices/buybackApiSlice";
import { formatCedi } from "../../../utils/formatCurrency";
import { resolveImageUrl } from "../../../utils/imageUrl";

type Tab = "all" | "pending" | "approved" | "declined";

const PILL: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  declined: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function BuybackAdmin() {
  const [tab, setTab] = useState<Tab>("pending");
  const [modal, setModal] = useState<null | { request: BuybackRequest; decision: "approved" | "declined" }>(null);
  const [buybackPrice, setBuybackPrice] = useState("");
  const [adminNote, setAdminNote] = useState("");

  const { data, isLoading, isError, refetch } = useGetAllBuybackRequestsQuery(undefined, { refetchOnMountOrArgChange: true });
  const [review, { isLoading: reviewing }] = useReviewBuybackRequestMutation();

  const requests = data?.requests || [];
  const list = tab === "all" ? requests : requests.filter((r) => r.status === tab);
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  const openModal = (request: BuybackRequest, decision: "approved" | "declined") => {
    setModal({ request, decision });
    setBuybackPrice(request.expectedPrice ? String(request.expectedPrice) : "");
    setAdminNote("");
  };

  const submit = async () => {
    if (!modal) return;
    const { request, decision } = modal;
    if (decision === "approved" && (!buybackPrice || Number(buybackPrice) <= 0)) {
      toast.error("Enter a buyback price greater than 0.");
      return;
    }
    try {
      await review({
        id: request.id,
        decision,
        buybackPrice: decision === "approved" ? Number(buybackPrice) : undefined,
        adminNote: adminNote.trim() || undefined,
      }).unwrap();
      toast.success(decision === "approved" ? "Offer approved — stock restocked and customer notified." : "Request declined and customer notified.");
      setModal(null);
      refetch();
    } catch (err) {
      toast.error((err as { data?: { message?: string }; message?: string })?.data?.message || "Could not review the request.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <FaRecycle className="text-primary" /> Sell-It-Back
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Buyers offer delivered kente back to the marketplace. Approving restocks the item and credits the customer; declining just notifies them.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["pending", "all", "approved", "declined"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${
              tab === t ? "bg-primary text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
            }`}
          >
            {t}
            {t === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-xs">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-center py-12 text-gray-500"><FaSpinner className="animate-spin inline mr-2" /> Loading…</div>}
      {isError && <div className="text-center py-12 text-red-500">Could not load sell-back requests.</div>}

      {!isLoading && !isError && list.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center text-gray-500 dark:text-gray-400">
          <FaUndo className="mx-auto text-4xl mb-3 opacity-50" />
          No sell-back requests here.
        </div>
      )}

      <div className="space-y-3">
        {list.map((r) => (
          <div key={String(r.id)} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-start gap-4">
            {r.productImage ? (
              <img
                src={resolveImageUrl(r.productImage)}
                alt={r.productTitle || "product"}
                className="w-16 h-16 rounded-lg object-cover bg-gray-100 dark:bg-gray-700"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400">
                <FaImage />
              </div>
            )}
            <div className="flex-1 min-w-[200px] space-y-1 text-sm">
              <p className="font-semibold text-gray-900 dark:text-white">
                #{r.id} · {r.productTitle || "Kente item"} · ×{r.quantity}
              </p>
              <p className="text-gray-500 dark:text-gray-400">
                {r.firstName} {r.lastName} · {r.email} · order {r.orderNumber || r.orderId}
              </p>
              {r.conditionNote && <p className="text-gray-600 dark:text-gray-300 italic">"{r.conditionNote}"</p>}
              {r.adminNote && <p className="text-gray-600 dark:text-gray-300">Note: {r.adminNote}</p>}
              <p className="text-gray-500 dark:text-gray-400">
                Expected: {r.expectedPrice ? formatCedi(Number(r.expectedPrice)) : "—"}
                {r.buybackPrice ? ` · Offer: ${formatCedi(Number(r.buybackPrice))}` : ""}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${PILL[r.status] || ""}`}>{r.status}</span>
              {r.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => openModal(r, "approved")}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 flex items-center gap-1"
                  >
                    <FaCheckCircle /> Approve
                  </button>
                  <button
                    onClick={() => openModal(r, "declined")}
                    className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600 flex items-center gap-1"
                  >
                    <FaTimesCircle /> Decline
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !reviewing && setModal(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              {modal.decision === "approved" ? "Approve sell-back" : "Decline sell-back"}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {r_txt(modal.request)}
            </p>
            {modal.decision === "approved" && (
              <label className="block mb-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Buyback price (GHS)</span>
                <input
                  type="number"
                  min="1"
                  value={buybackPrice}
                  onChange={(e) => setBuybackPrice(e.target.value)}
                  placeholder="e.g. 250"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </label>
            )}
            <label className="block mb-4">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Note to customer (optional)</span>
              <textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={2}
                placeholder="e.g. We will pick up the piece at your next delivery stop."
                className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </label>
            <div className="flex gap-3">
              <button
                onClick={submit}
                disabled={reviewing}
                className={`flex-1 px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2 ${
                  modal.decision === "approved" ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"
                }`}
              >
                {reviewing ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
                {modal.decision === "approved" ? "Approve & restock" : "Decline request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function r_txt(request: BuybackRequest): string {
  return `${request.productTitle || "This item"} ×${request.quantity} from order ${request.orderNumber || request.orderId} — customer expects ${request.expectedPrice ? formatCedi(Number(request.expectedPrice)) : "a fair price"}.`;
}