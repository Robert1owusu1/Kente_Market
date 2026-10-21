// Pages/Vendor/VendorShipping.tsx
// Seller shipping settings: who delivers their parcels (they do, or the
// platform from its hub), and where the seller delivers themselves, which
// countries they deliver to (customers abroad can only order from sellers who
// list their country) and, optionally, their own delivery fee per country.
import React from "react";
import { toast } from "react-toastify";
import { FaGlobeAfrica, FaWarehouse } from "react-icons/fa";
import Loader from "../../components/loader/Loader";
import ShippingFeesEditor from "../../components/Shipping/ShippingFeesEditor";
import DeliveryChoice from "../../components/Shipping/DeliveryChoice";
import { useGetDeliverySettingsQuery, useUpdateDeliverySettingsMutation } from "../../slices/deliveryApiSlice";
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
  const { data: delivery, isLoading: deliveryLoading } = useGetDeliverySettingsQuery();
  const [updateDelivery, { isLoading: savingDelivery }] = useUpdateDeliverySettingsMutation();

  if (destLoading || ratesLoading || deliveryLoading) return <Loader />;

  // A seller with no choice yet (applied before it existed) delivers themselves.
  const deliversInGhana = delivery?.domesticDelivery !== "platform";
  const deliversAbroad = delivery?.internationalDelivery !== "platform";
  const usesHub = !deliversInGhana || !deliversAbroad;

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

  const feeCountries: DestinationCode[] = [
    ...(deliversInGhana ? (["GH"] as DestinationCode[]) : []),
    ...(deliversAbroad ? ABROAD.filter((c) => shipsTo.has(c)) : []),
  ];

  const chooseDelivery = async (scope: "domesticDelivery" | "internationalDelivery", value: "seller" | "platform") => {
    try {
      await updateDelivery({ [scope]: value }).unwrap();
      toast.success("Saved. This applies to new orders.");
    } catch (err) {
      toast.error(errorMessage(err) || "Could not save who delivers your orders");
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Who delivers my orders</h2>
        <p className="mt-1 mb-4 text-sm text-gray-600 dark:text-gray-300">
          Changes apply to new orders. Orders already placed keep the choice they were placed with.
        </p>
        <DeliveryChoice
          value={{ domesticDelivery: delivery?.domesticDelivery ?? null, internationalDelivery: delivery?.internationalDelivery ?? null }}
          onChange={chooseDelivery}
          disabled={savingDelivery}
        />
        {usesHub && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <FaWarehouse aria-hidden="true" className="mt-0.5 shrink-0" />
            <p>
              <span className="font-semibold">Drop parcels at: </span>
              {delivery?.hubAddress ? delivery.hubAddress : "the hub address will be shared with you before your first order."}
            </p>
          </div>
        )}
      </section>

      {deliversAbroad ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <FaGlobeAfrica aria-hidden="true" className="text-amber-700 dark:text-amber-400" /> Countries I ship to
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Customers abroad can only buy your products if you ship to their country.
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
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">My delivery fees</h2>
        {feeCountries.length === 0 ? (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            The platform delivers all your orders, so customers pay the platform's delivery fees.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Optional, for orders you deliver yourself. Where you set a fee, your customers pay it for your items
              instead of the platform default, and it is paid out to you with your sale.
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
          </>
        )}
      </section>
    </div>
  );
};

export default VendorShipping;
