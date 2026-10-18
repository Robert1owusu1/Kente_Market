// Pages/Vendor/VendorShipping.tsx
// Seller shipping settings: which countries they deliver to (customers abroad
// can only order from sellers who list their country) and, optionally, their
// own delivery fee per country instead of the platform default.
import React from "react";
import { toast } from "react-toastify";
import { FaGlobeAfrica } from "react-icons/fa";
import Loader from "../../components/loader/Loader";
import ShippingFeesEditor from "../../components/Shipping/ShippingFeesEditor";
import {
  useGetVendorShippingDestinationsQuery,
  useAddVendorShippingDestinationMutation,
  useRemoveVendorShippingDestinationMutation,
} from "../../slices/vendorsApiSlice";
import {
  useGetVendorShippingRatesQuery,
  useSetVendorShippingRateMutation,
  useRemoveVendorShippingRateMutation,
} from "../../slices/shippingFeesApiSlice";
import { DESTINATION_NAMES, SUPPORTED_DESTINATION_CODES, type DestinationCode } from "../../utils/internationalCheckout";

const ABROAD = SUPPORTED_DESTINATION_CODES.filter((c) => c !== "GH") as DestinationCode[];
const errorMessage = (err: unknown) => (err as { data?: { message?: string } })?.data?.message;

const VendorShipping = () => {
  const { data: destData, isLoading: destLoading } = useGetVendorShippingDestinationsQuery();
  const { data: rateData, isLoading: ratesLoading } = useGetVendorShippingRatesQuery();
  const [addDestination, { isLoading: adding }] = useAddVendorShippingDestinationMutation();
  const [removeDestination, { isLoading: removing }] = useRemoveVendorShippingDestinationMutation();
  const [setRate] = useSetVendorShippingRateMutation();
  const [removeRate] = useRemoveVendorShippingRateMutation();

  if (destLoading || ratesLoading) return <Loader />;

  // Country-wide destinations only (a region-specific row does not cover the whole country).
  const countryRows = (destData?.destinations || []).filter((d) => d.isActive && !d.region);
  const shipsTo = new Set(countryRows.map((d) => d.countryCode));

  const toggle = async (code: DestinationCode) => {
    try {
      if (shipsTo.has(code)) {
        const row = countryRows.find((d) => d.countryCode === code);
        if (row) await removeDestination(row.id).unwrap();
        toast.success(`You no longer ship to ${DESTINATION_NAMES[code]}`);
      } else {
        await addDestination({ countryCode: code }).unwrap();
        toast.success(`You now ship to ${DESTINATION_NAMES[code]}`);
      }
    } catch (err) {
      toast.error(errorMessage(err) || "Could not update your shipping countries");
    }
  };

  const feeCountries: DestinationCode[] = ["GH", ...ABROAD.filter((c) => shipsTo.has(c))];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <FaGlobeAfrica aria-hidden="true" className="text-amber-700 dark:text-amber-400" /> Countries I ship to
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          You always deliver within Ghana. Customers abroad can only buy your products if you ship to their country.
        </p>
        <fieldset className="mt-4" disabled={adding || removing}>
          <legend className="sr-only">Countries you ship to outside Ghana</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ABROAD.map((code) => (
              <label key={code} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 dark:border-gray-700">
                <input type="checkbox" className="h-5 w-5 accent-amber-600" checked={shipsTo.has(code)} onChange={() => toggle(code)} />
                <span className="text-gray-900 dark:text-white">{DESTINATION_NAMES[code]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">My delivery fees</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Optional. Where you set a fee, your customers pay it for your items instead of the platform default.
          Each seller's parcel is charged separately.
        </p>
        <ShippingFeesEditor
          mode="vendor"
          countries={feeCountries}
          rates={rateData?.rates || []}
          defaults={rateData?.platformDefaults || []}
          carriers={rateData?.carriers || []}
          onSave={(input) => setRate(input).unwrap()}
          onRemove={(code) => removeRate(code).unwrap()}
        />
      </section>
    </div>
  );
};

export default VendorShipping;
