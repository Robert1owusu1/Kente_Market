//export const Base_URL =
 //process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : '';
// Api origin. Left empty = same origin (frontend and API served together).
// Set VITE_API_URL to the backend origin when they are hosted separately
// (e.g. React on Vercel, API on Render). Endpoint paths below are appended.
export const Base_URL = import.meta.env.VITE_API_URL || '';
export const PRODUCTS_URL = '/api/products';
export const USERS_URL = '/api/users';
export const ORDERS_URL = '/api/orders';
export const CONTACT_URL = '/api/contact';
export const SUBSCRIBE_URL = '/api/subscribe';
export const REVIEWS_URL = '/api/reviews';
export const PROMOTIONS_URL = '/api/promotions';
export const COUPONS_URL = '/api/coupons';
export const WISHLIST_URL = '/api/wishlist';
export const RETURNS_URL = '/api/returns';
export const NOTIFICATIONS_URL = '/api/notifications';
export const REPORTS_URL = '/api/reports';
export const DESIGNS_URL = '/api/designs';
export const ADDRESSES_URL = '/api/addresses';
export const PAYMENT_METHODS_URL = '/api/payments/methods';
export const SUPPORT_URL = '/api/support';
export const CATEGORIES_URL = '/api/categories';
export const SUGGESTIONS_URL = '/api/suggestions';
export const CUSTOM_REQUESTS_URL = '/api/custom-requests';