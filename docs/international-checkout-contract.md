# International Checkout — Integration Contract (integrated)

Owner: `fix/global-production-integration` (unifies `feature/global-production-checkout`,
`feature/global-production-shipping`, `feature/global-production-payments`).
Status: integrated, DB-backed, fail-closed. This document supersedes the
per-workstream contract drafts.

## Endpoints (mounted at `/api/checkout/international` in `backend/server.js`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/countries` | public | Supported destinations `{code,name,currency,phoneExample,zipLabel}[]` + `chargeCurrency: "GHS"` |
| GET | `/countries/:countryCode` | public | Per-country form config + `chargeCurrency: "GHS"` |
| POST | `/validate-address` | public | Full address validation → `{valid, normalized, currency, chargeCurrency}` or `400 {valid:false, errors}` |
| POST | `/shipping-options` | public | DB-backed rates `{supported,countryCode,currency,chargeCurrency,mock:false,options[]}`; `502 {supported:false}` when FX is unavailable |
| POST | `/vendor-eligibility` | `protect` | DB-backed `{eligible,vendors[]}` (fail-closed: missing row = not eligible) |

Supported destinations: GH/GB/US/CA/DE/NL only. Anything else → `UNSUPPORTED_DESTINATION` / `supported:false`.

## What is real and what is not (read before launch copy)

1. **Charge and settlement currency is always GHS.** Paystack initialization,
   verification (`verify-paystack`, webhook, stuck-order recovery, custom-request
   checkout) and transfers/recipients all enforce `CHARGED_CURRENCY === "GHS"`
   with exact equality. `currency` fields on shipping options (GBP/USD/CAD/EUR)
   are DISPLAY-ONLY estimates.
2. **Shipping rates are table rates, not live couriers.** `dhl/fedex/ups/ems`
   exist only as `shipping_carriers` rows; there is no carrier API call,
   tracking, label, or webhook integration. `apiConfig` is reserved, unread.
3. **No multi-currency charging, no instant settlement.** Cross-border delivery
   is collected in GHS; payouts go to GHS-capable accounts only (provider-side
   failure is the safe failure). Escrow/ledger behavior is unchanged.
4. **Mobile Money is Ghana-only.** International orders pay by card through the
   existing Paystack popup.
5. **Order totals are server-authoritative end to end.** `addOrderItems`
   resolves international shipping in GHS (per-vendor eligibility +
   `getChargeableShippingGHS`) and books it into `shippingCost`/`totalAmount`;
   `updateOrder` re-syncs shipping on pre-payment address changes and freezes
   the destination once a charge is initiated (`ADDRESS_CHANGE_AFTER_CHARGE`)
   or paid (`PAID_SNAPSHOT_IMMUTABLE`). Client totals are never trusted.
6. **FX is seeded manual data with fail-closed misses.** Missing/invalid rates
   refuse the quote (`502 SHIPPING_FX_UNAVAILABLE`); rates >90 days old emit a
   server log warning. Production should feed `exchange_rates` from a real
   source; seeds are documented estimates.

## Operator checklist (must be true in production)

- `npm run db:migrate --prefix backend` has run (creates `shipping_carriers`,
  `shipping_rates`, `vendor_shipping_destinations`, `exchange_rates` + order/
  address currency columns). Without these tables, international checkout
  returns `503 SHIPPING_TABLES_MISSING`; domestic GH checkout is unaffected.
- Vendors opt into each destination at `GET/POST/DELETE
  /api/vendors/shipping/destinations` (`manage_orders` permission). Only GH is
  backfilled; a vendor with no row for a country cannot sell there.
- `FRONTEND_URL`, `COOKIE_SAME_SITE`, `TRUST_PROXY`, `JWT_SECRET` set; Paystack
  live webhook endpoint configured (see `PRODUCTION_HARDENING_AUDIT.md` gates).

## Frontend contract

- `InternationalAddressForm` posts `countryCode` + address fields; checkout maps
  it onto the legacy order payload.
- Payment stays blocked for international home delivery until the
  shipping-eligibility lookup resolves `supported:true` (pending counts as
  blocked); failures show the server message inline.
- Pre-charge sync: the address is PUT to the order BEFORE the Paystack popup
  opens and the popup charges exactly the returned server total.
- Amount freeze: the baseline tracks the last server-confirmed total (order
  load, coupon apply, address sync); only silent moves block payment.
- Ghana default (`GH`) preserves the existing form and MoMo flow unchanged.
