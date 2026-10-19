// FILE LOCATION: src/utils/pricing.js
// DESCRIPTION: Frontend re-export of the shared, single-source-of-truth pricing
//              rules (see shared/pricing.js). Kept as a thin passthrough so cart,
//              cart-drawer and checkout imports keep working unchanged.
export {
  DEFAULT_PLATFORM_FEE_RATE,
  round2,
  calcSubtotal,
  calcTax,
  calcCouponDiscount,
  calcOrderTotals,
  calcEscrowFees,
} from "../../shared/pricing";