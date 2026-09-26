// slices/vendorsApiSlice.ts
import { apiSlice } from "./apiSlice";
import type { Vendor, VendorAnalytics, ReturnRequest } from "./apiTypes";
import type { Product, Order, Review, Coupon } from "../types/domain";

const VENDORS_URL = "/api/vendors";

/** One row of the admin performance scorecard (GET /admin-scorecard). */
interface AdminScorecard {
  userId: number;
  businessName: string;
  status: string;
  verificationLevel: string;
  onTimeRate: number | null;
  avgResponseHours: number | null;
  responseCount?: number;
  reviewRating: string | number | null;
  verifiedOrders: number;
}

export const vendorsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ✅ Apply / update vendor application (own account)
    applyVendor: builder.mutation<Vendor, Record<string, unknown>>({
      query: (data) => ({
        url: `${VENDORS_URL}/apply`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Vendor"],
    }),

    // ✅ Own vendor profile + escrow summary + payout history
    getMyVendorProfile: builder.query<Vendor, void>({
      query: () => ({
        url: `${VENDORS_URL}/me`,
        method: "GET",
      }),
      providesTags: ["Vendor"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Vendor's own products (detailed)
    getMyVendorProducts: builder.query<Product[], void>({
      query: () => ({
        url: `${VENDORS_URL}/myproducts`,
        method: "GET",
      }),
      providesTags: ["VendorProduct"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Create a product as vendor
    createVendorProduct: builder.mutation<Product, Record<string, unknown>>({
      query: (data) => ({
        url: `${VENDORS_URL}/products`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["VendorProduct", "VendorAnalytics"],
    }),

    // ✅ Update vendor's own product
    updateVendorProduct: builder.mutation<Product, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({
        url: `${VENDORS_URL}/products/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["VendorProduct", "VendorAnalytics"],
    }),

    // ✅ Delete vendor's own product
    deleteVendorProduct: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({
        url: `${VENDORS_URL}/products/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["VendorProduct", "VendorAnalytics"],
    }),

    // ✅ Vendor analytics
    getVendorAnalytics: builder.query<VendorAnalytics, void>({
      query: () => ({
        url: `${VENDORS_URL}/analytics`,
        method: "GET",
      }),
      providesTags: ["VendorAnalytics"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Reviews on vendor's products
    getVendorReviews: builder.query<Review[], void>({
      query: () => ({
        url: `${VENDORS_URL}/reviews`,
        method: "GET",
      }),
      providesTags: ["VendorReview"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Returns for vendor's products
    getVendorReturns: builder.query<ReturnRequest[], void>({
      query: () => ({
        url: `${VENDORS_URL}/returns`,
        method: "GET",
      }),
      providesTags: ["VendorReturn"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Vendor's coupons
    getVendorCoupons: builder.query<Coupon[], void>({
      query: () => ({
        url: `${VENDORS_URL}/coupons`,
        method: "GET",
      }),
      providesTags: ["VendorCoupon"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Create vendor coupon
    createVendorCoupon: builder.mutation<Coupon, Record<string, unknown>>({
      query: (data) => ({
        url: `${VENDORS_URL}/coupons`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["VendorCoupon"],
    }),

    // ✅ Update vendor coupon
    updateVendorCoupon: builder.mutation<Coupon, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({
        url: `${VENDORS_URL}/coupons/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["VendorCoupon"],
    }),

    // ✅ Delete vendor coupon
    deleteVendorCoupon: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({
        url: `${VENDORS_URL}/coupons/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["VendorCoupon"],
    }),

    // ✅ Update vendor business profile
    updateVendorProfile: builder.mutation<Vendor, Record<string, unknown>>({
      query: (data) => ({
        url: `${VENDORS_URL}/profile`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Vendor"],
    }),

    // ✅ Orders that contain this vendor's products (fulfilment list)
    getVendorOrders: builder.query<Order[], void>({
      query: () => ({
        url: `${VENDORS_URL}/orders`,
        method: "GET",
      }),
      providesTags: ["VendorOrder"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Vendor advances fulfilment status of their order (+ customised note/date)
    updateVendorOrderStatus: builder.mutation<
      Order,
      { orderId: number | string; orderStatus?: string; productionNote?: string; expectedCompletionDate?: string }
    >({
      query: ({ orderId, orderStatus, productionNote, expectedCompletionDate }) => ({
        url: `${VENDORS_URL}/orders/${orderId}/status`,
        method: "POST",
        body: { orderStatus, productionNote, expectedCompletionDate },
      }),
      invalidatesTags: ["VendorOrder", "VendorAnalytics"],
    }),

    // ✅ Vendor withdraws from available wallet balance
    withdrawVendor: builder.mutation<{ message?: string; [key: string]: unknown }, Record<string, unknown>>({
      query: (data) => ({
        url: `${VENDORS_URL}/withdraw`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Vendor"],
    }),

    // ✅ Admin: list all vendors
    getAllVendors: builder.query<Vendor[], { status?: string; search?: string } | undefined>({
      query: ({ status, search } = {}) => {
        const params = new URLSearchParams();
        if (status) params.append("status", status);
        if (search) params.append("search", search);
        return { url: `${VENDORS_URL}?${params.toString()}`, method: "GET" };
      },
      providesTags: ["Vendor"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Admin: change vendor status
    updateVendorStatus: builder.mutation<Vendor, { id: number | string; status: string }>({
      query: ({ id, status }) => ({
        url: `${VENDORS_URL}/${id}/status`,
        method: "PUT",
        body: { status },
      }),
      invalidatesTags: ["Vendor"],
    }),

    // ✅ Public fulfilment scorecard — on-time delivery record for a store.
    getVendorFulfilment: builder.query<
      { fulfilled: number; withDeadline: number; onTime: number; onTimeRate: number; avgDaysEarly: number },
      number | string
    >({
      query: (vendorId) => ({
        url: `${VENDORS_URL}/fulfillment/${vendorId}`,
        method: "GET",
      }),
      keepUnusedDataFor: 300,
    }),

    // ✅ Admin: per-vendor performance scorecard (on-time %, response hours,
    //    review rating, verified order count).
    getAdminScorecard: builder.query<
      Record<string | number, AdminScorecard>,
      void
    >({
      query: () => ({
        url: `${VENDORS_URL}/admin-scorecard`,
        method: "GET",
      }),
      // The API returns an ARRAY of scorecards; index it by userId here so
      // consumers can look up a vendor directly (scorecard[userId] on an
      // array is always undefined, which silently hid the whole column).
      transformResponse: (
        response: AdminScorecard[] | Record<string | number, AdminScorecard>
      ) =>
        Array.isArray(response)
          ? Object.fromEntries(response.map((card) => [card.userId, card]))
          : response,
      keepUnusedDataFor: 60,
    }),

    // ✅ Demand insights for the vendor dashboard (weekly digest + on request).
    getVendorInsights: builder.query<
      {
        demand: { totalRevenue: number; totalQty: number; topTypes: { category: string; quantity: number; revenue: number; productCount: number; share: number }[]; topProducts: { productId: string; name: string; category: string; patternName?: string | null; quantity: number; revenue: number; share?: number }[] };
        focus: { category: string; quantity: number; revenue: number; productCount: number; share: number };
        tip: string;
      },
      void
    >({
      query: () => ({
        url: `${VENDORS_URL}/insights`,
        method: "GET",
      }),
      providesTags: ["VendorInsights"],
      keepUnusedDataFor: 300,
    }),
  }),
});

export const {
  useApplyVendorMutation,
  useGetMyVendorProfileQuery,
  useGetMyVendorProductsQuery,
  useCreateVendorProductMutation,
  useUpdateVendorProductMutation,
  useDeleteVendorProductMutation,
  useGetVendorAnalyticsQuery,
  useGetVendorReviewsQuery,
  useGetVendorReturnsQuery,
  useGetVendorCouponsQuery,
  useCreateVendorCouponMutation,
  useUpdateVendorCouponMutation,
  useDeleteVendorCouponMutation,
  useUpdateVendorProfileMutation,
  useWithdrawVendorMutation,
  useGetAllVendorsQuery,
  useUpdateVendorStatusMutation,
  useGetVendorOrdersQuery,
  useUpdateVendorOrderStatusMutation,
  useGetVendorFulfilmentQuery,
  useGetVendorInsightsQuery,
  useGetAdminScorecardQuery,
} = vendorsApiSlice;