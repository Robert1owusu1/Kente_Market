import { NOTIFICATIONS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { Notification, NotificationList } from "./apiTypes";

export const notificationsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMyNotifications: builder.query<NotificationList, Record<string, unknown> | undefined>({
      query: (params) => ({ url: NOTIFICATIONS_URL, params }),
      providesTags: ['Notification'],
    }),
    getUnreadCount: builder.query<{ count?: number }, void>({
      query: () => `${NOTIFICATIONS_URL}/unread-count`,
      providesTags: ['Notification'],
    }),
    markAsRead: builder.mutation<Notification, number | string>({
      query: (id) => ({ url: `${NOTIFICATIONS_URL}/${id}`, method: 'PUT' }),
      invalidatesTags: ['Notification'],
    }),
    markAllAsRead: builder.mutation<{ message?: string }, void>({
      query: () => ({ url: `${NOTIFICATIONS_URL}/mark-all-read`, method: 'PUT' }),
      invalidatesTags: ['Notification'],
    }),
    deleteNotification: builder.mutation<{ message?: string }, number | string>({
      query: (id) => ({ url: `${NOTIFICATIONS_URL}/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Notification'],
    }),
    deleteAllNotifications: builder.mutation<{ message?: string }, void>({
      query: () => ({ url: NOTIFICATIONS_URL, method: 'DELETE' }),
      invalidatesTags: ['Notification'],
    }),
  }),
});

export const {
  useGetMyNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkAsReadMutation,
  useMarkAllAsReadMutation,
  useDeleteNotificationMutation,
  useDeleteAllNotificationsMutation,
} = notificationsApiSlice;