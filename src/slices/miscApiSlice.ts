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
  useGetSubscriberCountQuery,
  useListSubscribersQuery,
} = miscApiSlice;