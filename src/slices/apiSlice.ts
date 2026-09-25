import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { Base_URL } from '../constant';
import { getOrLoadCsrfToken, isSafeMethod, CSRF_HEADER } from '../utils/csrf';
import { handleUnauthorized } from '../utils/sessionExpiry';

// Custom fetch wrapper that:
//  - fails fast (a fetch does not reject on HTTP errors; timeout handled by
//    fetchBaseQuery below).
//  - echoes the signed double-submit CSRF token on state-changing requests
//    only (adding it to GETs would force a CORS preflight on every read).
// The token is fetched lazily from /api/auth/csrf-token (document.cookie can't
// see the host-only cookie set on the API origin) and cached in memory.
const baseFetch: typeof fetch = async (input, init) => {
  // fetchBaseQuery calls fetchFn with a constructed Request and no `init`.
  // Reading only init?.method therefore classified every RTK Query mutation as
  // GET and omitted the CSRF header once a session cookie existed.
  const request = input instanceof Request ? input : null;
  const method = (init?.method || request?.method || 'GET').toUpperCase();
  if (!isSafeMethod(method)) {
    const token = await getOrLoadCsrfToken();
    if (token) {
      // Preserve headers already attached to the Request (such as JSON
      // Content-Type) when fetchBaseQuery supplied the Request directly.
      const headers = new Headers(init?.headers || request?.headers);
      headers.set(CSRF_HEADER, token);
      init = { ...init, headers };
    }
  }
  const response = await fetch(input, init);
  // Global session-expiry handling: a 401 on any RTK Query call means the
  // cookie/JWT is gone — clear the local session (login/register attempts are
  // filtered out inside handleUnauthorized, which also dedupes 401 bursts).
  if (response.status === 401) {
    handleUnauthorized(request?.url || String(input), method);
  }
  return response;
};

export const baseQuery = fetchBaseQuery({
  baseUrl: Base_URL,
  credentials: 'include', // Send cookies with requests for authentication
  timeout: 15000,
  fetchFn: baseFetch,
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
    'CustomRequest',
    'Buyback',
    'Fulfilment',
    'VendorInsights',
  ],
  endpoints: () => ({}),
});

// How it works now:
// - JSON requests: Browser sets "application/json" automatically
// - File uploads: Browser sets "multipart/form-data; boundary=..." automatically
// - Form data: Browser sets "application/x-www-form-urlencoded" automatically
