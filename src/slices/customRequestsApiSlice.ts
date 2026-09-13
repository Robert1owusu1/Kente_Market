// slices/customRequestsApiSlice.ts
// Custom kente request workflow: customer submit -> vendor quote/decline ->
// customer accept -> pay (note checkout happens via axios, Paystack popup first)
// -> vendor in-progress -> complete. Admin sees everything + confirms follow-up.
import { CUSTOM_REQUESTS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { CustomRequest, CustomRequestStats } from "../types/domain";

interface CreateRequestPayload {
  vendorId: number | string;
  productId?: number | string;
  baseProductId?: number | string;
  description: string;
  yards: number | string;
  colours?: string[];
  dominantColour?: string;
  threadTypes?: string[];
  dominantThread?: string;
  referenceImage?: string;
  neededForDate: string;
  neededForTime: string;
}

type RequestListResponse =
  | CustomRequest[]
  | { requests?: CustomRequest[]; [key: string]: unknown };

const toList = (response: RequestListResponse): CustomRequest[] =>
  Array.isArray(response) ? response : response?.requests ?? [];

export const customRequestsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Customer creates a customisation request for a product + chosen vendor.
    createCustomRequest: builder.mutation<CustomRequest, CreateRequestPayload>({
      query: (body) => ({
        url: CUSTOM_REQUESTS_URL,
        method: "POST",
        body,
      }),
      invalidatesTags: ["CustomRequest"],
    }),

    // Customer's own requests (portal).
    getMyCustomRequests: builder.query<CustomRequest[], void>({
      query: () => `${CUSTOM_REQUESTS_URL}/my`,
      providesTags: ["CustomRequest"],
      transformResponse: toList,
    }),

    // Single request (shared for customer/vendor/admin detail views).
    getCustomRequest: builder.query<CustomRequest, number | string>({
      query: (id) => `${CUSTOM_REQUESTS_URL}/${id}`,
      providesTags: (_res, _err, id) => [{ type: "CustomRequest", id }],
    }),

    // Customer accepts the vendor quote.
    acceptCustomRequest: builder.mutation<CustomRequest, number | string>({
      query: (id) => ({
        url: `${CUSTOM_REQUESTS_URL}/${id}/accept`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "CustomRequest", id },
        "CustomRequest",
      ],
    }),

    // Customer cancels (must include a reason).
    cancelCustomRequest: builder.mutation<
      CustomRequest,
      { id: number | string; customerCancelReason: string }
    >({
      query: ({ id, customerCancelReason }) => ({
        url: `${CUSTOM_REQUESTS_URL}/${id}/cancel`,
        method: "POST",
        body: { customerCancelReason },
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "CustomRequest", id },
        "CustomRequest",
      ],
    }),

    // Vendor's inbound requests (quote / decline / in-progress live here too).
    getVendorCustomRequests: builder.query<CustomRequest[], void>({
      query: () => `${CUSTOM_REQUESTS_URL}/vendor`,
      providesTags: ["CustomRequest"],
      transformResponse: toList,
    }),
    quoteCustomRequest: builder.mutation<
      CustomRequest,
      { id: number | string; vendorQuotePrice: number; vendorCanMeet: boolean; vendorMessage?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `${CUSTOM_REQUESTS_URL}/${id}/quote`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "CustomRequest", id },
        "CustomRequest",
      ],
    }),
    declineCustomRequest: builder.mutation<
      CustomRequest,
      { id: number | string; vendorMessage?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `${CUSTOM_REQUESTS_URL}/${id}/decline`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "CustomRequest", id },
        "CustomRequest",
      ],
    }),
    startCustomRequest: builder.mutation<CustomRequest, number | string>({
      query: (id) => ({
        url: `${CUSTOM_REQUESTS_URL}/${id}/in-progress`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "CustomRequest", id },
        "CustomRequest",
      ],
    }),

    // Admin oversight.
    getAllCustomRequests: builder.query<CustomRequest[], void>({
      query: () => `${CUSTOM_REQUESTS_URL}/admin`,
      providesTags: ["CustomRequest"],
      transformResponse: toList,
    }),
    getCustomRequestStats: builder.query<CustomRequestStats, void>({
      query: () => `${CUSTOM_REQUESTS_URL}/admin/stats`,
      providesTags: ["CustomRequest"],
    }),
    markCustomRequestReviewed: builder.mutation<
      CustomRequest,
      number | string
    >({
      query: (id) => ({
        url: `${CUSTOM_REQUESTS_URL}/${id}/reviewed`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "CustomRequest", id },
        "CustomRequest",
      ],
    }),
  }),
});

export const {
  useCreateCustomRequestMutation,
  useGetMyCustomRequestsQuery,
  useGetCustomRequestQuery,
  useAcceptCustomRequestMutation,
  useCancelCustomRequestMutation,
  useGetVendorCustomRequestsQuery,
  useQuoteCustomRequestMutation,
  useDeclineCustomRequestMutation,
  useStartCustomRequestMutation,
  useGetAllCustomRequestsQuery,
  useGetCustomRequestStatsQuery,
  useMarkCustomRequestReviewedMutation,
} = customRequestsApiSlice;