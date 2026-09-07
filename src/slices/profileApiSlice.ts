import { apiSlice } from './apiSlice';
import type { AuthUser } from '../types/domain';

const PROFILE_URL = '/api/profile';

export const profileApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    uploadProfilePicture: builder.mutation<{ url?: string; [key: string]: unknown }, FormData>({
      query: (formData) => ({
        url: `${PROFILE_URL}/upload`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['User'],
    }),
    deleteProfilePicture: builder.mutation<AuthUser | { message?: string }, void>({
      query: () => ({
        url: `${PROFILE_URL}/picture`,
        method: 'DELETE',
      }),
      invalidatesTags: ['User'],
    }),
  }),
});

export const {
  useUploadProfilePictureMutation,
  useDeleteProfilePictureMutation,
} = profileApiSlice;