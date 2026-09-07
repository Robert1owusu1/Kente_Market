import { COUPONS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { Coupon } from "../types/domain";

export const couponsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getCoupons: builder.query<Coupon[], void>({
      query: () => COUPONS_URL,
      providesTags: ['Coupon'],
    }),
    getCouponById: builder.query<Coupon, number | string>({
      query: (id) => `${COUPONS_URL}/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Coupon', id }] as const,
    }),
    createCoupon: builder.mutation<Coupon, Record<string, unknown>>({
      query: (data) => ({ url: COUPONS_URL, method: 'POST', body: data }),
      invalidatesTags: ['Coupon'],
    }),
    updateCoupon: builder.mutation<Coupon, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({ url: `${COUPONS_URL}/${id}`, method: 'PUT', body: data }),
      invalidatesTags: ['Coupon'],
    }),
    deleteCoupon: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({ url: `${COUPONS_URL}/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Coupon'],
    }),
    validateCoupon: builder.mutation<
      { valid?: boolean; message?: string; coupon?: Coupon; [key: string]: unknown },
      Record<string, unknown>
    >({
      query: (data) => ({ url: `${COUPONS_URL}/validate`, method: 'POST', body: data }),
      invalidatesTags: ['Coupon'],
    }),
  }),
});

export const {
  useGetCouponsQuery,
  useGetCouponByIdQuery,
  useCreateCouponMutation,
  useUpdateCouponMutation,
  useDeleteCouponMutation,
  useValidateCouponMutation,
} = couponsApiSlice;