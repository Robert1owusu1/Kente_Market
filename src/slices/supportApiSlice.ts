import { SUPPORT_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { Ticket } from "./apiTypes";

export const supportApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyTickets: builder.query<Ticket[], void>({
      query: () => SUPPORT_URL,
      providesTags: ['SupportTickets'],
    }),
    createTicket: builder.mutation<Ticket, Record<string, unknown>>({
      query: (data) => ({ url: SUPPORT_URL, method: 'POST', body: data }),
      invalidatesTags: ['SupportTickets'],
    }),
  }),
});

export const { useGetMyTicketsQuery, useCreateTicketMutation } = supportApiSlice;