import { apiSlice } from './apslice';

const PROFILE_URL = '/api/profile';

export const profileApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    uploadProfilePicture: builder.mutation({
      query: (formData) => ({
        url: `${PROFILE_URL}/upload`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['User'],
    }),
    deleteProfilePicture: builder.mutation({
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