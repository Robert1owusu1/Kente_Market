// productsApiSlice.js
import { PRODUCTS_URL } from "../constant";
import { apiSlice } from "./apiSlice.js";

export const productsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getProducts: builder.query({
      // ✅ FIXED: Properly handle query params
      query: (params = {}) => {
        // Build the query string manually for better control
        const queryParams = new URLSearchParams();
        
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.offset) queryParams.append('offset', params.offset);
        if (params.category) queryParams.append('category', params.category);
        if (params.search) queryParams.append('search', params.search);
        if (params.featured !== undefined) queryParams.append('featured', params.featured);
        if (params.minPrice) queryParams.append('minPrice', params.minPrice);
        if (params.maxPrice) queryParams.append('maxPrice', params.maxPrice);
        
        const queryString = queryParams.toString();
        const url = queryString ? `${PRODUCTS_URL}?${queryString}` : PRODUCTS_URL;

        return url;
      },
      // Keep catalogue data in the cache for a while (seconds). Returning to a
      // page then renders instantly instead of re-downloading the whole JSON on
      // slow / flaky connections. Fresh data is still pulled when a cache tag
      // is invalidated after an admin add/edit/delete.
      keepUnusedDataFor: 300,
      providesTags: ['Product'],
    }),

    getProductsDetails: builder.query({
      query: (productId) => ({
        url: `${PRODUCTS_URL}/${productId}`,
      }),
      // Product detail pages benefit from a longer cache life.
      keepUnusedDataFor: 600,
      providesTags: (result, error, id) => [{ type: 'Product', id }],
    }),

    getFeaturedProducts: builder.query({
      query: (params = {}) => {
        const queryParams = new URLSearchParams();
        if (params.limit) queryParams.append('limit', params.limit);
        const queryString = queryParams.toString();
        return queryString
          ? `${PRODUCTS_URL}/featured?${queryString}`
          : `${PRODUCTS_URL}/featured`;
      },
      // Featured/trending lists change rarely; cache them longer so the home
      // page is instant on repeat visits without burning bandwidth.
      keepUnusedDataFor: 7200,
      providesTags: ['Product'],
    }),

    getTrendingProducts: builder.query({
      query: (params = {}) => {
        const queryParams = new URLSearchParams();
        if (params.limit) queryParams.append('limit', params.limit);
        const queryString = queryParams.toString();
        return queryString
          ? `${PRODUCTS_URL}/trending?${queryString}`
          : `${PRODUCTS_URL}/trending`;
      },
      keepUnusedDataFor: 7200,
      providesTags: ['Product'],
    }),

    createProduct: builder.mutation({
      query: (productData) => ({
        url: PRODUCTS_URL,
        method: 'POST',
        body: productData,
      }),
      invalidatesTags: ['Product'],
    }),

    updateProduct: builder.mutation({
      query: ({ productId, ...productData }) => ({
        url: `${PRODUCTS_URL}/${productId}`,
        method: 'PUT',
        body: productData,
      }),
      invalidatesTags: (result, error, { productId }) => [
        { type: 'Product', id: productId },
        'Product',
      ],
    }),

    deleteProduct: builder.mutation({
      query: (productId) => ({
        url: `${PRODUCTS_URL}/${productId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Product'],
    }),
  }),
});

// Export the hooks that RTK Query automatically generates
export const {
  useGetProductsQuery,
  useLazyGetProductsQuery,
  useGetProductsDetailsQuery,
  useGetFeaturedProductsQuery,
  useGetTrendingProductsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
} = productsApiSlice;