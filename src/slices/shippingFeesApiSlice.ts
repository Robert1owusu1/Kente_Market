import { apiSlice } from "./apiSlice";

// Delivery fees: the platform's default per country (admin) and each seller's
// own overrides. Exchange rates for fees set in GBP/USD/CAD/EUR are fetched
// automatically on the server; admins can see them and trigger a refresh.

export interface ShippingRate {
  countryCode: string;
  baseCost: number;
  perKgCost: number;
  freeThreshold: number | null;
  currency: string;
  transitDaysMin: number;
  transitDaysMax: number;
  carrierCode: string;
  carrierName: string;
}

export interface ShippingCarrier {
  code: string;
  name: string;
  countries: string[];
}

export interface ShippingRateInput {
  countryCode: string;
  baseCost: number;
  freeThreshold: number | null;
  currency: string;
  transitDaysMin: number;
  transitDaysMax: number;
  carrierCode: string;
}

export interface ExchangeRateStatus {
  currency: string;
  rate: number | null;
  perUnitGHS: number | null;
  effectiveDate: string | null;
  source: string | null;
  ageDays: number | null;
}

export interface SellerShippingRates {
  vendorId: number;
  businessName: string;
  status: string;
  rates: ShippingRate[];
}

export interface ShippingQuote {
  supported: boolean;
  message?: string;
  chargeableShippingGHS: number | null;
  shippingGroups?: Array<{ amountGHS: number; isFree: boolean; freeThresholdGHS: number | null; subtotalGHS: number }>;
}

export interface ShippingQuoteArgs {
  countryCode: string;
  region?: string;
  items: Array<{ productId: number | string; qty: number }>;
}

const VENDOR = "/api/vendors/shipping/rates";
const ADMIN = "/api/admin/shipping";

export const shippingFeesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // The exact delivery fee the server will book for these items (per seller).
    getShippingQuote: builder.query<ShippingQuote, ShippingQuoteArgs>({
      query: (body) => ({ url: "/api/checkout/international/shipping-options", method: "POST", body }),
      providesTags: ["ShippingRates"],
      keepUnusedDataFor: 60,
    }),
    getVendorShippingRates: builder.query<{ rates: ShippingRate[]; platformDefaults: ShippingRate[]; carriers: ShippingCarrier[] }, void>({
      query: () => VENDOR,
      providesTags: ["ShippingRates"],
    }),
    setVendorShippingRate: builder.mutation<{ rate: ShippingRate }, ShippingRateInput>({
      query: ({ countryCode, ...body }) => ({ url: `${VENDOR}/${encodeURIComponent(countryCode)}`, method: "PUT", body }),
      invalidatesTags: ["ShippingRates"],
    }),
    removeVendorShippingRate: builder.mutation<{ message?: string }, string>({
      query: (countryCode) => ({ url: `${VENDOR}/${encodeURIComponent(countryCode)}`, method: "DELETE" }),
      invalidatesTags: ["ShippingRates"],
    }),

    getAdminShippingRates: builder.query<{ rates: ShippingRate[]; carriers: ShippingCarrier[] }, void>({
      query: () => `${ADMIN}/rates`,
      providesTags: ["ShippingRates"],
    }),
    setAdminShippingRate: builder.mutation<{ rate: ShippingRate }, ShippingRateInput>({
      query: ({ countryCode, ...body }) => ({ url: `${ADMIN}/rates/${encodeURIComponent(countryCode)}`, method: "PUT", body }),
      invalidatesTags: ["ShippingRates"],
    }),
    removeAdminShippingRate: builder.mutation<{ message?: string }, string>({
      query: (countryCode) => ({ url: `${ADMIN}/rates/${encodeURIComponent(countryCode)}`, method: "DELETE" }),
      invalidatesTags: ["ShippingRates"],
    }),
    getSellerShippingRates: builder.query<{ sellers: SellerShippingRates[]; platformDefaults: ShippingRate[]; carriers: ShippingCarrier[] }, void>({
      query: () => `${ADMIN}/sellers`,
      providesTags: ["ShippingRates"],
    }),
    setSellerShippingRate: builder.mutation<{ rate: ShippingRate }, ShippingRateInput & { vendorId: number }>({
      query: ({ vendorId, countryCode, ...body }) => ({ url: `${ADMIN}/sellers/${vendorId}/rates/${encodeURIComponent(countryCode)}`, method: "PUT", body }),
      invalidatesTags: ["ShippingRates"],
    }),
    removeSellerShippingRate: builder.mutation<{ message?: string }, { vendorId: number; countryCode: string }>({
      query: ({ vendorId, countryCode }) => ({ url: `${ADMIN}/sellers/${vendorId}/rates/${encodeURIComponent(countryCode)}`, method: "DELETE" }),
      invalidatesTags: ["ShippingRates"],
    }),
    getExchangeRates: builder.query<{ rates: ExchangeRateStatus[] }, void>({
      query: () => `${ADMIN}/exchange-rates`,
      providesTags: ["ExchangeRates"],
    }),
    refreshExchangeRates: builder.mutation<{ updated: string[]; rejected: Array<{ currency: string; reason: string }>; rates: ExchangeRateStatus[] }, void>({
      query: () => ({ url: `${ADMIN}/exchange-rates/refresh`, method: "POST" }),
      invalidatesTags: ["ExchangeRates"],
    }),
  }),
});

export const {
  useGetShippingQuoteQuery,
  useGetVendorShippingRatesQuery,
  useSetVendorShippingRateMutation,
  useRemoveVendorShippingRateMutation,
  useGetAdminShippingRatesQuery,
  useSetAdminShippingRateMutation,
  useRemoveAdminShippingRateMutation,
  useGetSellerShippingRatesQuery,
  useSetSellerShippingRateMutation,
  useRemoveSellerShippingRateMutation,
  useGetExchangeRatesQuery,
  useRefreshExchangeRatesMutation,
} = shippingFeesApiSlice;
