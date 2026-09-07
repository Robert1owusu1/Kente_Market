// FILE LOCATION: src/slices/settingsApiSlice.ts
// DESCRIPTION: Redux RTK Query API slice for settings management

import { apiSlice } from "./apiSlice";
import type { Settings } from "./apiTypes";

export const settingsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Get all settings
    getSettings: builder.query<Settings[], void>({
      query: () => ({
        url: '/api/settings',
        method: "GET",
      }),
      providesTags: ["Settings"],
      keepUnusedDataFor: 60,
    }),

    // Get single setting by key
    getSetting: builder.query<Settings, string>({
      query: (key) => ({
        url: `/api/settings/${key}`,
        method: "GET",
      }),
      providesTags: (_result, _error, key) => [{ type: "Settings", id: key }] as const,
    }),

    // Update settings
    updateSettings: builder.mutation<Settings[], Record<string, unknown>>({
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