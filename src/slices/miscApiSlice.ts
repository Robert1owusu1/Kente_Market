// miscApiSlice.ts - Contact, Newsletter, Review, and Subscriber endpoints
import { CONTACT_URL, SUBSCRIBE_URL, REVIEWS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { Review } from "../types/domain";

export const miscApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // 🗒 Contact
    submitContact: builder.mutation<{ message?: string }, Record<string, unknown>>({
      query: (data) => ({
        url: CONTACT_URL,
        method: "POST",
        body: data,
      }),
    }),

    // 🗒 Contact admin
    listContacts: builder.query<Record<string, unknown>[], void>({
      query: () => CONTACT_URL,
      providesTags: ["Contact"],
    }),
    deleteContact: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({
        url: `${CONTACT_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Contact"],
    }),

    // 📬 Newsletter
    subscribeNewsletter: builder.mutation<{ message?: string }, Record<string, unknown>>({
      query: (data) => ({
        url: SUBSCRIBE_URL,
        method: "POST",
        body: data,
      }),
    }),

    // ⭐ Reviews
    createReview: builder.mutation<Review, Record<string, unknown>>({
      query: (data) => ({
        url: REVIEWS_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Product", "Review"],
    }),
    getProductReviews: builder.query<Review[], number | string>({
      query: (productId) => ({
        url: `${REVIEWS_URL}/product/${productId}`,
      }),
      providesTags: (_result, _error, id) => [{ type: "Review", id }] as const,
    }),
    getAllReviews: builder.query<Review[], void>({
      query: () => ({
        url: REVIEWS_URL,
      }),
      providesTags: ["Review"],
    }),

    // ⭐ Verified purchase review (after delivery) — product + vendor rating
    addOrderReview: builder.mutation<Review, Record<string, unknown>>({
      query: (data) => ({
        url: `${REVIEWS_URL}/order`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Product", "Review"],
    }),

    // ⭐ Admin analytics: ratings, verified count, weaver satisfaction
    getReviewAnalytics: builder.query<Record<string, unknown>, void>({
      query: () => ({
        url: `${REVIEWS_URL}/analytics`,
      }),
      providesTags: ["Review"],
    }),

    // 👥 Subscriber Admin
    getSubscriberCount: builder.query<{ count?: number }, void>({
      query: () => ({
        url: `${SUBSCRIBE_URL}/count`,
      }),
      providesTags: ["Subscriber"],
    }),
    listSubscribers: builder.query<Record<string, unknown>[], void>({
      query: () => ({
        url: SUBSCRIBE_URL,
      }),
      providesTags: ["Subscriber"],
    }),
  }),
});

export const {
  useSubmitContactMutation,
  useSubscribeNewsletterMutation,
  useCreateReviewMutation,
  useGetProductReviewsQuery,
  useGetAllReviewsQuery,
  useLazyGetProductReviewsQuery,
  useLazyGetAllReviewsQuery,
  useAddOrderReviewMutation,
  useGetReviewAnalyticsQuery,
  useGetSubscriberCountQuery,
  useListSubscribersQuery,
  useListContactsQuery,
  useDeleteContactMutation,
} = miscApiSlice;