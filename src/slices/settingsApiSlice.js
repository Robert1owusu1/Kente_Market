// FILE LOCATION: src/slices/settingsApiSlice.js
// DESCRIPTION: Redux RTK Query API slice for settings management

import { apiSlice } from "./apslice";

export const settingsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Get all settings
    getSettings: builder.query({
      query: () => ({
        url: '/api/settings',
        method: "GET",
      }),
      providesTags: ["Settings"],
      keepUnusedDataFor: 60,
    }),

    // Get single setting by key
    getSetting: builder.query({
      query: (key) => ({
        url: `/api/settings/${key}`,
        method: "GET",
      }),
      providesTags: (result, error, key) => [{ type: "Settings", id: key }],
    }),

    // Update settings
    updateSettings: builder.mutation({
      query: (settings) => ({
        url: '/api/settings',
        method: "PUT",
        body: settings,
      }),
      invalidatesTags: ["Settings"],
    }),
  }),
});

export const {
  useGetSettingsQuery,
  useGetSettingQuery,
  useUpdateSettingsMutation,
} = settingsApiSlice;