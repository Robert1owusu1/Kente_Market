import { apiSlice } from "./apiSlice";

const VENDORS_URL = "/api/vendors";
const ADMIN_FEATURED_URL = "/api/admin/featured";

export interface FeaturedConfig {
  enabled: boolean;
  pricePerDay: number;
  maxDays: number;
}

export interface FeaturedPlacement {
  id: number;
  productId: number;
  title: string;
  days: number;
  amount: number;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
  created_at: string;
}

export const featuredApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Vendor
    getFeaturedConfig: builder.query<FeaturedConfig, void>({
      query: () => `${VENDORS_URL}/featured/config`,
      providesTags: ["Featured"],
    }),
    getMyFeatured: builder.query<FeaturedPlacement[], void>({
      query: () => `${VENDORS_URL}/featured`,
      providesTags: ["Featured"],
    }),
    createFeaturedPurchase: builder.mutation<
      { authorizationUrl: string; reference: string; placementId: number; amount: number },
      { productId: number; days: number }
    >({
      query: (body) => ({ url: `${VENDORS_URL}/featured`, method: "POST", body }),
      invalidatesTags: ["Featured"],
    }),
    // Admin
    getAdminFeaturedConfig: builder.query<FeaturedConfig, void>({
      query: () => `${ADMIN_FEATURED_URL}/config`,
      providesTags: ["Featured"],
    }),
    updateAdminFeaturedConfig: builder.mutation<FeaturedConfig, Partial<FeaturedConfig>>({
      query: (body) => ({ url: `${ADMIN_FEATURED_URL}/config`, method: "PUT", body }),
      invalidatesTags: ["Featured"],
    }),
  }),
});

export const {
  useGetFeaturedConfigQuery,
  useGetMyFeaturedQuery,
  useCreateFeaturedPurchaseMutation,
  useGetAdminFeaturedConfigQuery,
  useUpdateAdminFeaturedConfigMutation,
} = featuredApiSlice;
