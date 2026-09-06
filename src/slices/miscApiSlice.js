// miscApiSlice.js - Contact, Newsletter, Review, and Subscriber endpoints
import { CONTACT_URL, SUBSCRIBE_URL, REVIEWS_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const miscApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // 🗒 Contact
    submitContact: builder.mutation({
      query: (data) => ({
        url: CONTACT_URL,
        method: "POST",
        body: data,
      }),
    }),

    // 📬 Newsletter
    subscribeNewsletter: builder.mutation({
      query: (data) => ({
        url: SUBSCRIBE_URL,
        method: "POST",
        body: data,
      }),
    }),

    // ⭐ Reviews
    createReview: builder.mutation({
      query: (data) => ({
        url: REVIEWS_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Product", "Review"],
    }),
    getProductReviews: builder.query({
      query: (productId) => ({
        url: `${REVIEWS_URL}/product/${productId}`,
      }),
      providesTags: (result, error, id) => [{ type: "Review", id }],
    }),
    getAllReviews: builder.query({
      query: () => ({
        url: REVIEWS_URL,
      }),
      providesTags: ["Review"],
    }),

    // 👥 Subscriber Admin
    getSubscriberCount: builder.query({
      query: () => ({
        url: `${SUBSCRIBE_URL}/count`,
      }),
      providesTags: ["Subscriber"],
    }),
    listSubscribers: builder.query({
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
