// components/Shipping/DeliveryChoice.tsx
// Who delivers a seller's parcels, chosen separately for Ghana and abroad:
// the seller (ships it themselves and is paid the delivery fee) or the
// platform (the seller drops the parcel at the hub). Used on the seller
// application and on the seller's Shipping page.
import { FaTruck, FaWarehouse } from "react-icons/fa";
import type { DeliveredBy } from "../../slices/deliveryApiSlice";

export type DeliveryScope = "domesticDelivery" | "internationalDelivery";

const SCOPES: Array<{ key: DeliveryScope; label: string }> = [
  { key: "domesticDelivery", label: "Orders within Ghana" },
  { key: "internationalDelivery", label: "Orders outside Ghana" },
];

const OPTIONS: Array<{ value: DeliveredBy; title: string; detail: string; Icon: typeof FaTruck }> = [
  { value: "seller", title: "I deliver", detail: "You send the parcel to the customer and receive the delivery fee.", Icon: FaTruck },
  { value: "platform", title: "The platform delivers", detail: "You drop the parcel at our hub. We deliver it and keep the delivery fee.", Icon: FaWarehouse },
];

type Props = {
  value: Partial<Record<DeliveryScope, DeliveredBy | null>>;
  onChange: (scope: DeliveryScope, value: DeliveredBy) => void;
  disabled?: boolean;
};

const DeliveryChoice = ({ value, onChange, disabled = false }: Props) => (
  <div className="space-y-5">
    {SCOPES.map(({ key, label }) => (
      <fieldset key={key} disabled={disabled}>
        <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{label} *</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {OPTIONS.map(({ value: option, title, detail, Icon }) => {
            const checked = value[key] === option;
            return (
              <label
                key={option}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  checked
                    ? "border-primary bg-primary/5"
                    : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                }`}
              >
                <input
                  type="radio"
                  name={key}
                  value={option}
                  checked={checked}
                  onChange={() => onChange(key, option)}
                  className="mt-1 h-4 w-4 accent-amber-600"
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                    <Icon aria-hidden="true" className="text-amber-700 dark:text-amber-400" /> {title}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">{detail}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    ))}
  </div>
);

export default DeliveryChoice;
