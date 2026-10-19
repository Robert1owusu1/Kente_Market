import { apiSlice } from "./apiSlice";

// The VAT rate the admin sets (Admin -> Settings), for storefront estimates.
// The server re-prices every order; nothing here is hard-coded.
export const pricingApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPublicPricing: builder.query<{ vatRate: number; currency: string }, void>({
      query: () => "/api/settings/public/pricing",
      providesTags: ["Settings"],
      keepUnusedDataFor: 300,
    }),
  }),
});

export const { useGetPublicPricingQuery } = pricingApiSlice;

/** VAT as a fraction (0.15 = 15%), or null until loaded / if unavailable. */
export const useVatRate = (): number | null => {
  const { data } = useGetPublicPricingQuery();
  return typeof data?.vatRate === "number" && Number.isFinite(data.vatRate) ? data.vatRate : null;
};
