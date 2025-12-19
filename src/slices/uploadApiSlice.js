import { apiSlice } from './apslice.js';

export const uploadApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Upload product image
    uploadImage: builder.mutation({
      query: (formData) => ({
        url: '/api/upload',
        method: 'POST',
        body: formData,
      }),
    }),
    
    // Delete product image
    deleteImage: builder.mutation({
      query: (filename) => ({
        url: `/api/upload/${filename}`,
        method: 'DELETE',
      }),
    }),
  }),
});

export const { 
  useUploadImageMutation, 
  useDeleteImageMutation 
} = uploadApiSlice;