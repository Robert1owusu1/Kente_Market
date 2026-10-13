import { RETURNS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { ReturnRequest } from "./apiTypes";

/** PUT /returns/:id response. refundOutcome reports what happened to the money on approval. */
export interface UpdateReturnStatusResult {
  message: string;
  returnRequest: ReturnRequest;
  refundOutcome?: 'not-applicable' | 'issued' | 'rejected' | 'unknown' | 'not-refundable';
}

export const returnsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAllReturns: builder.query<ReturnRequest[], void>({
      query: () => RETURNS_URL,
      providesTags: ['Return'],
    }),
    getMyReturns: builder.query<ReturnRequest[], void>({
      query: () => `${RETURNS_URL}/myreturns`,
      providesTags: ['Return'],
    }),
    createReturn: builder.mutation<ReturnRequest, Record<string, unknown>>({
      query: (data) => ({ url: RETURNS_URL, method: 'POST', body: data }),
      invalidatesTags: ['Return'],
    }),
    updateReturnStatus: builder.mutation<UpdateReturnStatusResult, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({ url: `${RETURNS_URL}/${id}`, method: 'PUT', body: data }),
      invalidatesTags: ['Return'],
    }),
  }),
});

export const {
  useGetAllReturnsQuery,
  useGetMyReturnsQuery,
  useCreateReturnMutation,
  useUpdateReturnStatusMutation,
} = returnsApiSlice;