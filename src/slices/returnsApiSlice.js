import { RETURNS_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const returnsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAllReturns: builder.query({ query: () => RETURNS_URL, providesTags: ['Return'] }),
    getMyReturns: builder.query({ query: () => `${RETURNS_URL}/myreturns`, providesTags: ['Return'] }),
    createReturn: builder.mutation({ query: (data) => ({ url: RETURNS_URL, method: 'POST', body: data }), invalidatesTags: ['Return'] }),
    updateReturnStatus: builder.mutation({ query: ({ id, ...data }) => ({ url: `${RETURNS_URL}/${id}`, method: 'PUT', body: data }), invalidatesTags: ['Return'] }),
  }),
});

export const { useGetAllReturnsQuery, useGetMyReturnsQuery, useCreateReturnMutation, useUpdateReturnStatusMutation } = returnsApiSlice;
