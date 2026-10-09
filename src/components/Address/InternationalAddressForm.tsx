import { useEffect, useState } from "react";
import axios from "axios";
import { sanitizeInput } from "../../utils/sanitize";
import {
  DESTINATION_NAMES,
  normalizeDestinationCode,
  type DestinationCode,
} from "../../utils/internationalCheckout";

export interface InternationalAddress {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: DestinationCode;
}

interface CountryOption {
  code: string;
  name: string;
  phoneExample: string;
  zipLabel: string;
}

interface AddressConfig {
  countryCode: string;
  phoneExample: string;
  requiredFields: string[];
  optionalFields: string[];
  zipPattern: string;
  zipLabel: string;
  regions: string[];
}

interface Props {
  value: InternationalAddress;
  onChange: (next: InternationalAddress) => void;
  compact?: boolean;
}

const EMPTY: InternationalAddress = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "GH",
};

/**
 * International address entry. Ghana remains the default so the existing
 * checkout experience is unchanged; other supported destinations reveal
 * their own region/postal-code/phone requirements fetched from the backend.
 * Unsupported destinations cannot be submitted (no country option exists).
 */
export default function InternationalAddressForm({ value, onChange, compact = false }: Props) {
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [config, setConfig] = useState<AddressConfig | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios
      .get("/api/checkout/international/countries")
      .then(({ data }) => {
        if (!cancelled && Array.isArray(data?.countries)) setCountries(data.countries);
      })
      .catch(() => {
        if (!cancelled) {
          setCountries(
            (Object.keys(DESTINATION_NAMES) as DestinationCode[]).map((code) => ({
              code,
              name: DESTINATION_NAMES[code],
              phoneExample: "",
              zipLabel: "Postal code",
            }))
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`/api/checkout/international/countries/${value.countryCode}`)
      .then(({ data }) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value.countryCode]);

  const set = (field: keyof InternationalAddress, raw: string) => {
    const next = { ...value, [field]: sanitizeInput(raw) };
    if (field === "countryCode") {
      const code = normalizeDestinationCode(raw) ?? "GH";
      next.countryCode = code;
      next.region = "";
      next.postalCode = "";
    }
    onChange(next);
    setTouched(true);
  };

  const show = (field: string) =>
    !config || config.requiredFields.includes(field) || config.optionalFields.includes(field);

  const required = (field: string) => Boolean(config?.requiredFields.includes(field));

  const inputCls =
    "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white text-gray-800";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-700 mb-2">Destination country *</label>
        <select
          value={value.countryCode}
          onChange={(e) => set("countryCode", e.target.value)}
          className={inputCls}
          aria-label="Destination country"
        >
          {(countries.length > 0
            ? countries
            : (Object.keys(DESTINATION_NAMES) as DestinationCode[]).map((code) => ({
                code,
                name: DESTINATION_NAMES[code],
              }))
          ).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        {touched && !config && (
          <p className="text-xs text-gray-500 mt-1">Using default address requirements (offline).</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">First Name *</label>
        <input value={value.firstName} onChange={(e) => set("firstName", e.target.value)} className={inputCls} aria-label="First Name" required />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Last Name *</label>
        <input value={value.lastName} onChange={(e) => set("lastName", e.target.value)} className={inputCls} aria-label="Last Name" required />
      </div>
      <div className={compact ? "" : "md:col-span-2"}>
        <label className="block text-sm font-medium text-gray-700 mb-2">Email Address *</label>
        <input type="email" value={value.email} onChange={(e) => set("email", e.target.value)} className={inputCls} aria-label="Email Address" required />
      </div>
      <div className={compact ? "" : "md:col-span-2"}>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Phone Number *{config?.phoneExample ? ` (e.g. ${config.phoneExample})` : ""}
        </label>
        <input value={value.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} aria-label="Phone Number" placeholder={config?.phoneExample || "+233 24 123 4567"} required />
      </div>

      {show("addressLine1") && (
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">Street Address *</label>
          <input value={value.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} className={inputCls} aria-label="Street Address" required={required("addressLine1")} />
        </div>
      )}
      {show("addressLine2") && (
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">Apartment / Suite (optional)</label>
          <input value={value.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} className={inputCls} aria-label="Apartment or suite" />
        </div>
      )}
      {show("city") && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">City *</label>
          <input value={value.city} onChange={(e) => set("city", e.target.value)} className={inputCls} aria-label="City" required={required("city")} />
        </div>
      )}
      {show("region") &&
        (config && config.regions.length > 0 ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">State / Region *</label>
            <select value={value.region} onChange={(e) => set("region", e.target.value)} className={inputCls} aria-label="State or region" required={required("region")}>
              <option value="">Select region</option>
              {config.regions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Region {required("region") ? "*" : "(optional)"}</label>
            <input value={value.region} onChange={(e) => set("region", e.target.value)} className={inputCls} aria-label="Region" required={required("region")} />
          </div>
        ))}
      {show("postalCode") && (
        <div className={config && config.regions.length > 0 ? "" : "md:col-span-2"}>
          <label className="block text-sm font-medium text-gray-700 mb-2">{config?.zipLabel || "Postal Code"} {required("postalCode") ? "*" : "(optional)"}</label>
          <input value={value.postalCode} onChange={(e) => set("postalCode", e.target.value)} className={inputCls} aria-label="Postal code" required={required("postalCode")} />
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const emptyInternationalAddress = (): InternationalAddress => ({ ...EMPTY });
