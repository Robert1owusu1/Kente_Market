# Commission System — Completion Report

Session `566deb7e`, 2026-10-12. Local only: nothing committed, deployed, or run against TiDB / live Paystack.
Tracker rows: `LOCAL_SECURITY_AND_BUG_TRACKER.md` (COM-*). Earlier references: D-1, D-2 in `PRODUCTION_READINESS_TRACKER.md`.

## 1. Verdict

**The platform-commission engine is complete and consistent for what the code implements** (one platform
commission per vendor line, configurable by product / vendor / category / global rules).
**The commission *business model* is not complete**: the ambassador/referral share does not exist in the code,
and the advertised 12 % is not what the system charges today. Those need your decisions (§6) before go-live.

## 2. What the code actually does (after this session)

### 2.1 Rate resolution — per order line

```
active product rule  >  active vendor rule  >  active category rule  >  active global rule
   >  vendors.platformFeeRate  >  PLATFORM_FEE_RATE env (default 0.10)
```
Within one scope: higher `priority`, then newest `id`. Hard cap 0–50 %. Inactive rules are ignored.
A fresh install seeds **one global rule at 10 %**, so the last two fallbacks only apply if every global
rule is deactivated or deleted.

One function (`commissionService.buildEscrowAllocationRows`) is used by **both** checkout paths:
standard checkout (`escrowService.createEscrowAllocations`, also used by the pre-payment coupon
re-allocation) and custom-order checkout (`customRequestController.checkoutRequest`).

### 2.2 Accounting per order

| Quantity | Definition |
|---|---|
| Product subtotal | Σ price × qty, re-priced from the DB (client prices ignored) |
| Discount | coupon, server-computed, capped at subtotal |
| Tax | 15 % of subtotal (`shared/pricing.js`) — **kept by the platform** |
| Shipping | flat/lane rate — **kept by the platform** |
| Customer pays | subtotal + tax + shipping − discount (GHS only) |
| **Commission base** (per vendor) | vendor's goods gross × (1 − discount / order goods gross) — the discount is spread pro rata over every line, including platform-owned lines |
| Platform commission | round2(base × line-weighted rate); with one rate this is exactly round2(base × rate) |
| Seller proceeds | base − commission (frozen on the allocation at checkout) |
| Platform revenue | commission on vendor lines + discounted value of platform-owned lines (`platform_revenue`) + tax + shipping − Paystack processing fees (fees not modelled — §6) |
| Paystack fee | not deducted from anyone in code; the platform absorbs it |
| Referral commission | **not implemented** |

Money uses `round2` (half away from zero, pesewas) everywhere; every allocation satisfies
`platformFee + payoutAmount = amount` to the pesewa (tested).

### 2.3 Worked examples (each is asserted in `backend/tests/commissionEngine.test.js`)

| Case | Inputs | Result |
|---|---|---|
| Single rate | 2 × 100, 10 % | amount 200, fee 20, seller 180 |
| Mixed product rates, one vendor | 100 @ 15 % + 300 @ 5 % | fee 15 + 15 = **30**, seller 370 (old code: 400 × first line's rate) |
| Coupon on mixed order | vendor 400 (as above) + platform item 100, coupon 50 | factor 0.9 → vendor base 360, fee 27, seller 333 |
| Two vendors + coupon | V1 3 × 100 @ 10 %, V2 2 × 100 @ 8 %, coupon 50 | V1 270 / 27 / 243; V2 180 / 14.40 / 165.60; seller + commission + discount = 500 |
| Category rule | 2 × 100 in a category at 12 % | fee 24 (old code: category never applied → 20) |
| Rounding | 3 × 33.33 @ 12.5 % | amount 99.99, fee 12.50, seller 87.49 |
| Custom order, 50 % advance | quote 500, 10 % | advance 250 / 25 / 225 credited at payment; balance 250 / 25 / 225 held |
| Rule changed after checkout | order at 10 %, admin raises to 25 % | release still credits 90 of 100 |

### 2.4 Refunds and cancellations

| Event | Commission effect | Test |
|---|---|---|
| Full cancel / full refund / approved full return | every pending/held allocation → `failed`; `available` ones clawed back from the wallet exactly once; commission on `failed` rows is not earned → **0** | `commissionEngine.test.js` (refund reversal), `escrowCancellationRefund.test.js` |
| Per-vendor partial refund | only that vendor's allocations voided/clawed back; other vendors untouched | same + `partialRefunds.test.js` |
| Platform-product revenue | negated `refund` row in `platform_revenue` (FV-8) | `recoveryFairness.test.js` |
| Payout already sent (`releasing`/`released`) | **not** reversed automatically — manual recovery (R-6/R-7 limitation) | documented |
| Partial refund amount | vendor's discounted goods only; no tax/shipping share (FV-9 decision) | `finalVerificationRaces.test.js` FV-3 |

Duplicate webhooks/concurrency: allocations are created at checkout (`INSERT IGNORE`, unique
`(orderId, vendorId, allocationType)`), never by the webhook, so duplicate or out-of-order payment events
cannot create a second commission. Release, void and clawback serialize on the allocation row lock and a
unique wallet-ledger row (existing suites: `paidSideEffects`, `withdrawalConcurrency`, `payoutLifecycle`, `rb02-escrow-retry`).

### 2.5 Admin controls

- `GET/POST/PUT/DELETE /api/admin/commissions` — `protect` + `admin` only (vendors/staff cannot reach them).
- Server-side validation: strict rate (`0`–`0.5`, ≤ 4 dp; `"0.1abc"`, `12`, `1e-1` rejected), vendor and
  product targets must exist, category targets must be a known category, scope/target re-validated together on update.
- Every create/update/delete writes `admin_audit_log` with the full before/after rule.
- **Effective time and scope:** a change applies to orders whose escrow is allocated after it (checkout, or a
  coupon applied before payment). The fee is frozen on each allocation; release uses that frozen fee, so a
  change never rewrites past orders or vendor balances.
- There is no scheduled ("effective from") rule and no per-rule history table beyond the audit log.

## 3. Defects found and fixed

| ID | Defect | Fix | Evidence |
|---|---|---|---|
| COM-1 | Admin UI posted `target`; API needs `targetId` → every non-global rule creation failed (400); list showed "—" | UI sends/shows `targetId`; rate step 0.0001 | `CommissionsPage.test.tsx` 2/2, mutation-verified |
| COM-2 | Category rules never applied (product `category` not selected) — was D-1 | category selected and passed per line | `commissionEngine.test.js`, mutation-verified |
| COM-3 | One rate per vendor taken from the vendor's first product | per-line rate, line-weighted fee | mutation-verified (3 tests fail) |
| COM-4 | Custom request without a base product → no allocation → weaver never paid — was D-2 | shared builder uses the line's vendor | `customRequestCheckoutHandler.test.js`, mutation-verified |
| COM-5 | Release recomputed the fee from the 4-dp stored rate | release uses the frozen fee (`allocationFees`) | mutation-verified (2 tests fail) |
| COM-6 | Loose admin validation; audit `before` was `{id}` | strict parsing, existence checks, full audit | `commissionEngine.test.js` |
| COM-7 | Vendor settings showed `vendors.platformFeeRate`, which the seeded global rule shadows | `/api/vendors/me` returns the engine's rate; UI shows it | typecheck + manual review (no UI test) |

`escrow_allocations.platformFeeRate` is now informational when a vendor has lines at different rates
(line-weighted, 4 dp); `platformFee` is authoritative. Existing rows are unaffected: all current code wrote
`platformFee = round2(amount × rate)`, which is what release used to recompute.

## 4. Tests

New: `backend/tests/commissionEngine.test.js` (22 tests), `customRequestCheckoutHandler.test.js` +1,
`src/Pages/adminDashboardPages/Commissions/__tests__/CommissionsPage.test.tsx` (2). Coverage of the
requested list: precedence ✓, global fallback ✓ (rolled-back transaction), category ✓, vendor ✓, product ✓,
discounts/coupons ✓, refunds ✓, partial refunds ✓, seller proceeds ✓, platform revenue (seller + commission +
discount = gross) ✓, currency/rounding ✓, admin changes ✓, historical stability ✓; duplicate webhooks and
concurrency rely on the existing suites listed in §2.4. **Referral eligibility: not testable — no feature.**

## 5. Discrepancies with the stated business intent

| Intent you described | Code today |
|---|---|
| Advertised total commission 12 % | Seeded global rule is **10 %**; `PLATFORM_FEE_RATE` default 10 %; `vendors.platformFeeRate` default 10 % |
| 8 % platform + 4 % ambassador | No ambassador/referral attribution, tables, eligibility, payout or reversal anywhere |
| Vendor-specific rates | Via vendor rules (works). `vendors.platformFeeRate` is a legacy column, reached only without a global rule |
| Category-specific rates | Now applied (was dead) |

## 6. Business decisions required (not invented)

1. **Headline rate**: keep 10 % or set the global rule to 12 %? (One admin action; applies to new orders only.)
2. **Ambassador/referral programme**: if wanted, define: who can be an ambassador; how attribution happens
   (link, code, vendor recruited by ambassador?); whether the 4 % is carved out of the 12 % (platform keeps 8 %)
   or added on top; eligibility window; whether it applies on discounted value; when it becomes payable
   (after escrow release?); reversal on refund; payout method. Building it is a new feature with its own
   ledger, migration and tests — not started.
3. **Shipping money**: escrow pays vendors goods only; shipping charged to the customer stays with the
   platform. Correct only if the platform pays the courier. If vendors ship, they are under-paid.
4. **VAT (15 %)**: collected and kept by the platform; confirm the platform is the party that remits it.
5. **Paystack processing fees**: absorbed by the platform from its commission; confirm, or decide whether
   sellers share them.
6. **Partial refunds (FV-9)**: whether a share of tax/shipping is refunded with a vendor's lines.
7. **Refund after a payout was sent** (R-6/R-7): recover from the vendor's future earnings, or platform loss?
8. **Retire `vendors.platformFeeRate`?** It is shown in the admin vendor list but has no effect while a global rule exists.

## 7. Update — owner decisions applied (2026-10-12, later in the same session)

The owner answered §6 items 1–2 and the coupon/referral questions (`REFERRAL_SYSTEM_DESIGN.md` §9, verbatim).
This **changes** parts of §2.2 above (kept for history):

| Before (§2.2) | Now |
|---|---|
| Any coupon split pro rata over all lines; seller and platform both absorb it | **Admin coupon** → platform absorbs it (split across items by platform commission); seller gets `P − F`. **Seller coupon** → seller absorbs it; platform keeps `F`. |
| Commission base = goods after discount | Platform commission `F = P × r` on the seller's **list** price |
| No caps on coupons vs commission | Admin coupon ≤ platform commission (save-time against the global rule; checkout per item); seller coupon ≤ seller proceeds |
| No referral | Referral = `min(rate × P, F − Da)` per line, platform-funded — see the design doc |
| Partial refund = gross × discount factor | What the customer paid for the vendor's lines, from the frozen `orders.commissionSnapshot` (legacy orders keep the old formula) |

Owner examples (GH₵1,000 item, 20 % platform, 4 % referral): admin coupon 10 % → customer 900, seller 800,
platform 60; seller coupon 10 % → customer 900, seller 700, platform 160 (after the 40 referral). Asserted in
`commissionEngine.test.js` and `referralSystem.test.js`.

Still open from §6: the headline rate (the system still seeds 10 %; set the global rule in Admin →
Commissions), shipping/VAT/Paystack-fee ownership (items 3–5), FV-9, refunds after payout (item 7).
