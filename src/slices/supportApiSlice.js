import { SUPPORT_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const supportApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyTickets: builder.query({ query: () => SUPPORT_URL, providesTags: ['SupportTickets'] }),
    createTicket: builder.mutation({
      query: (data) => ({ url: SUPPORT_URL, method: 'POST', body: data }),
      invalidatesTags: ['SupportTickets'],
    }),
  }),
});

export const { useGetMyTicketsQuery, useCreateTicketMutation } = supportApiSlice;
