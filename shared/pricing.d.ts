// Type declarations for shared/pricing.js — the single source of truth for all
// money math, consumed by both the TS frontend and the JS backend.

export interface OrderPricingListItem {
  price?: number | string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
}

export interface OrderTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  discount: number;
  total: number;
}

export interface EscrowFees {
  platformFee: number;
  payoutAmount: number;
}

export const TAX_RATE: number;
export const FREE_SHIPPING_THRESHOLD: number;
export const STANDARD_SHIPPING_COST: number;
export const DEFAULT_PLATFORM_FEE_RATE: number;

export function round2(n: number | string): number;
export function calcSubtotal(items: OrderPricingListItem[] | null | undefined): number;
export function calcTax(subtotal: number, rate?: number): number;
export function calcShipping(
  subtotal: number,
  threshold?: number,
  cost?: number
): number;
export function calcCouponDiscount(
  subtotal: number,
  discountType: string,
  discountValue: number | string
): number;
export function calcOrderTotals(
  items: OrderPricingListItem[] | null | undefined,
  options?: { discount?: number }
): OrderTotals;
export function calcEscrowFees(
  amount: number | string,
  feeRate: number | string | null | undefined,
  fallbackRate?: number
): EscrowFees;



// --- Order status metadata ---
export const STATUS_STEPS: string[];
export const STATUS_META: {
  pending: { label: string; color: string };
  quoted: { label: string; color: string };
  accepted: { label: string; color: string };
  paid: { label: string; color: string };
  in_progress: { label: string; color: string };
  completed: { label: string; color: string };
  cancelled: { label: string; color: string };
  declined: { label: string; color: string };
};
