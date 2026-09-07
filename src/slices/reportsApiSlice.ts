import { REPORTS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { ReportItem } from "./apiTypes";

export const reportsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAllReports: builder.query<ReportItem[], void>({
      query: () => REPORTS_URL,
      providesTags: ['Report'],
    }),
    createReport: builder.mutation<ReportItem, Record<string, unknown>>({
      query: (data) => ({ url: REPORTS_URL, method: 'POST', body: data }),
      invalidatesTags: ['Report'],
    }),
    updateReportStatus: builder.mutation<ReportItem, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({ url: `${REPORTS_URL}/${id}`, method: 'PUT', body: data }),
      invalidatesTags: ['Report'],
    }),
  }),
});

export const {
  useGetAllReportsQuery,
  useCreateReportMutation,
  useUpdateReportStatusMutation,
} = reportsApiSlice;