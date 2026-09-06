import { ADDRESSES_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const addressesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyAddresses: builder.query({ query: () => ADDRESSES_URL, providesTags: ['Addresses'] }),
    createAddress: builder.mutation({
      query: (data) => ({ url: ADDRESSES_URL, method: 'POST', body: data }),
      invalidatesTags: ['Addresses'],
    }),
    updateAddress: builder.mutation({
      query: ({ id, ...data }) => ({ url: `${ADDRESSES_URL}/${id}`, method: 'PUT', body: data }),
      invalidatesTags: ['Addresses'],
    }),
    deleteAddress: builder.mutation({
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
