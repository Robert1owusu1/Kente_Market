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
    listAllTickets: builder.query<Ticket[], void>({
      query: () => `${SUPPORT_URL}/all`,
      providesTags: ['SupportTickets'],
    }),
    replyTicket: builder.mutation<Ticket, { id: number | string; reply: string }>({
      query: ({ id, reply }) => ({
        url: `${SUPPORT_URL}/${id}/reply`,
        method: 'POST',
        body: { reply },
      }),
      invalidatesTags: ['SupportTickets'],
    }),
    updateTicketStatus: builder.mutation<Ticket, { id: number | string; status: string }>({
      query: ({ id, status }) => ({
        url: `${SUPPORT_URL}/${id}/status`,
        method: 'PUT',
        body: { status },
      }),
      invalidatesTags: ['SupportTickets'],
    }),
  }),
});

export const {
  useGetMyTicketsQuery,
  useCreateTicketMutation,
  useListAllTicketsQuery,
  useReplyTicketMutation,
  useUpdateTicketStatusMutation,
} = supportApiSlice;