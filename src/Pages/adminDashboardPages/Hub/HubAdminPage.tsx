// Pages/adminDashboardPages/Hub/HubAdminPage.tsx
// Parcels the platform delivers: sellers who chose "the platform delivers"
// drop them at the hub. The admin confirms each parcel arrived, then moves it
// on (on its way -> arrived -> delivered) with a tracking number. Each seller's
// parcel moves on its own; the order follows the slowest parcel.
// Also where the hub address sellers see is set.
import React, { useState } from "react";
import { toast } from "react-toastify";
import { FaWarehouse, FaCheckCircle, FaTruck, FaSpinner, FaMapMarkerAlt } from "react-icons/fa";
import Loader from "../../../components/loader/Loader";
import {
  useGetHubParcelsQuery,
  useSetHubAddressMutation,
  useReceiveHubParcelMutation,
  useMoveHubParcelMutation,
  type HubParcel,
} from "../../../slices/deliveryApiSlice";

const errorMessage = (err: unknown) => (err as { data?: { message?: string } })?.data?.message;

const NEXT: Record<string, { status: string; label: string } | undefined> = {
  processing: { status: "shipped", label: "Mark as On its way" },
  packaging: { status: "shipped", label: "Mark as On its way" },
  shipped: { status: "arrived", label: "Mark as Arrived" },
  arrived: { status: "delivered", label: "Mark as Delivered" },
};

const stage = (p: HubParcel) => {
  if (p.parcelStatus === "delivered") return { label: "Delivered", cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
  if (p.parcelStatus === "arrived") return { label: "Arrived", cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
  if (p.parcelStatus === "shipped") return { label: "On its way", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" };
  if (p.hubReceivedAt) return { label: "At the hub", cls: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300" };
  if (p.handedOverAt) return { label: "Seller says dropped off", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" };
  return { label: "Waiting for the seller", cls: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300" };
};

const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null);

const HubAddress = ({ current }: { current: string }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [save, { isLoading }] = useSetHubAddressMutation();
  const value = draft ?? current;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save(value.trim()).unwrap();
      setDraft(null);
      toast.success("Hub address saved");
    } catch (err) {
      toast.error(errorMessage(err) || "Could not save the hub address");
    }
  };
  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <label htmlFor="hub-address" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
        <FaMapMarkerAlt aria-hidden="true" className="text-amber-700 dark:text-amber-400" /> Hub address
      </label>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Sellers see this on their Shipping and Orders pages as the drop-off point.</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          id="hub-address"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Bonwire Kente Hub, 12 Adum Street, Kumasi · open Mon–Sat 9:00–17:00"
          className="w-full flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        <button
          type="submit"
          disabled={isLoading || value.trim() === current.trim()}
          className="min-h-11 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </form>
  );
};

const ParcelCard = ({ parcel }: { parcel: HubParcel }) => {
  const [tracking, setTracking] = useState("");
  const [receive, { isLoading: receiving }] = useReceiveHubParcelMutation();
  const [move, { isLoading: moving }] = useMoveHubParcelMutation();
  const s = stage(parcel);
  const next = NEXT[parcel.parcelStatus];
  const d = parcel.destination;

  const markReceived = async () => {
    try {
      await receive({ orderId: parcel.orderId, vendorId: parcel.vendorId }).unwrap();
      toast.success(`${parcel.orderNumber}: parcel received at the hub`);
    } catch (err) {
      toast.error(errorMessage(err) || "Could not record the parcel");
    }
  };
  const moveOn = async () => {
    if (!next) return;
    try {
      await move({ orderId: parcel.orderId, vendorId: parcel.vendorId, orderStatus: next.status, trackingNumber: tracking.trim() || undefined }).unwrap();
      setTracking("");
      toast.success(`${parcel.orderNumber}: ${next.label.replace("Mark as ", "").toLowerCase()}`);
    } catch (err) {
      toast.error(errorMessage(err) || "Could not update the parcel");
    }
  };

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">{parcel.orderNumber}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            From {parcel.sellerName}{parcel.sellerPhone ? ` · ${parcel.sellerPhone}` : ""}
          </p>
        </div>
        <span className={`self-start rounded-full px-3 py-1 text-xs font-medium ${s.cls}`}>{s.label}</span>
      </div>

      <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">
        <span className="font-medium">Deliver to: </span>
        {d.deliveryMethod === "pickup" && d.pickupStation
          ? `Pickup station ${d.pickupStation} — ${d.recipient || "customer"}`
          : [d.recipient, d.address, d.city, d.region, d.postalCode, d.country].filter(Boolean).join(", ")}
        {d.phone ? ` · ${d.phone}` : ""}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {[
          parcel.handedOverAt && `Dropped off ${when(parcel.handedOverAt)}`,
          parcel.hubReceivedAt && `received ${when(parcel.hubReceivedAt)}`,
          parcel.trackingNumber && `tracking ${parcel.trackingNumber}`,
        ].filter(Boolean).join(" · ") || `Ordered ${when(parcel.placedAt)}`}
      </p>

      {parcel.parcelStatus !== "delivered" && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {!parcel.hubReceivedAt ? (
            <button
              type="button"
              onClick={markReceived}
              disabled={receiving}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {receiving ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />} Received at the hub
            </button>
          ) : next ? (
            <>
              {next.status === "shipped" && (
                <>
                  <label htmlFor={`trk-${parcel.orderId}-${parcel.vendorId}`} className="sr-only">Tracking number</label>
                  <input
                    id={`trk-${parcel.orderId}-${parcel.vendorId}`}
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                    placeholder="Tracking number (optional)"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 sm:w-56 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </>
              )}
              <button
                type="button"
                onClick={moveOn}
                disabled={moving}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {moving ? <FaSpinner className="animate-spin" /> : <FaTruck />} {next.label}
              </button>
            </>
          ) : null}
        </div>
      )}
    </li>
  );
};

const HubAdminPage = () => {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError } = useGetHubParcelsQuery({ all: showAll });
  const parcels = data?.parcels || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
          <FaWarehouse aria-hidden="true" className="text-amber-700 dark:text-amber-400" /> Delivery hub
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Parcels from sellers who let the platform deliver. Confirm each one when it reaches the hub, then send it on.
          The platform keeps these delivery fees.
        </p>
      </div>

      <HubAddress current={data?.hubAddress || ""} />

      <section aria-labelledby="hub-parcels">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="hub-parcels" className="text-lg font-semibold text-gray-900 dark:text-white">Parcels</h2>
          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" className="h-4 w-4 accent-amber-600" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Include delivered
          </label>
        </div>
        {isLoading ? <Loader /> : isError ? (
          <p className="text-sm text-red-700 dark:text-red-400">Could not load hub parcels.</p>
        ) : parcels.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">
            No parcels for the hub right now.
          </p>
        ) : (
          <ul className="space-y-3">
            {parcels.map((p) => <ParcelCard key={`${p.orderId}-${p.vendorId}`} parcel={p} />)}
          </ul>
        )}
      </section>
    </div>
  );
};

export default HubAdminPage;
