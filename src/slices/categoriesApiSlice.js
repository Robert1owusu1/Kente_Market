// slices/categoriesApiSlice.js
import { CATEGORIES_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const categoriesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Public: active categories for storefront filters & product forms
    getCategories: builder.query({
      query: () => CATEGORIES_URL,
      providesTags: ["Category"],
    }),
    // Admin: all categories including inactive
    getAllCategories: builder.query({
      query: () => `${CATEGORIES_URL}/all`,
      providesTags: ["Category"],
    }),
    createCategory: builder.mutation({
      query: (data) => ({ url: CATEGORIES_URL, method: "POST", body: data }),
      invalidatesTags: ["Category"],
    }),
    updateCategory: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${CATEGORIES_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Category"],
    }),
    deleteCategory: builder.mutation({
      query: (id) => ({ url: `${CATEGORIES_URL}/${id}`, method: "DELETE" }),
      invalidatesTags: ["Category"],
    }),
  }),
});

export const {
  useGetCategoriesQuery,
  useGetAllCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
} = categoriesApiSlice;
