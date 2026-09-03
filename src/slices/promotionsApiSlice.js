import { PROMOTIONS_URL } from '../constant';
import { apiSlice } from './apslice';

export const promotionsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Public: active banners for hero
    getActiveBanners: builder.query({
      query: () => `${PROMOTIONS_URL}/public/banners`,
      providesTags: ['Promotion'],
      keepUnusedDataFor: 300,
    }),

    // Public: active popups
    getActivePopups: builder.query({
      query: () => `${PROMOTIONS_URL}/public/popups`,
      providesTags: ['Promotion'],
      keepUnusedDataFor: 300,
    }),

    // Admin: list all
    getPromotions: builder.query({
      query: () => ({
        url: PROMOTIONS_URL,
        method: 'GET',
      }),
      providesTags: ['Promotion'],
    }),

    // Admin: create
    createPromotion: builder.mutation({
      query: (data) => ({
        url: PROMOTIONS_URL,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['Promotion'],
    }),

    // Admin: update
    updatePromotion: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${PROMOTIONS_URL}/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: ['Promotion'],
    }),

    // Admin: delete
    deletePromotion: builder.mutation({
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
