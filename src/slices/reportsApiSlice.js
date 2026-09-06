import { REPORTS_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const reportsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAllReports: builder.query({ query: () => REPORTS_URL, providesTags: ['Report'] }),
    createReport: builder.mutation({ query: (data) => ({ url: REPORTS_URL, method: 'POST', body: data }), invalidatesTags: ['Report'] }),
    updateReportStatus: builder.mutation({ query: ({ id, ...data }) => ({ url: `${REPORTS_URL}/${id}`, method: 'PUT', body: data }), invalidatesTags: ['Report'] }),
  }),
});

export const { useGetAllReportsQuery, useCreateReportMutation, useUpdateReportStatusMutation } = reportsApiSlice;
