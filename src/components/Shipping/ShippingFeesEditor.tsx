// components/Shipping/ShippingFeesEditor.tsx
// One delivery fee per country, used by the admin (platform defaults) and by
// sellers (their own fees, which replace the platform default for their
// products), and by the admin editing a seller's fees ("seller" mode). The
// server validates and stores everything; this form only collects it. Each seller's parcel is charged separately at checkout.
import React, { useState, type FormEvent } from "react";
import { FaEdit, FaTrash, FaTruck } from "react-icons/fa";
import { toast } from "react-toastify";
import type { ShippingRate, ShippingCarrier, ShippingRateInput } from "../../slices/shippingFeesApiSlice";
import { DESTINATION_CURRENCY, DESTINATION_NAMES, type DestinationCode } from "../../utils/internationalCheckout";
import { describeRate } from "../../utils/shippingFees";

const errorMessage = (err: unknown) => (err as { data?: { message?: string } })?.data?.message;

interface Props {
  /** admin: platform defaults; vendor: the seller's own; seller: admin editing a seller's. */
  mode: "admin" | "vendor" | "seller";
  countries: DestinationCode[];
  rates: ShippingRate[];
  /** Vendor and seller views: the platform default each country falls back to. */
  defaults?: ShippingRate[];
  carriers: ShippingCarrier[];
  onSave: (input: ShippingRateInput) => Promise<unknown>;
  onRemove: (countryCode: string) => Promise<unknown>;
}

const RateForm = ({
  code, current, carriers, onCancel, onSave,
}: {
  code: DestinationCode;
  current?: ShippingRate;
  carriers: ShippingCarrier[];
  onCancel: () => void;
  onSave: (input: ShippingRateInput) => Promise<unknown>;
}) => {
  const currencies = code === "GH" ? ["GHS"] : ["GHS", DESTINATION_CURRENCY[code]];
  const usable = carriers.filter((c) => c.countries.includes(code));
  const [baseCost, setBaseCost] = useState(current ? String(current.baseCost) : "");
  const [freeThreshold, setFreeThreshold] = useState(current?.freeThreshold != null ? String(current.freeThreshold) : "");
  const [currency, setCurrency] = useState(current?.currency || currencies[currencies.length - 1]);
  const [daysMin, setDaysMin] = useState(String(current?.transitDaysMin ?? (code === "GH" ? 2 : 5)));
  const [daysMax, setDaysMax] = useState(String(current?.transitDaysMax ?? (code === "GH" ? 5 : 14)));
  const [carrierCode, setCarrierCode] = useState(current?.carrierCode || usable[0]?.code || "");
  const [saving, setSaving] = useState(false);
  const id = (f: string) => `fee-${code}-${f}`;
  const input = "w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fee = Number(baseCost);
    if (!Number.isFinite(fee) || fee < 0) return toast.error("Enter a delivery fee of 0 or more");
    const free = freeThreshold.trim() === "" ? null : Number(freeThreshold);
    if (free !== null && (!Number.isFinite(free) || free < 0)) return toast.error("Free-delivery amount must be 0 or more");
    setSaving(true);
    try {
      await onSave({
        countryCode: code, baseCost: fee, freeThreshold: free, currency,
        transitDaysMin: Number(daysMin), transitDaysMax: Number(daysMax), carrierCode,
      });
      toast.success(`Delivery fee for ${DESTINATION_NAMES[code]} saved`);
      onCancel();
    } catch (err) {
      toast.error(errorMessage(err) || "Could not save the delivery fee");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2 dark:bg-gray-900/40">
      <div>
        <label htmlFor={id("fee")} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Delivery fee</label>
        <div className="flex gap-2">
          <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${input} w-24 shrink-0`}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input id={id("fee")} type="number" inputMode="decimal" min="0" step="0.01" required value={baseCost} onChange={(e) => setBaseCost(e.target.value)} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor={id("free")} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Free delivery when the order is over (optional)</label>
        <input id={id("free")} type="number" inputMode="decimal" min="0" step="0.01" value={freeThreshold} onChange={(e) => setFreeThreshold(e.target.value)} placeholder="Leave empty for never free" className={input} />
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Delivery time (days)</span>
        <div className="flex items-center gap-2">
          <input aria-label="Fastest delivery, days" type="number" min="0" max="120" required value={daysMin} onChange={(e) => setDaysMin(e.target.value)} className={input} />
          <span className="text-gray-500">to</span>
          <input aria-label="Slowest delivery, days" type="number" min="0" max="180" required value={daysMax} onChange={(e) => setDaysMax(e.target.value)} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor={id("carrier")} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Courier</label>
        <select id={id("carrier")} value={carrierCode} onChange={(e) => setCarrierCode(e.target.value)} className={input}>
          {usable.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </div>
      {currency !== "GHS" && (
        <p className="text-xs text-gray-600 sm:col-span-2 dark:text-gray-400">
          Customers pay in Ghana cedis; this fee is converted with today's exchange rate.
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" disabled={saving} className="btn btn-primary min-h-10 px-4 text-sm">{saving ? "Saving…" : "Save fee"}</button>
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-600">Cancel</button>
      </div>
    </form>
  );
};

const ShippingFeesEditor = ({ mode, countries, rates, defaults = [], carriers, onSave, onRemove }: Props) => {
  const [editing, setEditing] = useState<DestinationCode | null>(null);

  const remove = async (code: DestinationCode) => {
    const after = mode === "admin"
      ? "Delivery there will be unavailable, except from sellers with their own fee."
      : "The platform default will apply.";
    if (!window.confirm(`Remove the delivery fee for ${DESTINATION_NAMES[code]}? ${after}`)) return;
    try {
      await onRemove(code);
      toast.success("Delivery fee removed");
    } catch (err) {
      toast.error(errorMessage(err) || "Could not remove the delivery fee");
    }
  };

  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
      {countries.map((code) => {
        const own = rates.find((r) => r.countryCode === code);
        const fallback = defaults.find((r) => r.countryCode === code);
        const ownLabel = mode === "vendor" ? "Your fee: " : mode === "seller" ? "Seller's fee: " : "";
        return (
          <li key={code} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white">
                  <FaTruck aria-hidden="true" className="mr-2 inline text-amber-700 dark:text-amber-400" />
                  {DESTINATION_NAMES[code]}
                </p>
                <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                  {own
                    ? <>{ownLabel}{describeRate(own)}</>
                    : mode !== "admin"
                      ? <>Platform default{fallback ? `: ${describeRate(fallback)}` : `: not set — ${mode === "vendor" ? "set your own fee" : "set a fee for this seller"} to deliver here`}</>
                      : "Not set — delivery to this country is unavailable"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setEditing(editing === code ? null : code)} aria-expanded={editing === code} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-600">
                  <FaEdit aria-hidden="true" /> {own ? "Edit" : mode === "vendor" ? "Set my fee" : mode === "seller" ? "Set seller fee" : "Set fee"}
                </button>
                {own && !(mode === "admin" && code === "GH") && (
                  <button type="button" onClick={() => remove(code)} aria-label={`Remove the delivery fee for ${DESTINATION_NAMES[code]}`} className="inline-flex min-h-10 items-center rounded-lg border border-red-300 px-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
                    <FaTrash aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            {editing === code && (
              <RateForm code={code} current={own} carriers={carriers} onCancel={() => setEditing(null)} onSave={onSave} />
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default ShippingFeesEditor;
