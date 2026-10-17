import { apiSlice } from "./apiSlice";

// Public capability flag: is AI try-on configured and accepting jobs on this
// server? Cached for the session so a grid of cards makes one request.
// Per-product eligibility is still decided on the product / try-on pages.
export const tryOnApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTryOnStatus: builder.query<{ enabled: boolean }, void>({
      query: () => "/api/tryon/status",
      keepUnusedDataFor: 600,
    }),
  }),
});

export const { useGetTryOnStatusQuery } = tryOnApiSlice;

/** true only when the server says try-on is on; false while loading or on error. */
export const useTryOnEnabled = () => {
  const { data } = useGetTryOnStatusQuery();
  return Boolean(data?.enabled);
};
