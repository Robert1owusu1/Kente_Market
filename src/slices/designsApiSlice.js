import { DESIGNS_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const designsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyDesigns: builder.query({ query: () => DESIGNS_URL, providesTags: ['Designs'] }),
    createDesign: builder.mutation({
      query: (data) => ({ url: DESIGNS_URL, method: 'POST', body: data }),
      invalidatesTags: ['Designs'],
    }),
    updateDesign: builder.mutation({
      query: ({ id, ...data }) => ({ url: `${DESIGNS_URL}/${id}`, method: 'PUT', body: data }),
      invalidatesTags: ['Designs'],
    }),
    deleteDesign: builder.mutation({
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
