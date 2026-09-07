import { PROMOTIONS_URL } from '../constant';
import { apiSlice } from './apiSlice';

export interface Promotion {
  id?: number | string;
  title?: string;
  type?: string;
  image?: string;
  link?: string;
  description?: string;
  position?: string;
  isActive?: boolean;
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
}

export const promotionsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Public: active banners for hero
    getActiveBanners: builder.query<Promotion[], void>({
      query: () => `${PROMOTIONS_URL}/public/banners`,
      providesTags: ['Promotion'],
      keepUnusedDataFor: 300,
    }),

    // Public: active popups
    getActivePopups: builder.query<Promotion[], void>({
      query: () => `${PROMOTIONS_URL}/public/popups`,
      providesTags: ['Promotion'],
      keepUnusedDataFor: 300,
    }),

    // Admin: list all
    getPromotions: builder.query<Promotion[], void>({
      query: () => ({
        url: PROMOTIONS_URL,
        method: 'GET',
      }),
      providesTags: ['Promotion'],
    }),

    // Admin: create
    createPromotion: builder.mutation<Promotion, Record<string, unknown>>({
      query: (data) => ({
        url: PROMOTIONS_URL,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['Promotion'],
    }),

    // Admin: update
    updatePromotion: builder.mutation<Promotion, { id: number | string; [key: string]: unknown }>({
      query: ({ id, ...data }) => ({
        url: `${PROMOTIONS_URL}/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: ['Promotion'],
    }),

    // Admin: delete
    deletePromotion: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({
        url: `${PROMOTIONS_URL}/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Promotion'],
    }),
  }),
});

export const {
  useGetActiveBannersQuery,
  useGetActivePopupsQuery,
  useGetPromotionsQuery,
  useCreatePromotionMutation,
  useUpdatePromotionMutation,
  useDeletePromotionMutation,
} = promotionsApiSlice;