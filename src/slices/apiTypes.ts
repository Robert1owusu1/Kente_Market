// Additional domain shapes used by the API slices (Redux ToolKit Query).
// These mirror the backend models/routes; heterogeneous admin payloads keep a
// permissive index so the app remains functional while core fields are typed.

export interface ApiMessage {
  message?: string;
  [key: string]: unknown;
}

export interface Address {
  id?: number | string;
  userId?: number | string;
  fullName?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  isDefault?: boolean;
  [key: string]: unknown;
}

export interface Design {
  id?: number | string;
  userId?: number | string;
  name?: string;
  image?: string;
  description?: string;
  isPublic?: boolean;
  createdAt?: string;
  [key: string]: unknown;
}

export interface PaymentMethod {
  id?: number | string;
  userId?: number | string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  isDefault?: boolean;
  [key: string]: unknown;
}

export interface Notification {
  id?: number | string;
  userId?: number | string;
  title?: string;
  message?: string;
  type?: string;
  read?: boolean;
  createdAt?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ReturnRequest {
  id?: number | string;
  orderId?: number | string;
  orderItemId?: number | string;
  productId?: number | string;
  userId?: number | string;
  vendorId?: number | string;
  reason?: string;
  details?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ReportItem {
  id?: number | string;
  reporterId?: number | string;
  targetType?: string;
  targetId?: number | string;
  reason?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Settings {
  key?: string;
  value?: string | number | boolean;
  [key: string]: unknown;
}

export interface Ticket {
  id?: number | string;
  userId?: number | string;
  subject?: string;
  message?: string;
  status?: string;
  priority?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Certificate {
  id?: number | string;
  orderId?: number | string;
  productId?: number | string;
  token?: string;
  serialNumber?: string;
  issuedTo?: string;
  status?: string;
  [key: string]: unknown;
}

export interface Campaign {
  id?: number | string;
  title?: string;
  description?: string;
  image?: string;
  discount?: number;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface CommissionRule {
  id?: number | string;
  productId?: number | string;
  vendorId?: number | string;
  category?: string;
  rate?: number;
  [key: string]: unknown;
}

export interface VendorStaff {
  id?: number | string;
  vendorId?: number | string;
  name?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export interface VendorMessage {
  id?: number | string;
  senderId?: number | string;
  recipientId?: number | string;
  vendorId?: number | string;
  subject?: string;
  body?: string;
  reply?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Vendor {
  id?: number | string;
  userId?: number | string;
  businessName?: string;
  businessEmail?: string;
  description?: string;
  logo?: string;
  banner?: string;
  status?: string;
  verificationLevel?: string;
  badge?: string[];
  rating?: number;
  totalProducts?: number;
  [key: string]: unknown;
}

// Vendor analytics/dashboard aggregates — heterogeneous admin shapes.
export interface VendorAnalytics {
  totalRevenue?: number;
  totalSales?: number;
  pendingPayout?: number;
  availableBalance?: number;
  totalProducts?: number;
  totalOrders?: number;
  [key: string]: any;
}

export interface DashboardStats {
  totalOrders?: number;
  totalRevenue?: number;
  totalProducts?: number;
  totalUsers?: number;
  totalVendors?: number;
  pendingOrders?: number;
  pendingProducts?: number;
  pendingReviews?: number;
  [key: string]: any;
}

export interface OrderStatistics {
  totalOrders?: number;
  totalRevenue?: number;
  [key: string]: any;
}

export interface Storefront {
  id?: number | string;
  businessName?: string;
  slug?: string;
  description?: string;
  logo?: string;
  banner?: string;
  status?: string;
  followers?: number;
  [key: string]: any;
}

export interface InventoryItem {
  id?: number | string;
  name?: string;
  stock?: number;
  price?: number | string;
  [key: string]: unknown;
}

export interface NotificationList {
  notifications?: Notification[];
  count?: number;
  [key: string]: unknown;
}