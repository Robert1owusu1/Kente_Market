// Pages/adminDashboardPages/Shipping/ShippingAdminPage.tsx
// Platform default delivery fee per country, every seller's own fees (which
// replace the default for their products; the admin can change or remove
// them), and the automatic exchange rates used to convert fees set in foreign
// currencies into the cedis customers pay.
import React, { useMemo, useState } from "react";
import { toast } from "react-toastify";
import { FaTruck, FaSyncAlt, FaExchangeAlt, FaStore } from "react-icons/fa";
import Loader from "../../../components/loader/Loader";
import ShippingFeesEditor from "../../../components/Shipping/ShippingFeesEditor";
import {
  useGetAdminShippingRatesQuery,
  useSetAdminShippingRateMutation,
  useRemoveAdminShippingRateMutation,
  useGetSellerShippingRatesQuery,
  useSetSellerShippingRateMutation,
  useRemoveSellerShippingRateMutation,
  useGetExchangeRatesQuery,
  useRefreshExchangeRatesMutation,
} from "../../../slices/shippingFeesApiSlice";
import { DESTINATION_NAMES, SUPPORTED_DESTINATION_CODES, type DestinationCode } from "../../../utils/internationalCheckout";

const errorMessage = (err: unknown) => (err as { data?: { message?: string } })?.data?.message;

const SellerFees = () => {
  const { data, isLoading } = useGetSellerShippingRatesQuery();
  const [setRate] = useSetSellerShippingRateMutation();
  const [removeRate] = useRemoveSellerShippingRateMutation();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const sellers = useMemo(() => data?.sellers || [], [data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sellers.filter((s) => (q ? s.businessName.toLowerCase().includes(q) : s.rates.length > 0));
  }, [sellers, search]);
  const selected = sellers.find((s) => s.vendorId === selectedId) || null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
        <FaStore aria-hidden="true" className="text-amber-700 dark:text-amber-400" /> Sellers' own delivery fees
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Fees sellers set for their own products. You can change or remove any of them; removing one puts that seller back on the platform default.
        Search to set a fee for a seller who has none.
      </p>
      <label htmlFor="seller-fee-search" className="sr-only">Search sellers</label>
      <input
        id="seller-fee-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search all sellers by name"
        className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      />
      {isLoading ? <Loader /> : shown.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {search.trim() ? "No seller matches that name." : "No seller has set their own fee; every seller uses the platform default."}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-200 dark:divide-gray-700">
          {shown.map((s) => (
            <li key={s.vendorId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white">
                  {s.businessName}
                  {s.status !== "approved" && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">{s.status}</span>}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {s.rates.length ? `Own fees: ${s.rates.map((r) => DESTINATION_NAMES[r.countryCode as DestinationCode] || r.countryCode).join(", ")}` : "Uses the platform default"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(selectedId === s.vendorId ? null : s.vendorId)}
                aria-expanded={selectedId === s.vendorId}
                className="min-h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-600"
              >
                {selectedId === s.vendorId ? "Close" : "Manage fees"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="mt-4 rounded-lg border border-amber-200 p-3 sm:p-4 dark:border-amber-900">
          <h3 className="font-semibold text-gray-900 dark:text-white">{selected.businessName}</h3>
          <ShippingFeesEditor
            mode="seller"
            countries={[...SUPPORTED_DESTINATION_CODES] as DestinationCode[]}
            rates={selected.rates}
            defaults={data?.platformDefaults || []}
            carriers={data?.carriers || []}
            onSave={(input) => setRate({ ...input, vendorId: selected.vendorId }).unwrap()}
            onRemove={(countryCode) => removeRate({ vendorId: selected.vendorId, countryCode }).unwrap()}
          />
        </div>
      )}
    </section>
  );
};

const ShippingAdminPage = () => {
  const { data, isLoading } = useGetAdminShippingRatesQuery();
  const { data: fx, isLoading: fxLoading } = useGetExchangeRatesQuery();
  const [setRate] = useSetAdminShippingRateMutation();
  const [removeRate] = useRemoveAdminShippingRateMutation();
  const [refresh, { isLoading: refreshing }] = useRefreshExchangeRatesMutation();

  const refreshNow = async () => {
    try {
      const r = await refresh().unwrap();
      if (r.rejected.length) toast.warn(`Kept previous rate for ${r.rejected.map((x) => x.currency).join(", ")}: ${r.rejected[0].reason}`);
      else toast.success(`Exchange rates updated (${r.updated.join(", ")})`);
    } catch (err) {
      toast.error(errorMessage(err) || "Could not fetch exchange rates");
    }
  };

  if (isLoading) return <Loader />;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
          <FaTruck aria-hidden="true" className="text-amber-700 dark:text-amber-400" /> Delivery fees
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          The platform default for each country. A seller who sets their own fee for a country is charged at their fee instead.
          Every seller's parcel is charged separately, and the free-delivery amount applies to that seller's items.
        </p>
        <ShippingFeesEditor
          mode="admin"
          countries={[...SUPPORTED_DESTINATION_CODES] as DestinationCode[]}
          rates={data?.rates || []}
          carriers={data?.carriers || []}
          onSave={(input) => setRate(input).unwrap()}
          onRemove={(code) => removeRate(code).unwrap()}
        />
      </section>

      <SellerFees />

      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
            <FaExchangeAlt aria-hidden="true" className="text-amber-700 dark:text-amber-400" /> Exchange rates
          </h2>
          <button type="button" onClick={refreshNow} disabled={refreshing} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-600">
            <FaSyncAlt aria-hidden="true" className={refreshing ? "motion-safe:animate-spin" : ""} /> {refreshing ? "Updating…" : "Update now"}
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Updated automatically twice a day. A rate that moves more than 25% in one update is ignored and the previous rate is kept.
        </p>
        {fxLoading ? <Loader /> : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="text-gray-600 dark:text-gray-300">
                <tr><th className="py-2 pr-3">Currency</th><th className="py-2 pr-3">1 unit in cedis</th><th className="py-2 pr-3">Date</th><th className="py-2">Source</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {(fx?.rates || []).map((r) => (
                  <tr key={r.currency} className="text-gray-900 dark:text-white">
                    <td className="py-2 pr-3 font-medium">{r.currency}</td>
                    <td className="py-2 pr-3">{r.perUnitGHS === null ? "—" : `GH₵ ${r.perUnitGHS.toFixed(2)}`}</td>
                    <td className="py-2 pr-3">
                      {r.effectiveDate ? String(r.effectiveDate).slice(0, 10) : "—"}
                      {r.ageDays !== null && r.ageDays > 2 && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">{r.ageDays} days old</span>}
                    </td>
                    <td className="py-2">{r.source === "exchangerate-api" ? "ExchangeRate-API (automatic)" : r.source === "manual" ? "Initial estimate" : r.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default ShippingAdminPage;
