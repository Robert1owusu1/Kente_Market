# International Checkout — Coordination Contract (checkout workstream)

Owner: `feature/global-production-checkout`. Integration target: `feature/global-production`.

## Endpoints (implemented, mounted at `/api/checkout/international` in `backend/server.js`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/countries` | public | Supported destinations `{code,name,currency,phoneExample,zipLabel}[]` + `chargeCurrency: "GHS"` |
| GET | `/countries/:countryCode` | public | Per-country form config (required/optional fields, phone/zip patterns, regions) |
| POST | `/validate-address` | public | Full address validation → `{valid, normalized, currency, chargeCurrency}` or `400 {valid:false, errors}` |
| POST | `/shipping-options` | public | **MOCK** rates `{supported,countryCode,currency,chargeCurrency,mock:true,options[]}` |
| POST | `/vendor-eligibility` | `protect` | **Permissive mock** `{eligible:true,vendors[],mock:true}` |

## Assumptions (marked, not invented behavior)

1. **Charge currency is always GHS.** `currency` fields from these endpoints are
   DISPLAY-ONLY. No exchange rates exist anywhere in this workstream.
2. **Shipping rates are mocks.** `getShippingOptions` returns placeholder
   per-country standard rates. The shipping workstream replaces the internals of
   `getShippingOptions` + `checkVendorShippingEligibility` with real carrier
   rates and a `vendor_shipping_destinations` lookup. Response SHAPE is frozen.
3. **Vendor eligibility is permissive.** All vendors return `eligible:true`
   until the shipping workstream adds destination checks. Checkout blocks only
   on `supported:false` / unknown country.
4. **Mobile Money is Ghana-only.** International orders must use `card` through
   the existing Paystack popup. No new PSP is introduced here.
5. **Order totals stay server-authoritative.** `orderController.addOrderItems`
   recomputes via `shared/pricing.js`; client totals are never trusted.
   `updateOrder` rejects destination changes once `paymentStatus` is
   `paid`/`refunded` (`PAID_SNAPSHOT_IMMUTABLE`).

## Shared-file dependencies (coordinate before changing)

- `backend/controllers/orderController.js` — checkout adds destination gate only.
  Payments workstream: keep the `paid/refunded` conditional-flip guards.
- `backend/server.js` — one mount line only.
- `shared/pricing.js` — NOT touched (shipping workstream owns zone rates).
- `backend/Services/paystackservices.js`, `routes/paymentRoutes.js`,
  escrow/refund services — NOT touched (payments workstream owns).

## Frontend contract

- `InternationalAddressForm` posts `countryCode` + `addressLine1/city/region/postalCode`;
  checkout maps it onto the legacy order payload (`address`, `countryCode`).
- Payment-amount freeze: first finite `payableTotal` is captured in
  `initialPayableRef`; any change blocks `payWithPaystack` until refresh.
- Ghana default (`GH`) preserves the existing form and MoMo flow unchanged.
