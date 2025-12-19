// productsApiSlice.js
import { PRODUCTS_URL } from "../constant";
import { apiSlice } from "./apslice.js";

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
        
        console.log('🔍 RTK Query URL:', url);
        
        return url;
      },
      keepUnusedDataFor: 5,
      providesTags: ['Product'],
    }),

    getProductsDetails: builder.query({
      query: (productId) => ({
        url: `${PRODUCTS_URL}/${productId}`,
      }),
      keepUnusedDataFor: 5,
      providesTags: (result, error, id) => [{ type: 'Product', id }],
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
  useGetProductsDetailsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
} = productsApiSlice;