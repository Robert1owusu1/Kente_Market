// slices/marketplaceApiSlice.js
// API slice for the Bonwire marketplace upgrade: vendor storefronts,
// product moderation, commission engine, campaigns, certificates, messaging,
// vendor staff + inventory.
import { apiSlice } from "./apiSlice";

export const marketplaceApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ============ PUBLIC STOREFRONTS ============
    getStorefront: builder.query({
      query: (slugOrId) => ({
        url: `/api/vendors/store/${slugOrId}`,
        method: "GET",
      }),
      keepUnusedDataFor: 60,
    }),
    getVendorDirectory: builder.query({
      query: () => ({ url: "/api/vendors/directory", method: "GET" }),
      keepUnusedDataFor: 60,
    }),

    // ============ PUBLIC: KENTE MUSEUM ============
    getMuseumPieces: builder.query({
      query: () => ({ url: "/api/products/museum", method: "GET" }),
      keepUnusedDataFor: 120,
    }),

    // ============ VENDOR: STOREFRONT / INVENTORY ============
    updateVendorStorefront: builder.mutation({
      query: (data) => ({ url: "/api/vendors/profile", method: "PUT", body: data }),
      invalidatesTags: ["Vendor"],
    }),
    getVendorInventory: builder.query({
      query: () => ({ url: "/api/vendors/inventory", method: "GET" }),
      keepUnusedDataFor: 30,
    }),

    // ============ VENDOR: STAFF ============
    getVendorStaff: builder.query({
      query: () => ({ url: "/api/vendors/staff", method: "GET" }),
      keepUnusedDataFor: 10,
    }),
    createVendorStaff: builder.mutation({
      query: (data) => ({ url: "/api/vendors/staff", method: "POST", body: data }),
      invalidatesTags: ["VendorStaff"],
    }),
    updateVendorStaff: builder.mutation({
      query: ({ id, ...data }) => ({ url: `/api/vendors/staff/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["VendorStaff"],
    }),
    deleteVendorStaff: builder.mutation({
      query: (id) => ({ url: `/api/vendors/staff/${id}`, method: "DELETE" }),
      invalidatesTags: ["VendorStaff"],
    }),
    staffLogin: builder.mutation({
      query: (data) => ({ url: "/api/vendors/staff/login", method: "POST", body: data }),
    }),

    // ============ MESSAGING ============
    sendVendorMessage: builder.mutation({
      query: (data) => ({ url: "/api/messages", method: "POST", body: data }),
      invalidatesTags: ["Messages"],
    }),
    getVendorMessages: builder.query({
      query: () => ({ url: "/api/vendors/messages", method: "GET" }),
      providesTags: ["Messages"],
      keepUnusedDataFor: 10,
    }),
    getMyMessages: builder.query({
      query: () => ({ url: "/api/messages/me", method: "GET" }),
      providesTags: ["Messages"],
      keepUnusedDataFor: 10,
    }),
    replyToVendorMessage: builder.mutation({
      query: ({ id, reply }) => ({ url: `/api/messages/${id}/reply`, method: "PUT", body: { reply } }),
      invalidatesTags: ["Messages"],
    }),
    closeVendorMessage: builder.mutation({
      query: (id) => ({ url: `/api/messages/${id}/close`, method: "PUT" }),
      invalidatesTags: ["Messages"],
    }),

    // ============ ADMIN: MODERATION ============
    getModerationProducts: builder.query({
      query: (status = "pending") => ({ url: `/api/admin/moderation/products?status=${status}`, method: "GET" }),
      providesTags: ["Moderation"],
      keepUnusedDataFor: 10,
    }),
    moderateProduct: builder.mutation({
      query: ({ id, status, note }) => ({
        url: `/api/admin/moderation/products/${id}`,
        method: "PUT",
        body: { status, note },
      }),
      invalidatesTags: ["Moderation", "Products"],
    }),
    getModerationStats: builder.query({
      query: () => ({ url: "/api/admin/moderation/stats", method: "GET" }),
      keepUnusedDataFor: 10,
    }),

    // ============ ADMIN: COMMISSION ENGINE ============
    getCommissionRules: builder.query({
      query: () => ({ url: "/api/admin/commissions", method: "GET" }),
      providesTags: ["Commission"],
      keepUnusedDataFor: 10,
    }),
    createCommissionRule: builder.mutation({
      query: (data) => ({ url: "/api/admin/commissions", method: "POST", body: data }),
      invalidatesTags: ["Commission"],
    }),
    updateCommissionRule: builder.mutation({
      query: ({ id, ...data }) => ({ url: `/api/admin/commissions/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["Commission"],
    }),
    deleteCommissionRule: builder.mutation({
      query: (id) => ({ url: `/api/admin/commissions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Commission"],
    }),

    // ============ ADMIN: CAMPAIGNS ============
    getCampaigns: builder.query({
      query: (all = false) => ({ url: `/api/campaigns${all ? "?all=1" : ""}`, method: "GET" }),
      providesTags: ["Campaign"],
      keepUnusedDataFor: 30,
    }),
    getCampaign: builder.query({
      query: (id) => ({ url: `/api/campaigns/${id}`, method: "GET" }),
      keepUnusedDataFor: 30,
    }),
    createCampaign: builder.mutation({
      query: (data) => ({ url: "/api/campaigns", method: "POST", body: data }),
      invalidatesTags: ["Campaign"],
    }),
    updateCampaign: builder.mutation({
      query: ({ id, ...data }) => ({ url: `/api/campaigns/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["Campaign"],
    }),
    deleteCampaign: builder.mutation({
      query: (id) => ({ url: `/api/campaigns/${id}`, method: "DELETE" }),
      invalidatesTags: ["Campaign"],
    }),

    // ============ ADMIN: AUTHENTICITY CERTIFICATES ============
    getMyCertificates: builder.query({
      query: () => ({ url: "/api/certificates/mine", method: "GET" }),
      providesTags: ["Certificate"],
      keepUnusedDataFor: 30,
    }),
    getAllCertificates: builder.query({
      query: () => ({ url: "/api/certificates", method: "GET" }),
      providesTags: ["Certificate"],
      keepUnusedDataFor: 10,
    }),
    issueCertificate: builder.mutation({
      query: (data) => ({ url: "/api/certificates", method: "POST", body: data }),
      invalidatesTags: ["Certificate"],
    }),
    verifyCertificate: builder.query({
      query: (token) => ({ url: `/api/certificates/verify/${token}`, method: "GET" }),
      keepUnusedDataFor: 60,
    }),

    // ============ ADMIN: VENDOR VERIFICATION ============
    updateVendorVerification: builder.mutation({
      query: ({ id, level, badges }) => ({
        url: `/api/vendors/${id}/verification`,
        method: "PUT",
        body: { level, badges },
      }),
      invalidatesTags: ["Vendor"],
    }),
  }),
});

export const {
  useGetStorefrontQuery,
  useGetVendorDirectoryQuery,
  useGetMuseumPiecesQuery,
  useUpdateVendorStorefrontMutation,
  useGetVendorInventoryQuery,
  useGetVendorStaffQuery,
  useCreateVendorStaffMutation,
  useUpdateVendorStaffMutation,
  useDeleteVendorStaffMutation,
  useStaffLoginMutation,
  useSendVendorMessageMutation,
  useGetVendorMessagesQuery,
  useGetMyMessagesQuery,
  useReplyToVendorMessageMutation,
  useCloseVendorMessageMutation,
  useGetModerationProductsQuery,
  useModerateProductMutation,
  useGetModerationStatsQuery,
  useGetCommissionRulesQuery,
  useCreateCommissionRuleMutation,
  useUpdateCommissionRuleMutation,
  useDeleteCommissionRuleMutation,
  useGetCampaignsQuery,
  useGetCampaignQuery,
  useCreateCampaignMutation,
  useUpdateCampaignMutation,
  useDeleteCampaignMutation,
  useGetMyCertificatesQuery,
  useGetAllCertificatesQuery,
  useIssueCertificateMutation,
  useVerifyCertificateQuery,
  useUpdateVendorVerificationMutation,
} = marketplaceApiSlice;