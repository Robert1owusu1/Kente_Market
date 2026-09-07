// slices/ordersApiSlice.ts
import { ORDERS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { Order } from "../types/domain";
import type { OrderStatistics } from "./apiTypes";

interface GetAllOrdersArgs {
  page?: number;
  limit?: number;
  status?: string;
  paymentStatus?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

type OrderListResponse = Order[] | { orders?: Order[]; pagination?: unknown; [key: string]: unknown };

export const ordersApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ✅ Create new order
    createOrder: builder.mutation<Order, Record<string, unknown>>({
      query: (orderData) => ({
        url: ORDERS_URL,
        method: "POST",
        body: orderData,
      }),
      invalidatesTags: ["Order"],
    }),

    // ✅ Get all orders (Admin only) - with customer names included
    getAllOrders: builder.query<Order[], GetAllOrdersArgs>({
      query: ({ page = 1, limit = 100, status, paymentStatus, search, sortBy, sortOrder } = {}) => {
        const params = new URLSearchParams();
        if (page) params.append('page', String(page));
        if (limit) params.append('limit', String(limit));
        if (status) params.append('status', status);
        if (paymentStatus) params.append('paymentStatus', paymentStatus);
        if (search) params.append('search', search);
        if (sortBy) params.append('sortBy', sortBy);
        if (sortOrder) params.append('sortOrder', sortOrder);

        return {
          url: `${ORDERS_URL}?${params.toString()}`,
          method: "GET",
        };
      },
      providesTags: ["Order"],
      keepUnusedDataFor: 5,
      // Transform response to ensure we have flat data structure
      transformResponse: (response: OrderListResponse): Order[] => {
        // If response has pagination structure
        if (!Array.isArray(response) && response.orders && response.pagination) {
          return response.orders; // Return just the orders array
        }
        // If response is already an array
        return Array.isArray(response) ? response : [];
      },
    }),

    // ✅ Get logged-in user's orders
    getMyOrders: builder.query<Order[], void>({
      query: () => ({
        url: `${ORDERS_URL}/myorders`,
        method: "GET",
      }),
      providesTags: ["Order"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Get order by ID - includes customer information
    getOrderById: builder.query<Order, number | string>({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}`,
        method: "GET",
      }),
      providesTags: (_result, _error, orderId) => [{ type: "Order", id: orderId }] as const,
    }),

    // ✅ Update order status/details
    updateOrder: builder.mutation<Order, { orderId: number | string; [key: string]: unknown }>({
      query: ({ orderId, ...updateData }) => ({
        url: `${ORDERS_URL}/${orderId}`,
        method: "PUT",
        body: updateData,
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: "Order", id: arg.orderId },
        "Order",
      ] as const,
    }),

    // ✅ Mark order as paid
    updateOrderToPaid: builder.mutation<Order, number | string>({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}/pay`,
        method: "PUT",
      }),
      invalidatesTags: (_result, _error, orderId) => [
        { type: "Order", id: orderId },
        "Order",
      ] as const,
    }),

    // ✅ Mark order as delivered (Admin only)
    updateOrderToDelivered: builder.mutation<Order, number | string>({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}/deliver`,
        method: "PUT",
      }),
      invalidatesTags: (_result, _error, orderId) => [
        { type: "Order", id: orderId },
        "Order",
      ] as const,
    }),

    // ✅ Customer confirms receipt → release escrow to vendors
    confirmOrderReceived: builder.mutation<Order, number | string>({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}/confirm-received`,
        method: "POST",
      }),
      invalidatesTags: (_result, _error, orderId) => [
        { type: "Order", id: orderId },
        "Order",
      ] as const,
    }),

    // ✅ Cancel order and void escrow (Admin only)
    cancelOrder: builder.mutation<Order, number | string>({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}/cancel`,
        method: "PUT",
      }),
      invalidatesTags: (_result, _error, orderId) => [
        { type: "Order", id: orderId },
        "Order",
      ] as const,
    }),

    // ✅ Retry failed escrow payouts (Admin only)
    retryEscrowPayouts: builder.mutation<Order, number | string>({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}/retry-escrow`,
        method: "POST",
      }),
      invalidatesTags: (_result, _error, orderId) => [
        { type: "Order", id: orderId },
        "Order",
      ] as const,
    }),

    // ✅ Delete order (Admin only)
    deleteOrder: builder.mutation<{ message?: string }, number | string>({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Order"],
    }),

    // ✅ Get order statistics (Admin only)
    getOrderStatistics: builder.query<OrderStatistics, void>({
      query: () => ({
        url: `${ORDERS_URL}/statistics`,
        method: "GET",
      }),
      providesTags: ["OrderStats"],
      keepUnusedDataFor: 30, // Cache for 30 seconds
    }),
  }),
});

export const {
  useCreateOrderMutation,
  useGetAllOrdersQuery,
  useGetMyOrdersQuery,
  useGetOrderByIdQuery,
  useUpdateOrderMutation,
  useUpdateOrderToPaidMutation,
  useUpdateOrderToDeliveredMutation,
  useConfirmOrderReceivedMutation,
  useCancelOrderMutation,
  useRetryEscrowPayoutsMutation,
  useDeleteOrderMutation,
  useGetOrderStatisticsQuery,
} = ordersApiSlice;