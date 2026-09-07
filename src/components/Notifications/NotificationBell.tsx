import React, { useState, useRef, useEffect } from 'react';
import { FaBell, FaShoppingCart, FaBox, FaTag, FaUser, FaEnvelope, FaFlag, FaCheckDouble, FaTrash } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useGetMyNotificationsQuery, useGetUnreadCountQuery, useMarkAllAsReadMutation, useDeleteAllNotificationsMutation } from '../../slices/notificationsApiSlice';
import type { Notification } from '../../slices/apiTypes';

const getTypeIcon = (type?: string) => {
  switch (type) {
    case 'order':
    case 'shipping':
      return <FaBox className="text-indigo-500" />;
    case 'cart':
      return <FaShoppingCart className="text-green-500" />;
    case 'promotion':
      return <FaTag className="text-pink-500" />;
    case 'report':
      return <FaFlag className="text-red-500" />;
    case 'account':
      return <FaUser className="text-blue-500" />;
    case 'email':
      return <FaEnvelope className="text-yellow-500" />;
    default:
      return <FaBell className="text-gray-500" />;
  }
};

const timeAgo = (dateString?: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
};

const NotificationBell = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useGetMyNotificationsQuery({ limit: 10 });
  const { data: unreadData } = useGetUnreadCountQuery();
  const [markAllAsRead] = useMarkAllAsReadMutation();
  const [deleteAllNotifications] = useDeleteAllNotificationsMutation();

  const notifications = (data ?? []) as Notification[];

  const unreadCount = unreadData?.count || 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAllAsRead = async () => {
    try {
      await markAllAsRead().unwrap();
      toast.success('All notifications marked as read');
    } catch (err) {
      toast.error((err as { data?: { message?: string } }).data?.message || 'Failed to mark notifications as read');
    }
  };

  const handleClearAll = async () => {
    try {
      await deleteAllNotifications().unwrap();
      toast.success('All notifications cleared');
    } catch (err) {
      toast.error((err as { data?: { message?: string } }).data?.message || 'Failed to clear notifications');
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Notifications, ${unreadCount} unread`}
        className="relative p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <FaBell className="text-xl text-gray-600 dark:text-gray-300" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-semibold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 max-h-96 overflow-y-auto z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800">
            <p className="font-semibold text-gray-900 dark:text-white">Notifications</p>
            <div className="flex items-center gap-1">
              <button
                onClick={handleMarkAllAsRead}
                disabled={unreadCount === 0}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Mark all as read"
              >
                <FaCheckDouble className="text-xs" />
                Mark read
              </button>
              <button
                onClick={handleClearAll}
                disabled={notifications.length === 0}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 disabled:opacity-50 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                title="Clear all"
              >
                <FaTrash className="text-xs" />
                Clear
              </button>
            </div>
          </div>

          {/* Notifications list */}
          {isLoading ? (
            <div className="p-6 text-center">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto"></div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Loading...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center">
              <FaBell className="text-4xl text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">No notifications yet</p>
            </div>
          ) : (
            <div className="py-1">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`flex gap-3 px-4 py-3 border-b dark:border-gray-700 last:border-0 ${
                    String(notification.is_read) === '0' || notification.is_read === 0
                      ? 'bg-indigo-50 dark:bg-indigo-900/20'
                      : ''
                  }`}
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    {getTypeIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {notification.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                      {notification.message}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">{timeAgo(notification.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
