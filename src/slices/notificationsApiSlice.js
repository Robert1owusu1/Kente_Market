import { NOTIFICATIONS_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const notificationsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyNotifications: builder.query({ query: (params) => ({ url: NOTIFICATIONS_URL, params }), providesTags: ['Notification'] }),
    getUnreadCount: builder.query({ query: () => `${NOTIFICATIONS_URL}/unread-count`, providesTags: ['Notification'] }),
    markAsRead: builder.mutation({ query: (id) => ({ url: `${NOTIFICATIONS_URL}/${id}`, method: 'PUT' }), invalidatesTags: ['Notification'] }),
    markAllAsRead: builder.mutation({ query: () => ({ url: `${NOTIFICATIONS_URL}/mark-all-read`, method: 'PUT' }), invalidatesTags: ['Notification'] }),
    deleteNotification: builder.mutation({ query: (id) => ({ url: `${NOTIFICATIONS_URL}/${id}`, method: 'DELETE' }), invalidatesTags: ['Notification'] }),
    deleteAllNotifications: builder.mutation({ query: () => ({ url: NOTIFICATIONS_URL, method: 'DELETE' }), invalidatesTags: ['Notification'] }),
  }),
});

export const { useGetMyNotificationsQuery, useGetUnreadCountQuery, useMarkAsReadMutation, useMarkAllAsReadMutation, useDeleteNotificationMutation, useDeleteAllNotificationsMutation } = notificationsApiSlice;
