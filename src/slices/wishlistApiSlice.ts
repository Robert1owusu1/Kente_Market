import { WISHLIST_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { WishlistItem } from "../types/domain";

export const wishlistApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyWishlist: builder.query<WishlistItem[], void>({
      query: () => WISHLIST_URL,
      providesTags: ['Wishlist'],
    }),
    addToWishlist: builder.mutation<WishlistItem, Record<string, unknown>>({
      query: (data) => ({ url: WISHLIST_URL, method: 'POST', body: data }),
      invalidatesTags: ['Wishlist', 'Product'],
    }),
    removeFromWishlist: builder.mutation<{ message?: string }, number | string>({
      query: (productId) => ({ url: `${WISHLIST_URL}/${productId}`, method: 'DELETE' }),
      invalidatesTags: ['Wishlist', 'Product'],
    }),
    checkWishlist: builder.query<{ inWishlist?: boolean }, number | string>({
      query: (productId) => `${WISHLIST_URL}/check/${productId}`,
      providesTags: ['Wishlist'],
    }),
  }),
});

export const {
  useGetMyWishlistQuery,
  useAddToWishlistMutation,
  useRemoveFromWishlistMutation,
  useCheckWishlistQuery,
} = wishlistApiSlice;