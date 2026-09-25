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
export interface VendorAnalyticsSliceRow {
  name: string;
  value: number;
}

export interface VendorSalesChartPoint {
  month: string;
  sales: number;
  orders?: number;
}

export interface VendorTopProduct {
  name: string;
  quantity: number;
  revenue: number;
}

export interface VendorWallet {
  available_balance?: number;
  total_earned?: number;
  [key: string]: unknown;
}

export interface VendorAnalytics {
  // Fields the overview/analytics screens dereference directly (arrays are
  // required: both screens iterate them without a guard, so a missing payload
  // is a hard failure we want the type to surface, not hide).
  totalRevenue: number;
  avgOrderValue: number;
  totalOrders: number;
  totalProducts: number;
  ordersByStatus: VendorAnalyticsSliceRow[];
  salesChartData: VendorSalesChartPoint[];
  topProducts: VendorTopProduct[];
  // Remaining aggregates are optional/heterogeneous.
  totalSales?: number;
  pendingPayout?: number;
  availableBalance?: number;
  pendingOrders?: number;
  processingOrders?: number;
  deliveredOrders?: number;
  cancelledOrders?: number;
  wallet?: VendorWallet;
  [key: string]: unknown;
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
  // Moderation queue counters (GET /api/moderation/stats).
  pending?: number;
  approved?: number;
  rejected?: number;
  changes_requested?: number;
  [key: string]: unknown;
}

export interface OrderStatistics {
  totalOrders?: number;
  totalRevenue?: number;
  [key: string]: unknown;
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
  [key: string]: unknown;
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