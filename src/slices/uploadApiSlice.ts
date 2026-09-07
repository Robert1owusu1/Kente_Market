import { apiSlice } from './apiSlice';

interface UploadResult {
  url?: string;
  filename?: string;
  message?: string;
  [key: string]: unknown;
}

export const uploadApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Upload product image
    // Note: overrides the baseQuery's 15s timeout because image uploads can
    // legitimately take longer on slow connections / larger files. Otherwise
    // RTK Query aborts with a TIMEOUT_ERROR (no .data), which the UI can't
    // distinguish from a real backend failure.
    uploadImage: builder.mutation<UploadResult, FormData>({
      query: (formData) => ({
        url: '/api/upload',
        method: 'POST',
        body: formData,
        timeout: 120000,
      }),
    }),

    // Delete product image
    deleteImage: builder.mutation<
      { message?: string },
      string
    >({
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