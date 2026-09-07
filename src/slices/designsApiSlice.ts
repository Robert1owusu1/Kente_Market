import { DESIGNS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { Design } from "./apiTypes";

export const designsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyDesigns: builder.query<Design[], void>({
      query: () => DESIGNS_URL,
      providesTags: ['Designs'],
    }),
    createDesign: builder.mutation<Design, Record<string, unknown>>({
      query: (data) => ({ url: DESIGNS_URL, method: 'POST', body: data }),
      invalidatesTags: ['Designs'],
    }),
    updateDesign: builder.mutation<Design, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({ url: `${DESIGNS_URL}/${id}`, method: 'PUT', body: data }),
      invalidatesTags: ['Designs'],
    }),
    deleteDesign: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({ url: `${DESIGNS_URL}/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Designs'],
    }),
  }),
});

export const {
  useGetMyDesignsQuery,
  useCreateDesignMutation,
  useUpdateDesignMutation,
  useDeleteDesignMutation,
} = designsApiSlice;