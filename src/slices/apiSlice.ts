import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { Base_URL } from '../constant';

// Custom fetchBaseQuery wrapper that:
//  - fails fast (default ~15s) so a dead / flaky connection doesn't leave the
//    UI spinning on a hung request (retries happen at the RTK layer on focus,
//    and the local cache serves repeats instantly).
export const baseQuery = fetchBaseQuery({
  baseUrl: Base_URL,
  credentials: 'include', // Send cookies with requests for authentication
  timeout: 15000,
});

export const apiSlice = createApi({
  baseQuery,
  tagTypes: [
    'Product',
    'User',
    'Order',
    'Vendor',
    'Settings',
    'Review',
    'Coupon',
    'Wishlist',
    'Return',
    'Notification',
    'Report',
    'Subscriber',
    'VendorStaff',
    'Messages',
    'Moderation',
    'Commission',
    'Campaign',
    'Certificate',
    'Addresses',
    'Category',
    'Designs',
    'PaymentMethods',
    'SupportTickets',
    'Contact',
    'OrderStats',
    'Promotion',
    'Products',
    'VendorProduct',
    'VendorAnalytics',
    'VendorReview',
    'VendorReturn',
    'VendorCoupon',
    'VendorOrder',
    'Suggestions',
  ],
  endpoints: () => ({}),
});

// How it works now:
// - JSON requests: Browser sets "application/json" automatically
// - File uploads: Browser sets "multipart/form-data; boundary=..." automatically
// - Form data: Browser sets "application/x-www-form-urlencoded" automatically