import { WISHLIST_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const wishlistApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyWishlist: builder.query({ query: () => WISHLIST_URL, providesTags: ['Wishlist'] }),
    addToWishlist: builder.mutation({ query: (data) => ({ url: WISHLIST_URL, method: 'POST', body: data }), invalidatesTags: ['Wishlist', 'Product'] }),
    removeFromWishlist: builder.mutation({ query: (productId) => ({ url: `${WISHLIST_URL}/${productId}`, method: 'DELETE' }), invalidatesTags: ['Wishlist', 'Product'] }),
    checkWishlist: builder.query({ query: (productId) => `${WISHLIST_URL}/check/${productId}`, providesTags: ['Wishlist'] }),
  }),
});

export const { useGetMyWishlistQuery, useAddToWishlistMutation, useRemoveFromWishlistMutation, useCheckWishlistQuery } = wishlistApiSlice;
