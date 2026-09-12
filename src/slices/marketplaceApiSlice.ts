// slices/marketplaceApiSlice.ts
// API slice for the Bonwire marketplace upgrade: vendor storefronts,
// product moderation, commission engine, campaigns, certificates, messaging,
// vendor staff + inventory.
import { apiSlice } from "./apiSlice";
import type {
  Storefront,
  Vendor,
  InventoryItem,
  VendorStaff,
  VendorMessage,
  CommissionRule,
  Campaign,
  Certificate,
  DashboardStats,
} from "./apiTypes";
import type { Product } from "../types/domain";

export const marketplaceApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ============ PUBLIC STOREFRONTS ============
    getStorefront: builder.query<Storefront, string | number>({
      query: (slugOrId) => ({
        url: `/api/vendors/store/${slugOrId}`,
        method: "GET",
      }),
      keepUnusedDataFor: 60,
    }),
    getVendorDirectory: builder.query<Vendor[], void>({
      query: () => ({ url: "/api/vendors/directory", method: "GET" }),
      keepUnusedDataFor: 60,
    }),

    // ============ PUBLIC: KENTE MUSEUM ============
    getMuseumPieces: builder.query<Product[], void>({
      query: () => ({ url: "/api/products/museum", method: "GET" }),
      keepUnusedDataFor: 120,
    }),

    // ============ VENDOR: STOREFRONT / INVENTORY ============
    updateVendorStorefront: builder.mutation<Vendor, Record<string, unknown>>({
      query: (data) => ({ url: "/api/vendors/profile", method: "PUT", body: data }),
      invalidatesTags: ["Vendor"],
    }),
    getVendorInventory: builder.query<InventoryItem[], void>({
      query: () => ({ url: "/api/vendors/inventory", method: "GET" }),
      keepUnusedDataFor: 30,
    }),

    // ============ VENDOR: STAFF ============
    getVendorStaff: builder.query<VendorStaff[], void>({
      query: () => ({ url: "/api/vendors/staff", method: "GET" }),
      keepUnusedDataFor: 10,
    }),
    createVendorStaff: builder.mutation<VendorStaff, Record<string, unknown>>({
      query: (data) => ({ url: "/api/vendors/staff", method: "POST", body: data }),
      invalidatesTags: ["VendorStaff"],
    }),
    updateVendorStaff: builder.mutation<VendorStaff, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({ url: `/api/vendors/staff/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["VendorStaff"],
    }),
    deleteVendorStaff: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({ url: `/api/vendors/staff/${id}`, method: "DELETE" }),
      invalidatesTags: ["VendorStaff"],
    }),
    staffLogin: builder.mutation<{ token?: string; staff?: VendorStaff }, Record<string, unknown>>({
      query: (data) => ({ url: "/api/vendors/staff/login", method: "POST", body: data }),
    }),

    // ============ MESSAGING ============
    sendVendorMessage: builder.mutation<VendorMessage, Record<string, unknown>>({
      query: (data) => ({ url: "/api/messages", method: "POST", body: data }),
      invalidatesTags: ["Messages"],
    }),
    getVendorMessages: builder.query<VendorMessage[], void>({
      query: () => ({ url: "/api/vendors/messages", method: "GET" }),
      providesTags: ["Messages"],
      keepUnusedDataFor: 10,
    }),
    getMyMessages: builder.query<VendorMessage[], void>({
      query: () => ({ url: "/api/messages/me", method: "GET" }),
      providesTags: ["Messages"],
      keepUnusedDataFor: 10,
    }),
    getAllMessages: builder.query<VendorMessage[], void>({
      query: () => ({ url: "/api/messages/all", method: "GET" }),
      providesTags: ["Messages"],
      keepUnusedDataFor: 10,
    }),
    replyToVendorMessage: builder.mutation<VendorMessage, { id: number | string; reply: string }>({
      query: ({ id, reply }) => ({ url: `/api/messages/${id}/reply`, method: "PUT", body: { reply } }),
      invalidatesTags: ["Messages"],
    }),
    replyToCustomerMessage: builder.mutation<VendorMessage, { id: number | string; body: string }>({
      query: ({ id, body }) => ({
        url: `/api/messages/${id}/customer-reply`,
        method: "PUT",
        body: { body },
      }),
      invalidatesTags: ["Messages"],
    }),
    closeVendorMessage: builder.mutation<VendorMessage, number | string>({
      query: (id) => ({ url: `/api/messages/${id}/close`, method: "PUT" }),
      invalidatesTags: ["Messages"],
    }),

    // ============ ADMIN: MODERATION ============
    getModerationProducts: builder.query<Product[], string | undefined>({
      query: (status = "pending") => ({ url: `/api/admin/moderation/products?status=${status}`, method: "GET" }),
      providesTags: ["Moderation"],
      keepUnusedDataFor: 10,
    }),
    moderateProduct: builder.mutation<
      Product,
      { id: number | string; status: string; note?: string }
    >({
      query: ({ id, status, note }) => ({
        url: `/api/admin/moderation/products/${id}`,
        method: "PUT",
        body: { status, note },
      }),
      invalidatesTags: ["Moderation", "Products"],
    }),
    getModerationStats: builder.query<DashboardStats, void>({
      query: () => ({ url: "/api/admin/moderation/stats", method: "GET" }),
      keepUnusedDataFor: 10,
    }),

    // ============ ADMIN: COMMISSION ENGINE ============
    getCommissionRules: builder.query<CommissionRule[], void>({
      query: () => ({ url: "/api/admin/commissions", method: "GET" }),
      providesTags: ["Commission"],
      keepUnusedDataFor: 10,
    }),
    createCommissionRule: builder.mutation<CommissionRule, Record<string, unknown>>({
      query: (data) => ({ url: "/api/admin/commissions", method: "POST", body: data }),
      invalidatesTags: ["Commission"],
    }),
    updateCommissionRule: builder.mutation<CommissionRule, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({ url: `/api/admin/commissions/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["Commission"],
    }),
    deleteCommissionRule: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({ url: `/api/admin/commissions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Commission"],
    }),

    // ============ ADMIN: CAMPAIGNS ============
    getCampaigns: builder.query<Campaign[], boolean | undefined>({
      query: (all = false) => ({ url: `/api/campaigns${all ? "?all=1" : ""}`, method: "GET" }),
      providesTags: ["Campaign"],
      keepUnusedDataFor: 30,
    }),
    getCampaign: builder.query<Campaign, number | string>({
      query: (id) => ({ url: `/api/campaigns/${id}`, method: "GET" }),
      keepUnusedDataFor: 30,
    }),
    createCampaign: builder.mutation<Campaign, Record<string, unknown>>({
      query: (data) => ({ url: "/api/campaigns", method: "POST", body: data }),
      invalidatesTags: ["Campaign"],
    }),
    updateCampaign: builder.mutation<Campaign, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({ url: `/api/campaigns/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["Campaign"],
    }),
    deleteCampaign: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({ url: `/api/campaigns/${id}`, method: "DELETE" }),
      invalidatesTags: ["Campaign"],
    }),

    // ============ ADMIN: AUTHENTICITY CERTIFICATES ============
    getMyCertificates: builder.query<Certificate[], void>({
      query: () => ({ url: "/api/certificates/mine", method: "GET" }),
      providesTags: ["Certificate"],
      keepUnusedDataFor: 30,
    }),
    getAllCertificates: builder.query<Certificate[], void>({
      query: () => ({ url: "/api/certificates", method: "GET" }),
      providesTags: ["Certificate"],
      keepUnusedDataFor: 10,
    }),
    issueCertificate: builder.mutation<Certificate, Record<string, unknown>>({
      query: (data) => ({ url: "/api/certificates", method: "POST", body: data }),
      invalidatesTags: ["Certificate"],
    }),
    verifyCertificate: builder.query<Certificate, string>({
      query: (token) => ({ url: `/api/certificates/verify/${token}`, method: "GET" }),
      keepUnusedDataFor: 60,
    }),

    // ============ ADMIN: VENDOR VERIFICATION ============
    updateVendorVerification: builder.mutation<
      Vendor,
      { id: number | string; level?: string; badges?: string[] }
    >({
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
  useGetAllMessagesQuery,
  useReplyToVendorMessageMutation,
  useReplyToCustomerMessageMutation,
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