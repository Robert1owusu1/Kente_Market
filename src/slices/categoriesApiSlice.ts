// slices/categoriesApiSlice.ts
import { CATEGORIES_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { Category } from "../types/domain";

export const categoriesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Public: active categories for storefront filters & product forms
    getCategories: builder.query<Category[], void>({
      query: () => CATEGORIES_URL,
      providesTags: ["Category"],
    }),
    // Admin: all categories including inactive
    getAllCategories: builder.query<Category[], void>({
      query: () => `${CATEGORIES_URL}/all`,
      providesTags: ["Category"],
    }),
    createCategory: builder.mutation<Category, Record<string, unknown>>({
      query: (data) => ({ url: CATEGORIES_URL, method: "POST", body: data }),
      invalidatesTags: ["Category"],
    }),
    updateCategory: builder.mutation<Category, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({
        url: `${CATEGORIES_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Category"],
    }),
    deleteCategory: builder.mutation<{ message?: string }, number | string>({
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