import { ADDRESSES_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { Address } from "./apiTypes";

export const addressesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyAddresses: builder.query<Address[], void>({
      query: () => ADDRESSES_URL,
      providesTags: ['Addresses'],
    }),
    createAddress: builder.mutation<Address, Record<string, unknown>>({
      query: (data) => ({ url: ADDRESSES_URL, method: 'POST', body: data }),
      invalidatesTags: ['Addresses'],
    }),
    updateAddress: builder.mutation<Address, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({ url: `${ADDRESSES_URL}/${id}`, method: 'PUT', body: data }),
      invalidatesTags: ['Addresses'],
    }),
    deleteAddress: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({ url: `${ADDRESSES_URL}/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Addresses'],
    }),
  }),
});

export const {
  useGetMyAddressesQuery,
  useCreateAddressMutation,
  useUpdateAddressMutation,
  useDeleteAddressMutation,
} = addressesApiSlice;