import { SUGGESTIONS_URL } from '../constant';
import { apiSlice } from './apiSlice';

export interface Suggestion {
  id?: number | string;
  userId?: number | string;
  subject?: string;
  body?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  [key: string]: unknown;
}

export const suggestionsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    createSuggestion: builder.mutation<Suggestion, Record<string, unknown>>({
      query: (data) => ({ url: SUGGESTIONS_URL, method: 'POST', body: data }),
      invalidatesTags: ['Suggestions'],
    }),
    getMySuggestions: builder.query<Suggestion[], void>({
      query: () => `${SUGGESTIONS_URL}/me`,
      providesTags: ['Suggestions'],
      keepUnusedDataFor: 10,
    }),
    getAllSuggestions: builder.query<Suggestion[], void>({
      query: () => `${SUGGESTIONS_URL}/all`,
      providesTags: ['Suggestions'],
      keepUnusedDataFor: 10,
    }),
    updateSuggestionStatus: builder.mutation<
      Suggestion,
      { id: number | string; status: string }
    >({
      query: ({ id, status }) => ({
        url: `${SUGGESTIONS_URL}/${id}/status`,
        method: 'PUT',
        body: { status },
      }),
      invalidatesTags: ['Suggestions'],
    }),
  }),
});

export const {
  useCreateSuggestionMutation,
  useGetMySuggestionsQuery,
  useGetAllSuggestionsQuery,
  useUpdateSuggestionStatusMutation,
} = suggestionsApiSlice;