// slices/ordersApiSlice.js
import { ORDERS_URL } from "../constant";
import { apiSlice } from "./apslice";

export const ordersApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ✅ Create new order
    createOrder: builder.mutation({
      query: (orderData) => ({
        url: ORDERS_URL,
        method: "POST",
        body: orderData,
      }),
      invalidatesTags: ["Order"],
    }),

    // ✅ Get all orders (Admin only) - with customer names included
    getAllOrders: builder.query({
      query: ({ page = 1, limit = 100, status, paymentStatus, search, sortBy, sortOrder } = {}) => {
        const params = new URLSearchParams();
        if (page) params.append('page', page);
        if (limit) params.append('limit', limit);
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
      transformResponse: (response) => {
        // If response has pagination structure
        if (response.orders && response.pagination) {
          return response.orders; // Return just the orders array
        }
        // If response is already an array
        return response;
      },
    }),

    // ✅ Get logged-in user's orders
    getMyOrders: builder.query({
      query: () => ({
        url: `${ORDERS_URL}/myorders`,
        method: "GET",
      }),
      providesTags: ["Order"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Get order by ID - includes customer information
    getOrderById: builder.query({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}`,
        method: "GET",
      }),
      providesTags: (result, error, orderId) => [{ type: "Order", id: orderId }],
    }),

    // ✅ Update order status/details
    updateOrder: builder.mutation({
      query: ({ orderId, ...updateData }) => ({
        url: `${ORDERS_URL}/${orderId}`,
        method: "PUT",
        body: updateData,
      }),
      invalidatesTags: (result, error, { orderId }) => [
        { type: "Order", id: orderId },
        "Order",
      ],
    }),

    // ✅ Mark order as paid
    updateOrderToPaid: builder.mutation({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}/pay`,
        method: "PUT",
      }),
      invalidatesTags: (result, error, orderId) => [
        { type: "Order", id: orderId },
        "Order",
      ],
    }),

    // ✅ Mark order as delivered (Admin only)
    updateOrderToDelivered: builder.mutation({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}/deliver`,
        method: "PUT",
      }),
      invalidatesTags: (result, error, orderId) => [
        { type: "Order", id: orderId },
        "Order",
      ],
    }),

    // ✅ Delete order (Admin only)
    deleteOrder: builder.mutation({
      query: (orderId) => ({
        url: `${ORDERS_URL}/${orderId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Order"],
    }),

    // ✅ Get order statistics (Admin only)
    getOrderStatistics: builder.query({
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
  useDeleteOrderMutation,
  useGetOrderStatisticsQuery,
} = ordersApiSlice;