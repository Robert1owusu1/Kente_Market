// Core domain types shared across the frontend (slices, components, pages).
// These mirror the backend response shapes (see backend/models and controllers).

export interface AuthUser {
  id?: number | string;
  _id?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  isAdmin?: boolean;
  isEmailVerified?: boolean;
  avatar?: string | null;
  profilePicture?: string | null;
  businessName?: string;
  createdAt?: string;
  created_at?: string;
  totalOrders?: number;
  totalSpent?: number;
  favoriteDesigns?: string[];
  [key: string]: unknown;
}

export interface Product {
  id: number | string;
  name?: string;
  title?: string;
  img?: string;
  images?: string[];
  price: number | string;
  originalPrice?: number | string;
  description?: string;
  category?: string;
  vendorId?: number | string;
  vendorBusinessName?: string;
  rating?: number;
  reviewsCount?: number;
  in_stock?: number | string;
  isActive?: boolean;
  featured?: boolean;
  isCustomizable?: boolean;
  fabricType?: string;
  patternName?: string;
  patternMeaning?: string;
  culturalSignificance?: string;
  colors?: string[];
  colorsAvailable?: string[];
  sizes?: string[];
  yards?: number | string;
  yardsAvailable?: number[] | string[];
  threadTypes?: string[];
  dominantThread?: string;
  material?: string;
  productionTime?: string;
  origin?: string;
  createdAt?: string;
  created_at?: string;
  approvalStatus?: string;
  approvalNote?: string;
  draft?: boolean;
  [key: string]: unknown;
}

export interface CartItem {
  product: number | string;
  productId?: number | string;
  name?: string;
  title?: string;
  img?: string;
  price: number | string;
  quantity: number;
  vendorId?: number | string;
  vendorBusinessName?: string;
  color?: string;
  size?: string;
}

// ⭐ Custom kente request lifecycle:
//   pending -> quoted -> accepted -> paid -> in_progress -> completed
//   quoted/cancelled & declined are dead-ends; admin marks adminReviewed=1
//   once they've followed up with the customer by phone.
export type CustomRequestStatus =
  | 'pending'
  | 'quoted'
  | 'accepted'
  | 'paid'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'declined';

export interface CustomRequest {
  id: number | string;
  customerId?: number | string;
  vendorId?: number | string;
  baseProductId?: number | string | null;
  baseProductTitle?: string | null;
  description?: string | null;
  yards?: number;
  colours?: string[];
  dominantColour?: string | null;
  threadTypes?: string[];
  dominantThread?: string | null;
  referenceImage?: string | null;
  neededForDate?: string | null;
  neededForTime?: string | null;
  status: CustomRequestStatus;
  vendorQuotePrice?: number | null;
  vendorCanMeet?: boolean | number;
  vendorMessage?: string | null;
  customerCancelReason?: string | null;
  orderId?: number | string | null;
  adminReviewed?: boolean | number;
  createRequest?: string;
  createdAt?: string;
  created_at?: string;
  vendorBusinessName?: string;
  vendorStatus?: string;
  customerName?: string;
  customerEmail?: string;
  [key: string]: unknown;
}

export interface CustomRequestStats {
  total?: number;
  avgQuote?: number;
  unreviewed?: number;
  paid?: number;
  statusCounts?: Record<string, number>;
  topCancelReasons?: { customerCancelReason: string; count: number }[];
  [key: string]: unknown;
}

export interface OrderItem {
  productId?: number | string;
  product?: number | string;
  name?: string;
  title?: string;
  img?: string;
  price: number | string;
  quantity?: number;
  qty?: number;
  vendorId?: number | string;
  vendorBusinessName?: string;
}

export interface Order {
  id: number | string;
  orderNumber?: string;
  userId?: number | string;
  items?: OrderItem[];
  totalAmount: number | string;
  subtotal?: number | string;
  tax?: number | string;
  shippingCost?: number | string;
  discount?: number | string;
  paymentStatus?: string;
  orderStatus?: string;
  paymentMethod?: string;
  shippingAddress?: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  createdAt?: string;
  created_at?: string;
  couponId?: number | string | null;
  [key: string]: unknown;
}

export interface Category {
  id?: number | string;
  name: string;
  icon?: string;
  description?: string;
  image?: string;
}

export interface Review {
  id?: number | string;
  productId?: number | string;
  userId?: number | string;
  userName?: string;
  rating: number;
  comment?: string;
  title?: string;
  createdAt?: string;
  created_at?: string;
}

export interface Coupon {
  id?: number | string;
  code: string;
  discountType?: 'percentage' | 'fixed' | string;
  discountValue?: number | string;
  isActive?: boolean;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface WishlistItem {
  id?: number | string;
  productId?: number | string;
  product?: Product;
  userId?: number | string;
}

export interface DashboardStat {
  totalOrders?: number;
  totalRevenue?: number;
  totalProducts?: number;
  totalUsers?: number;
  totalVendors?: number;
  pendingOrders?: number;
  pendingReviews?: number;
  pendingReturns?: number;
  [key: string]: unknown;
}

/** API envelope used by most list endpoints: { products, page, pages, ... }. */
export interface Paginated<T> {
  docs?: T[];
  products?: T[];
  orders?: T[];
  items?: T[];
  users?: T[];
  page?: number;
  pages?: number;
  total?: number;
  count?: number;
  totalPages?: number;
}

/** Form validation-error bag indexed by field name. */
export interface FormErrors {
  [key: string]: string | undefined;
}

/** Loose keyed object for heterogeneous form state. */
export interface KeyedState<K extends string = string, V = unknown> {
  [key: string]: V;
}