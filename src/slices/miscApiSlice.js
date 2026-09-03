// miscApiSlice.js - Contact, Newsletter, and Review endpoints
import { CONTACT_URL, SUBSCRIBE_URL, REVIEWS_URL } from "../constant";
import { apiSlice } from "./apslice";

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
} = miscApiSlice;
