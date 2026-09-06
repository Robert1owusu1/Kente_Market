import { PAYMENT_METHODS_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const paymentMethodsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyPaymentMethods: builder.query({ query: () => PAYMENT_METHODS_URL, providesTags: ['PaymentMethods'] }),
    addPaymentMethod: builder.mutation({
      query: (data) => ({ url: PAYMENT_METHODS_URL, method: 'POST', body: data }),
      invalidatesTags: ['PaymentMethods'],
    }),
    setDefaultPaymentMethod: builder.mutation({
      query: (id) => ({ url: `${PAYMENT_METHODS_URL}/${id}/default`, method: 'PUT' }),
      invalidatesTags: ['PaymentMethods'],
    }),
    deletePaymentMethod: builder.mutation({
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
