// slices/vendorsApiSlice.js
import { apiSlice } from "./apslice";

const VENDORS_URL = "/api/vendors";

export const vendorsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ✅ Apply / update vendor application (own account)
    applyVendor: builder.mutation({
      query: (data) => ({
        url: `${VENDORS_URL}/apply`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Vendor"],
    }),

    // ✅ Own vendor profile + escrow summary + payout history
    getMyVendorProfile: builder.query({
      query: () => ({
        url: `${VENDORS_URL}/me`,
        method: "GET",
      }),
      providesTags: ["Vendor"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Vendor's own products
    getMyVendorProducts: builder.query({
      query: () => ({
        url: `${VENDORS_URL}/myproducts`,
        method: "GET",
      }),
    }),

    // ✅ Create a product as vendor
    createVendorProduct: builder.mutation({
      query: (data) => ({
        url: `${VENDORS_URL}/products`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Vendor"],
    }),

    // ✅ Admin: list all vendors
    getAllVendors: builder.query({
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
    updateVendorStatus: builder.mutation({
      query: ({ id, status }) => ({
        url: `${VENDORS_URL}/${id}/status`,
        method: "PUT",
        body: { status },
      }),
      invalidatesTags: ["Vendor"],
    }),
  }),
});

export const {
  useApplyVendorMutation,
  useGetMyVendorProfileQuery,
  useGetMyVendorProductsQuery,
  useCreateVendorProductMutation,
  useGetAllVendorsQuery,
  useUpdateVendorStatusMutation,
} = vendorsApiSlice;