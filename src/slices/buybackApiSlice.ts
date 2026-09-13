import { apiSlice } from './apiSlice';

export interface BuybackRequest {
  id: number;
  customerId: number;
  orderId: number;
  productId: number;
  quantity: number;
  conditionNote?: string | null;
  expectedPrice?: string | number | null;
  buybackPrice?: string | number | null;
  status: 'pending' | 'approved' | 'declined';
  adminNote?: string | null;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  orderNumber?: string;
  productTitle?: string;
  productImage?: string | null;
  productPrice?: string | number | null;
  firstName?: string;
  lastName?: string;
  email?: string;
  [key: string]: unknown;
}

export const buybackApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Customer: offer a delivered order item back to the marketplace.
    createBuybackRequest: builder.mutation<
      { message?: string; request?: BuybackRequest },
      { orderId: number | string; productId: number | string; quantity?: number; conditionNote?: string; expectedPrice?: number }
    >({
      query: ({ orderId, ...body }) => ({
        url: `/api/orders/${orderId}/buyback`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Buyback', 'Order'],
    }),

    // Customer: list their own sell-back requests.
    getMyBuybackRequests: builder.query<{ requests: BuybackRequest[] }, void>({
      query: () => ({ url: '/api/orders/my-buyback', method: 'GET' }),
      providesTags: ['Buyback'],
      keepUnusedDataFor: 15,
    }),

    // Admin: list sell-back requests (defaults to pending first).
    getAllBuybackRequests: builder.query<{ requests: BuybackRequest[] }, { status?: string; showDeclined?: boolean } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.status) params.set('status', args.status);
        if (args?.showDeclined !== undefined) params.set('showDeclined', String(args.showDeclined));
        const qs = params.toString();
        return { url: `/api/admin/buyback${qs ? `?${qs}` : ''}`, method: 'GET' };
      },
      providesTags: ['Buyback'],
      keepUnusedDataFor: 15,
    }),

    // Admin: approve (with offer) or decline a request.
    reviewBuybackRequest: builder.mutation<
      { message?: string; request?: BuybackRequest },
      { id: number | string; decision: 'approved' | 'declined'; buybackPrice?: number; adminNote?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/api/admin/buyback/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['Buyback', 'Product', 'Products'],
    }),
  }),
});

export const {
  useCreateBuybackRequestMutation,
  useGetMyBuybackRequestsQuery,
  useGetAllBuybackRequestsQuery,
  useReviewBuybackRequestMutation,
} = buybackApiSlice;