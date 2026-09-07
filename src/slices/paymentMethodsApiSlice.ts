import { PAYMENT_METHODS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { PaymentMethod } from "./apiTypes";

export const paymentMethodsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyPaymentMethods: builder.query<PaymentMethod[], void>({
      query: () => PAYMENT_METHODS_URL,
      providesTags: ['PaymentMethods'],
    }),
    addPaymentMethod: builder.mutation<PaymentMethod, Record<string, unknown>>({
      query: (data) => ({ url: PAYMENT_METHODS_URL, method: 'POST', body: data }),
      invalidatesTags: ['PaymentMethods'],
    }),
    setDefaultPaymentMethod: builder.mutation<PaymentMethod, number | string>({
      query: (id) => ({ url: `${PAYMENT_METHODS_URL}/${id}/default`, method: 'PUT' }),
      invalidatesTags: ['PaymentMethods'],
    }),
    deletePaymentMethod: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({ url: `${PAYMENT_METHODS_URL}/${id}`, method: 'DELETE' }),
      invalidatesTags: ['PaymentMethods'],
    }),
  }),
});

export const {
  useGetMyPaymentMethodsQuery,
  useAddPaymentMethodMutation,
  useSetDefaultPaymentMethodMutation,
  useDeletePaymentMethodMutation,
} = paymentMethodsApiSlice;