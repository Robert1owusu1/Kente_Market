import { COUPONS_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const couponsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getCoupons: builder.query({ query: () => COUPONS_URL, providesTags: ['Coupon'] }),
    getCouponById: builder.query({ query: (id) => `${COUPONS_URL}/${id}`, providesTags: (r, e, id) => [{ type: 'Coupon', id }] }),
    createCoupon: builder.mutation({ query: (data) => ({ url: COUPONS_URL, method: 'POST', body: data }), invalidatesTags: ['Coupon'] }),
    updateCoupon: builder.mutation({ query: ({ id, ...data }) => ({ url: `${COUPONS_URL}/${id}`, method: 'PUT', body: data }), invalidatesTags: ['Coupon'] }),
    deleteCoupon: builder.mutation({ query: (id) => ({ url: `${COUPONS_URL}/${id}`, method: 'DELETE' }), invalidatesTags: ['Coupon'] }),
    validateCoupon: builder.mutation({ query: (data) => ({ url: `${COUPONS_URL}/validate`, method: 'POST', body: data }), invalidatesTags: ['Coupon'] }),
  }),
});

export const { useGetCouponsQuery, useGetCouponByIdQuery, useCreateCouponMutation, useUpdateCouponMutation, useDeleteCouponMutation, useValidateCouponMutation } = couponsApiSlice;
