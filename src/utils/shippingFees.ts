// utils/shippingFees.ts
// Display helpers for delivery fees (components/Shipping/ShippingFeesEditor).
import type { ShippingRate } from "../slices/shippingFeesApiSlice";

export const formatFee = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-GH", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

export const describeRate = (r: ShippingRate) =>
  `${formatFee(r.baseCost, r.currency)}${r.freeThreshold !== null ? `, free over ${formatFee(r.freeThreshold, r.currency)}` : ""} · ${r.transitDaysMin}–${r.transitDaysMax} days · ${r.carrierName}`;
