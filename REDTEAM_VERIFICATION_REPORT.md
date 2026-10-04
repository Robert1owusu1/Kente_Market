# Kente Market — Red-Team Re-Verification Report (Round 2)

**Date:** 2026-10-03
**Target:** working tree @ `d98d52c` + uncommitted changes (repo has been patched since Round 1)
**Method:** line-by-line source re-verification (direct reads + independent parallel streams), Express 5.2.1 param-decode probe, DB-backed test suites executed (`vendorIsolation`, `tracking`, `partialRefunds`, `refundGuard`, `refundRestore`, `refundReconcile` → 28/28 pass). No live exploitation of production.
**Environment notes:** (a) `npm run db:migrate` was run during verification and crashed mid-chain (see N-5); (b) `backend/.env` contains a live `REDIS_URL` (Upstash), so Redis-backed limiters are active.

**Status legend:** CONFIRMED / PARTIALLY CONFIRMED / FALSE POSITIVE / UNVERIFIED.

---

## 1. Status of every prior finding (verified against CURRENT code)

| Prior ID | Prior claim | Status | Evidence (file:line) |
|---|---|---|---|
| C-1 (CRITICAL) | Cross-vendor coupon abuse | **PARTIALLY CONFIRMED** (core chain broken; residuals remain) | Vendor scope enforced: `couponModel.js:197-212` (vendor coupon valid only if ALL cart lines == issuing vendor), `orderController.js:397-405` passes `cartVendorIds` at placement; platform-coupon leak fixed (`vendorController.js:746` `WHERE vendorId = ?`, no `OR vendorId IS NULL`); pro-rata `netFactor` retained deliberately (`escrowService.js:156-167`). Residuals: pending-applicant role (C5) + platform coupons still discount vendors pro-rata (N-7) |
| H-1 | Coupon maxUses race | **PARTIALLY CONFIRMED** | Deferred consumption retained by design: validate at creation (`orderController.js:393-405`, `:457-459`), `incrementUses` only at payment (`paymentRoutes.js:186-193`, `:423-434`; `escrowService.js:258-286`). Conditional increment prevents counter overflow, race losers are **journaled + admin-notified but the discount is still honoured** — own comment: "the order already carries the discount and cannot be re-charged in-flow" |
| H-2 | Coupon/payment amount mismatch | **CONFIRMED** | `CartPage.tsx:247` creates order `discount:0` (gross) → `checkout.tsx:206-209` `resolvePayableTotal(serverTotal, local)` prefers gross server total → charge (`:470`) happens in `payWithPaystack`, **before** the coupon PUT (`handlePaystackSuccess` `:534-591`, coupon at `:576`) → server recomputes net (`orderController.js:663-696`) → verify/webhook demand exact kobo match (`paymentRoutes.js:140-147`, `:337-346`) |
| H-3 | Product moderation bypass | **FALSE POSITIVE (fixed)** | `productController.js:12` `publicApprovalFilter` used at `:55,142,163,185,318`; detail gate `:105`; checkout rejects non-approved (`orderController.js:323`); `productModeration.test.js` asserts both |
| H-4 | Cross-vendor file deletion | **CONFIRMED** | `uploadRoute.js:112-143` (`:119` ownership on RAW param via `split('-',1)[0]`, `:126` `path.basename` for deletion) and `:191-209` (no role gate at all). Express 5.2.1 decodes `%2F` in route params (empirically: `7-x%2F..%2F8-product-u.jpg` → param `7-x/../8-product-u.jpg`, owner `7`, basename `8-product-u.jpg`) |
| H-5 | Email verification / OAuth takeover | **FALSE POSITIVE (fixed)** | `usersModel.js:329-376` resets `is_email_verified = FALSE` on any email change (model-level, all callers) + bumps `tv`; `passPort.js` adopt/link hardened; `authHardening.test.js` covers it |
| H-6 | Stock reservation leak | **CONFIRMED** | `orderController.js:355-363` returns 400 inside `try` without restoring; `reservationService.js:35-61` deducts line-by-line and continues after failure; no order row ⇒ `releaseExpiredReservations` (sweeps `orders` only) never recovers it; deterministic via duplicate line items (per-line pre-check `orderController.js:331-340`) |
| H-7 | Cross-vendor fulfillment/escrow manipulation | **FALSE POSITIVE (fixed), with V2 residual** | 403 gate `vendorOrderController.js:308` (`orderHasVendorItem`), per-vendor marks `order_vendor_marks`, consensus = slowest vendor (`:407-413`), escrow armed only on consensus `delivered` (`:433-446`); per-vendor release via `confirm-received?vendorId`. Residual: forward skips allowed (V2) |
| M-1 | OTP / rate-limit problems | **PARTIALLY CONFIRMED** | `userRoutes.js:67-71` verify+resend behind `authLimiter` (5/15 min, IP-only); per-account OTP counter `usersModel.js:553,578-585` (5 attempts, reset on each new OTP); OTP 6-digit (`emailService.js:103`); Redis store active (`rateLimitMiddleware.js:16-18`, `REDIS_URL` set). Residuals: per-IP resend keying (inbox flooding from rotating IPs), attempts reset on resend |
| M-2 | Rate-limit store not durable | **FALSE POSITIVE (fixed)** | `rateLimitMiddleware.js:16-18` `createRateLimitStore(prefix)` on every limiter; commit `d98d52c` fixed the crash; `REDIS_URL` present in `backend/.env`. Fallback = memory store when unset (single-instance Render ⇒ acceptable) |
| M-3 | OAuth state missing | **CONFIRMED** | `authRoutes.js:106-142` — no `state` issued/validated anywhere (`grep state` → no matches in authRoutes/passPort); consent token is transferable, mintable (`:39-53`), not browser-bound (`:23-24`) |
| M-4 | Password-reset enumeration | **PARTIALLY CONFIRMED** | Two distinct 200 bodies `userController.js:213-232` + timing delta; GET token oracle `:308-326` returns `valid:true/false` — but now rate-limited 3/h/IP (`rateLimitMiddleware.js:160-168`); token = `crypto.randomBytes(32)` SHA-256 (`usersModel.js:658-678`) |
| M-5 | Dependency advisory | **PARTIALLY CONFIRMED** | backend `npm audit --omit=dev` = **0 vulnerabilities**; frontend = **6 high** (`axios 1.0.0–1.19.0` + `braces`/micromatch/fast-glob/chokidar DoS chain), both with fixes available |
| M-6 | Email HTML injection / phishing | **PARTIALLY CONFIRMED** | Raw interpolation: `emailService.js:149,217,289,375,428` (`firstName`,`name`), `orderEmailService.js:101-102,134,182,215` (address fields), client-supplied item `name` persisted (`orderController.js:369` `r.name \|\| p.title`). Mostly self-impacting (recipient = input owner); no escaping helper anywhere |
| M-7 | Price validation weak | **PARTIALLY CONFIRMED** | No `price > 0`/bounds in `middleware/validators.js` or vendor product handlers; exploitability neutralised: totals recomputed from DB (`orderController.js:371,386`), payment blocks `<=0` (`checkout.tsx:456-458`, `toPesewas` → 0) |
| M-8 | Weak Zod coverage | **PARTIALLY CONFIRMED** | Only **2** `validate(` mounts vs **31** POST/PUT/PATCH route definitions; money paths recompute server-side so no live hole found, but new endpoints ship without schema validation |
| M-9 | Stale escrow after coupon update | **FALSE POSITIVE (fixed)** | `orderController.js:712-729` — PUT path calls `reallocateOrderEscrow`; on failure returns **409** "realloc failed … re-run before payment" |
| M-10 | Refund race conditions | **PARTIALLY CONFIRMED** | Per-return state machine is atomic (`returnModel.js:122-151`: conditional `UPDATE … AND status = ?`, throws on 0 rows) ⇒ double-approve of one return blocked. Residuals: refund-marker writes ignore `affectedRows` (`returnController.js:303-310`, `orderController.js:1082-1094`), cross-path dedupe keys differ (`refund:${id}` vs `refund:${id}:${returnId}…`), `refundedAmount` check-then-act (`returnController.js:160-163,276-279`). Effective backstop = Paystack's remaining-refundable cap, not our code |
| M-11 | Coupon oracle | **PARTIALLY CONFIRMED** | Distinct messages per state (`couponModel.js:173-210`), `minPurchase` echoed; mitigated: `couponValidateLimiter` (`couponRoutes.js:13`) + `toPublic()` strips internals (`couponModel.js:229-242`) |
| M-12 | AI/payment abuse limits | **FALSE POSITIVE (largely fixed)** | Try-on: https-only, private/metadata/IPv6 blocked, `data:image` only with 5 MB cap, validate-before-credit, `AI_TRYON_DAILY_LIMIT` per user, `apiLimiter` (`tryOnController.js:112-182`) |
| M-13 | (subsumed by M-12) | — | — |

### New findings surfaced in Round 2
| ID | Finding | Severity |
|---|---|---|
| N-1 | `verify-paystack` builds an outbound URL from unencoded `reference` → same-host path injection with `PAYSTACK_SECRET_KEY` (`paymentRoutes.js:102-106`; also `escrowService.js:1151`) | Medium |
| N-2 | `authRoutes.js:175` `if (!decoded.tv …)` rejects legitimate `tv=0` users → OAuth exchange broken for `tokenVersion=0` accounts (availability, fail-closed) | Low |
| N-3 | Public unauthenticated `/metrics` (`server.js:338-339`) — Prometheus route/status/latency + node runtime metrics; no PII, reveals traffic/endpoint inventory | Low |
| N-4 | Vendor status write mirrors `productionNote` onto the shared order row (`vendorOrderController.js:423-425`) → Vendor A overwrites Vendor B's customer-visible note ("Action A changes Resource B") | Low |
| N-5 | `npm run db:migrate` crashes mid-chain (order-items backfill) leaving partial schema — ops/reliability, discovered during verification | Low (ops) |
| N-6 | Suspended/unapproved vendors' products are never unpublished: public product queries filter only `p.approvalStatus`, never `v.status` (`productModel.js:177-186`; `updateVendorStatus` `vendorController.js:164-211` only flips status + role) → suspension is not an effective takedown | Medium |
| N-7 | Platform (vendorId NULL) coupons discount every vendor pro-rata (`escrowService.js:156-167`) — vendors fund platform marketing by design; worth an explicit policy decision | Info |

---

## 2. Attack attempts by identity (authorization boundary matrix)

| # | Identity | Reachable worst actions (verified) | Verdict |
|---|---|---|---|
| 1 | Anonymous | Reset-enumeration (M-4), register enum via status code (M-5/A5), OAuth login-CSRF via link (M-3), coupon oracle at 15/min (M-11), `/metrics` (N-3), unapproved-product detail blocked (`productController.js:105`) | No money/data path |
| 2 | Normal customer | H-2 coupon overcharge/stuck order; I1 inventory destruction (verified email only); I2 stock inflation window (needs server error); A5 account-lockout DoS against any email; M-6 self email-HTML; `DELETE /api/upload/reference/:filename` → **any user's reference images** (F1) | F1 + I1 + H-2 are the material ones |
| 3 | Approved vendor | Own-scope only: orders/customers/coupons/reviews/withdraw all `WHERE vendorId = ?` or `req.user.id`; bare `PUT /profile` + `GET /reviews` without permission (A8); 50% coupon cap enforced (`vendorController.js:777-779`); `stock:-5` self-own only (I3) | Cross-tenant blocked |
| 4 | Unapproved applicant | `role='vendor'` granted at apply (`vendorController.js:115`); owner branch of `vendorOrStaff` checks role only (`authMiddleware.js:173-194`). **But** product create `:283-284`, staff create, withdraw `:1041-1043`, custom-request intake all require `status='approved'`; admin status change demotes role (`:204-205`). Reachable: coupon create (useless without products), bare profile/reviews | PARTIAL, low impact |
| 5 | Vendor staff | Permission-gated (`requireVendorPermission`); exceptions: bare `PUT /profile`, `GET /reviews` (A8). Staff of unapproved vendor blocked (`authMiddleware.js:215`). Cross-vendor reach: none found | Low gap |
| 6 | Vendor A → Vendor B | Orders list scoped (`vendorOrderController.js:158-209`), no unscoped detail route exists; reviews `WHERE p.vendorId` (`vendorController.js:623`); coupons `WHERE vendorId = ?`; fulfilment 403 + consensus; escrow/wallet `req.user.id`; **images: F1 delete**; stock: own-SET only; `getVendorInsights` = platform aggregate by design (`:1199-1215`) | F1 only |
| 7 | Customer → vendor | Reviews/returns/messages go through moderation + scoping; cannot touch vendor stock/escrow; can destroy vendor stock via I1 | I1 |
| 8 | Compromised vendor account | Blast radius = own tenant + F1 cross-tenant image delete + bare-profile staff routes; withdraw gated to own wallet, approved status, allocation CAS | Bounded |
| 9 | Compromised admin | Full monetary authority by design (money fields admin-only: `orderController.js:603-655`); admin percentage coupons uncapped → negative `totalAmount` rows possible (C2) — but payment guard blocks paying ≤0 | By design; audit-log recommendation |

### Money attacks — verdicts
- **Coupon abuse (cross-vendor):** FIXED (scope) — FP for the original critical chain.
- **Coupon reuse / maxUses race:** LIVE (H-1/C3) — discount granted beyond cap; journaled, not prevented.
- **Negative discounts:** blocked (`calcCouponDiscount` clamps ≥0, `shared/pricing.js:59-65`) — FP.
- **>100% discounts:** vendor capped 50% (`vendorController.js:777-779`); admin % uncapped (C2) but `toPesewas(<=0)=0` and checkout `payable<=0` guard prevent paying a negative/near-zero total — PARTIAL (integrity only).
- **Payment amount manipulation:** FIXED — totals recomputed (`orderController.js:386,696`), exact-kobo check, ownership check, reference UNIQUE + one-time attach (`:435-452`, `:631-654`) — FP.
- **Webhook replay / duplicate webhook:** FIXED — HMAC over rawBody, `webhook_events` claim, CAS flip `paymentStatus != 'paid'` + `affectedRows` gates side effects (`paymentRoutes.js:153-164`, `:383-434`) — FP.
- **Payment verification race:** FIXED — same CAS + already-paid short-circuit (`:441-447`) — FP.
- **Refund race:** PARTIAL — per-return CAS good; cross-path (return vs cancel) marker unchecked; Paystack cap is the real guard (M-10).
- **Escrow release race:** FIXED — `releaseAllocation` CAS `held→available` + `affectedRows` + wallet ledger unique key + revert-on-failure (`escrowService.js:311-340`) — FP.
- **Payout duplication:** FIXED — `payoutAllocation` claims in a transaction `WHERE status='available' AND payoutAmount >= ?` and persists the provider idempotency key **before** the network call (`escrowService.js:395-404`); wallet debited only by signed `transfer.success` — FP (the initial balance pre-check is check-then-act but harmless).
- **Vendor allocation manipulation:** FP — allocations re-priced from DB rows (`escrowService.js:134-153`), `items` stripped from owner PUT (`orderController.js:607`), realloc on discount change (`:712-729`).
- **Order total manipulation:** FP — server recomputation + PUT whitelist (`:603-622`).

### Inventory attacks — verdicts
Race conditions: conditional `stock >= ?` everywhere (reserve/payment) — FP. Failed reservations: **I1 CONFIRMED**. Concurrent checkout: FP (atomic conditional UPDATE). Reservation expiry: FP (sweeper transactional, paid-check). Cancellation: FP (additive restore, paid/refunded gated). Refund restore: FP (`refundRestore.test.js` passes; skips payment-time conflicts). Duplicate restore: **I2 PARTIAL** (post-`Order.create` exception window). Made-to-order: exempt by design (`madeToOrder = FALSE` guards). Negative stock: **I3 PARTIAL** — no conditional path can go negative; only absolute `SET stock = ?` writes accept negatives (no CHECK constraint).

### Business-logic "Action A changes Resource B" hits
1. Charge (A) then apply coupon (B) → books diverge (**H-2**).
2. Approve/pay (A) beyond cap (B) → discount funded without a use slot (**C3**).
3. Attempt own order (A) → other products' stock destroyed (**I1**).
4. Staff logout (A) → unrelated user's session revoked (**A4**).
5. Vendor A writes progress note (A) → Vendor B's shared note overwritten (**N-4**).
6. Suspend vendor (A) → products stay live (**N-6**).
7. Apply for vendorship (A) → instant `vendor` role (B) (**C5**).

---

## 3. Confirmed vulnerabilities — full detail

### V-01 | Coupon charged gross, order recorded net (checkout money divergence)
- **Severity:** High (financial integrity / consumer harm — pilot blocker)
- **Attacker role:** N/A for profit — any customer using the coupon UI; exploitable for support-fraud ("I was charged but no order") and creates systematic overcharge.
- **Precondition:** Coupon applied in checkout UI; pre-created order loaded (normal flow).
- **Endpoint/file/function:** `POST /api/paystack/initialize` + `payWithPaystack` (`src/Pages/CheckoutPage/checkout.tsx:441-519`), `handlePaystackSuccess` (`:522-640`, coupon PUT `:576,591`), `PUT /api/orders/:id` (`backend/controllers/orderController.js:663-696`), `verify-paystack`/webhook (`backend/routes/paymentRoutes.js:140-147,337-346`).
- **Attack sequence:** 1) CartPage creates order `discount:0` (gross, `CartPage.tsx:247`). 2) Checkout applies coupon client-side only (`checkout.tsx:219-244`). 3) `resolvePayableTotal(serverTotal, local)` prefers the gross server total (`:206-209` → `utils/payments.ts:14-15`). 4) Paystack charges gross (`:470`). 5) After success, PUT attaches `couponCode`; server recomputes net (`orderController.js:696`). 6a) If webhook arrived first: order already `paid` at gross → coupon PUT rejected (`:665`) → customer overcharged by the discount, UI showed discount applied; or 6b) if PUT first: verify/webhook see gross≠net → 400 amount mismatch → order stuck `pending` with money captured.
- **Business impact:** Every UI coupon checkout either overcharges the customer or strands a captured payment; support load, chargebacks, consumer-protection exposure. Real-money pilot cannot run with a broken coupon path.
- **Security impact:** Payment-verification invariant violated: "amount collected == amount booked == escrow basis".
- **Root cause:** The coupon is applied to the order *after* the charge is initialized from the pre-coupon total; no invariant ties charge amount to the order's final booked total.
- **Minimal fix:** Apply the coupon to the server order **before** initializing Paystack: when `appliedCoupon` changes, `PUT /api/orders/:id {couponCode}` (allowed pre-payment), refetch `serverOrder`, and charge `serverOrder.totalAmount` (net). Enforce server-side: `verify`/webhook keep exact-kobo match (already correct) — the frontend must simply never charge a total that differs from the booked order.
- **Defense-in-depth fix:** Store `expectedAmount` (pesewas) on the order at charge initialization and freeze order monetary fields once a `paymentReference is attached; add a server endpoint `POST /api/orders/:id/quote-coupon` that returns the booked net total the client must initialize Paystack with; block `PUT` monetary mutations whenever `paymentReference IS NOT NULL`.
- **Regression test:** E2E: create order (gross 100) → apply coupon (10) → initialize + verify with amount 90 → assert `paymentStatus='paid'`, `totalAmount=90`, escrow allocations sum ≤ 90; negative: charge 100 against booked 90 → verify must 400.
- **Manual verification:** Apply a valid coupon in checkout, complete payment, then `SELECT totalAmount, paymentStatus FROM orders WHERE id=?` and compare with the Paystack dashboard charge; today you will find gross-charge vs net-book (or paid gross with no discount).

### V-02 | Cross-tenant file deletion via percent-encoded `%2F`
- **Severity:** High (multi-tenant integrity; any authenticated user vs reference images, vendor vs any product image)
- **Attacker role:** Any authenticated user (`/reference/`), any vendor/admin (`/api/upload/:filename`).
- **Precondition:** Knowledge of victim filename (leaked in public product JSON, order items, emails).
- **Endpoint/file/function:** `DELETE /api/upload/:filename` and `DELETE /api/upload/reference/:filename` — `backend/routes/uploadRoute.js:112-143,191-209`.
- **Attack sequence:** 1) Attacker id 7: `DELETE /api/upload/7-x%2F..%2F8-product-<uuid>.jpg`. 2) Express 5.2.1 decodes param to `7-x/../8-product-<uuid>.jpg`. 3) Ownership `split('-',1)[0]` → `"7"` passes. 4) `path.basename` → `8-product-<uuid>.jpg`. 5) `assertKeySafe` accepts (no `../` after basename). 6) Victim's file deleted from `uploads/products/`. Repeat across a competitor catalogue.
- **Business impact:** Competitor storefront vandalism (broken images → lost sales), custom-order reference-image loss.
- **Security impact:** BOLA/IDOR — authorization and resource resolution disagree on the canonical identifier.
- **Root cause:** Ownership evaluated on the raw param; deletion on the basename. Invariant: *authorize on exactly the identifier used to act.*
- **Minimal fix:** In both handlers: `if (filename !== path.basename(filename) || filename.includes('\\')) return 400;` **then** owner check **then** delete using the validated filename.
- **Defense-in-depth fix:** Persist `upload_owners(key, ownerId)` and authorize against the row; make `assertKeySafe` require `key` to start with `<callerId>-` and `basename(key) === key`.
- **Regression test:** `DELETE /api/upload/<myId>-x%2F..%2F<otherId>-product-u.jpg` → 400/403 **and** file still exists (both routes); normal delete still 200 (`uploadValidation.test.js`).
- **Manual verification:** `curl -b attacker -X DELETE "$API/api/upload/<attId>-x%2F..%2F<vicId>-product-<uuid>.jpg" -H "X-CSRF-Token: …"` → currently 200 + victim URL 404.

### V-03 | Deterministic permanent stock destruction (reservation leak)
- **Severity:** High (inventory DoS; verified-customer only; permanent, repeatable, no race needed)
- **Attacker role:** Any authenticated customer with verified email (register + own mailbox).
- **Precondition:** Target product `stock > 0`, `madeToOrder=FALSE`, approved.
- **Endpoint/file/function:** `POST /api/orders` — `orderController.addOrderItems` (`:331-363`), `reservationService.reserveStockForItems` (`:35-61`).
- **Attack sequence:** 1) Read product stock = 5. 2) POST `items:[{product:P,quantity:3},{product:P,quantity:3}]`. 3) Per-line pre-check passes each line independently; reserve takes 3, second line fails (`stock >= ?`). 4) `return res.status(400)` inside `try` → catch never runs, nothing restored, no order row exists so the expiry sweeper can't recover it. 5) stock = 2 permanently. Repeat `[{2},{2},{2}]` → product unsellable in ~5 requests.
- **Business impact:** Phantom sell-outs, lost sales during peak demand, manual DB repair; a competitor can zero any vendor's inventory.
- **Security impact:** Unauthenticated-to-inventory (low barrier) integrity/availability violation; `stock_moves` shows reserve moves with no release.
- **Root cause:** *All-or-nothing invariant violated: a request that fails after consuming resources must release everything it consumed before returning.*
- **Minimal fix:** In the failure branch: `await restoreStockForOrder([...reservedUnits].map(([product,qty])=>({product,qty})), {reason:'reserve-rollback'})` before the 400 (mirroring the existing dup-ref branch `:441-452`).
- **Defense-in-depth fix:** Merge duplicate `productId` lines during normalization and reserve once per product with a single conditional UPDATE (removes the deterministic trigger); reconcile `stock_moves` deltas vs `product.stock` nightly.
- **Regression test:** Seed stock=5; POST duplicate-line payload → 400 **and** `SELECT stock` = 5 **and** a compensating `stock_moves` row; concurrent variant never yields negative stock.
- **Manual verification:** `mysql -e "SELECT stock FROM product WHERE id=$P"` → 5; POST the payload; re-select → today 2 (claim confirmed), after fix 5.

### V-04 | Coupon usage cap bypassable at payment (deferred consumption)
- **Severity:** Medium (High only if the platform issues high-value platform coupons)
- **Attacker role:** Any customer who can place + pay orders (API accepts `couponCode` at creation, `orderController.js:393`).
- **Precondition:** A coupon with `maxUses = N` (single-use promo = worst case).
- **Endpoint/file/function:** `POST /api/orders` (validate at creation) → `verify-paystack`/webhook → `consumeCouponForOrder` (`escrowService.js:258-286`), `Coupon.incrementUses` (`couponModel.js:244+`).
- **Attack sequence:** 1) Create N orders carrying the same single-use code while `usesUsed = 0` — all validate. 2) Pay all N (discount already baked into each booked total). 3) Conditional increment consumes 1; the other N−1 return `consumed:false` → journaled `coupon.exhausted` + admin notification, **discount stays honoured** (own comment: "cannot be re-charged in-flow").
- **Business impact:** Platform/vendors fund unlimited redemptions of a capped promo; loss bounded by coupon terms per extra order.
- **Security impact:** Usage-limit invariant enforced only on the counter, not on the money.
- **Root cause:** *The cap must be enforced at the moment value is granted (charge), or a use slot must be reserved atomically at validation.*
- **Minimal fix:** At payment confirmation, before flipping to paid: re-validate (`usesUsed < maxUses` under a conditional UPDATE that reserves the slot in the same transaction as the flip); if no slot, decline/charge full amount or void the order — not journal-and-honour.
- **Defense-in-depth fix:** "Coupon hold": increment `usesUsed` conditionally at order creation and release it on abandonment (mirrors stock reservation); make `coupon.exhausted` events page an on-call admin rather than a dashboard note.
- **Regression test:** Seed `maxUses=1`; create+pay 2 orders with the code concurrently → exactly one paid with discount, second either full-price or rejected; counter never exceeds 1 (`couponScope.test.js` extension).
- **Manual verification:** Two sequential API orders with a 1-use code → both paid-discounted today; after fix, second must not receive the discount.

### V-05 | Google OAuth login CSRF (no `state`)
- **Severity:** Medium
- **Attacker role:** Unauthenticated attacker + one victim interaction.
- **Precondition:** Google login enabled; victim not logged in.
- **Endpoint/file/function:** `GET /api/auth/google`, `GET /api/auth/google/callback` (`authRoutes.js:106-142`), passport strategy (`passPort.js:128-146`).
- **Attack sequence:** 1) Mint consent JWT (`POST /api/auth/consent`). 2) Start flow with attacker's Google account, capture `callback?code=…` before following. 3) Deliver to victim (image/link) — consent cookie is plantable via cross-site GET. 4) Callback sets `jwt` cookie for the **attacker's** account in the victim's browser. 5) Victim's addresses/orders/payment metadata land in the attacker's account (and victim acts inside attacker's session).
- **Business impact:** Data exfiltration, order/payment misattribution, account-confusion fraud.
- **Security impact:** Authentication CSRF — session not bound to the browser that initiated it.
- **Root cause:** *Every authorization request must carry a per-request, browser-bound, single-use `state` verified at the callback.*
- **Minimal fix:** Sign `state = jwt({purpose:'oauth_state', nonce: randomUUID()}, {expiresIn:'10m'})`, set matching httpOnly cookie at `/google`, pass `state` to `passport.authenticate`, reject callback unless `req.query.state` matches cookie and is single-use (Redis `consumeOnce`, same pattern as `oauth:exchange:jti`).
- **Defense-in-depth fix:** OIDC `nonce`; bind consent token to the same nonce; reject callbacks without a pending-flow record.
- **Regression test:** (a) `/google` redirect contains `state=`; (b) callback without/mismatched state → 400 and no `jwt` cookie.
- **Manual verification:** `curl -D - "$API/api/auth/google?consent=$CT" | grep -i location` → no `state=` today.

### V-06 | Logout with a staff JWT revokes the wrong principal (and not its own session)
- **Severity:** Medium
- **Attacker role:** Any holder of a `vendor_staff` cookie (incl. a thief); malicious staff for targeted DoS.
- **Precondition:** `vendor_staff.id` collides with a real `users.id` (typical).
- **Endpoint/file/function:** `POST /api/users/logout` → `userController.logoutUser` (`userController.js:165-191`), `usersModel.bumpTokenVersion` (`:827-837`), `staffController.js:57-70`.
- **Attack sequence:** 1) Staff cookie `{id:5, role:'vendor_staff', tv}`. 2) `POST /api/users/logout`. 3) `users.id=5` tokenVersion +1 → that customer/admin force-logged-out everywhere (repeatable hourly). 4) Staff session survives (`vendor_staff.tv` untouched; `vendorOrStaff` still accepts it up to 8h).
- **Business impact:** Force-logout DoS of named users; stolen staff session cannot be ended by "log out".
- **Security impact:** Revocation invariant broken: revocation is not principal/namespace-aware.
- **Root cause:** *Logout must bump the credential table that owns the presented token, and must revoke that same session.*
- **Minimal fix:** Branch on `decoded.role`: staff → `UPDATE vendor_staff SET tokenVersion = tokenVersion+1 WHERE id=? AND vendorId=?`; else `User.bumpTokenVersion`.
- **Defense-in-depth fix:** Separate cookie names (`jwt` vs `staff_jwt`), a shared `revokeSession(decoded)` used by logout/password-change/admin-signout.
- **Regression test:** Staff logout → `users.tv` unchanged, `vendor_staff.tv` incremented, same cookie → 401 on `/api/vendors/me`.
- **Manual verification:** `curl -b staff -X POST $API/api/users/logout`; compare `SELECT tokenVersion` in both tables; replay cookie.

### V-07 | Refund double-spend across paths (unchecked marker + divergent dedupe keys)
- **Severity:** Medium (money-loss prevented only by Paystack's remaining-refundable cap)
- **Attacker role:** Admin/operator concurrency (or an attacker racing a legitimate refund request via parallel API calls they are allowed to make — customer return + admin cancel).
- **Precondition:** A paid order; one path approving a return while another cancels/refunds (or two returns on the same order).
- **Endpoint/file/function:** `PUT /api/admin/returns/:id/status` (`returnController.js:167-343`), admin cancel (`orderController.js:1060-1134`).
- **Attack sequence:** 1) Both paths read `paymentStatus='paid'`. 2) Marker `UPDATE … AND refundReference IS NULL` executed but **affectedRows ignored** (`returnController.js:303-306`, `orderController.js:1082-1085`). 3) Both call `refundTransaction` with different ledger dedupe keys (`refund:${id}:${returnId}:…` vs `refund:${id}`). 4) Paystack processes one, rejects the second (nothing left to refund) — success depends on the provider, not our code; journal still records divergent keys and partial-then-full sequences can mislead reconciliation. `refundedAmount` remaining check (`returnController.js:160-163`) is check-then-act for concurrent partials.
- **Business impact:** Duplicate refund attempts, reconciliation drift, potential over-refund if provider semantics change or partials are concurrent.
- **Security impact:** Financial exactly-once invariant not enforced by the platform.
- **Root cause:** *A refund must be claimed atomically (CAS on a single marker/`paymentStatus` transition whose affectedRows gates the provider call), with one shared dedupe key per order.*
- **Minimal fix:** `UPDATE orders SET refundReference=? WHERE id=? AND refundReference IS NULL` → check `affectedRows === 1`; only the winner calls Paystack. Standardize dedupe key to `refund:<orderId>` for ALL paths; make `refundedAmount` increment conditional (`… WHERE refundedAmount + ? <= totalAmount`).
- **Defense-in-depth fix:** Drive every refund through one `RefundService` state machine (`paid → refunding → refunded` CAS) that all callers share; reconciler compares ledger vs Paystack refunds.
- **Regression test:** Fire approve-return and cancel concurrently (barrier test) → exactly one Paystack refund call (mock), one ledger row; partial+full race → never exceeds captured amount (`refundGuard.test.js` extension).
- **Manual verification:** Mock `refundTransaction`, run both paths in parallel, count invocations = 1.

### V-08 | Double stock restore on post-create failure (inventory inflation)
- **Severity:** Medium
- **Attacker role:** Not directly triggerable; attacker can increase odds (large carts/edge cases); effect is silent oversell.
- **Precondition:** Exception after `Order.create` (typically inside `createEscrowAllocations`, `orderController.js:465` — outside any transaction).
- **Endpoint/file/function:** `POST /api/orders` catch (`:468-483`) + `releaseExpiredReservations` (`reservationService.js:69-142`) + cancel (`orderController.js:1146-1162`).
- **Attack sequence:** 1) Post-create throw → catch restores units in memory. 2) Order row persists with `items[].reserved > 0`, pending. 3) 45 min later the sweeper adds the same units again (`:109`). 4) Stock inflated → oversell → paid orders with no goods → refunds while escrow already held.
- **Business impact:** Overselling physical goods, refund costs, payout disputes.
- **Security impact:** "A reservation converts exactly once" invariant broken (double credit).
- **Root cause:** *Recovery must have exactly one owner: either in-memory restore + atomic marker clear, or never in-memory-restore an order whose markers are persisted.*
- **Minimal fix:** In the catch, if `newOrder?.id` exists, skip the in-memory restore (leave recovery solely to the sweeper), or clear the markers in the same transaction as the restore.
- **Defense-in-depth fix:** Wrap `Order.create + createEscrowAllocations` in one unit-of-work; make the sweeper idempotent per `orderId+productId` via `stock_moves` history; alert on ledger drift.
- **Regression test:** Mock `createEscrowAllocations` to throw → assert stock unchanged immediately **and** after forcing `releaseExpiredReservations(0)`.
- **Manual verification:** Induce the failure; `SELECT stock` and `SELECT items` (markers) at T+0 and T+45 min.

### V-09 | Paystack same-host path injection with secret key
- **Severity:** Medium (authenticated info disclosure of the platform's Paystack account surfaces)
- **Attacker role:** Any authenticated user.
- **Precondition:** None beyond login.
- **Endpoint/file/function:** `POST /api/payments/verify-paystack` (`paymentRoutes.js:102-106`, `reference` unencoded); background `escrowService.js:1151`.
- **Attack sequence:** `{"reference":"../../balance"}` → server performs `GET https://api.paystack.co/balance` with `Bearer <PAYSTACK_SECRET_KEY>`; response is then interpreted as a verify result (error-shape/response content disclosure). Host cannot be escaped (`//`, `@` stay in-path) ⇒ same-host only.
- **Business impact:** Leakage of account/balance/endpoint responses; misuse of platform credentials.
- **Security impact:** URL constructed from user input without encoding — credential-bearing request forgery against one host.
- **Root cause:** *User-controlled URL path segments must be percent-encoded (`encodeURIComponent`) — a value must never be able to leave its slot.*
- **Minimal fix:** `encodeURIComponent(reference)` at both sites + validate `reference` format (`/^[A-Za-z0-9._-]{1,100}$/`) before use.
- **Defense-in-depth fix:** Central `paystackGet(pathSegments[])` builder; allow-list references.
- **Regression test:** `reference='../../balance'` → 400 invalid reference; mock captures URL containing the encoded literal.
- **Manual verification:** Send the payload; observe the outbound path in logs/dashboard.

### V-10 | Unauthenticated per-account lockout DoS + identity oracles
- **Severity:** Medium (lockout) / Low-Medium (enumeration)
- **Attacker role:** Unauthenticated.
- **Precondition:** Target email known (public).
- **Endpoint/file/function:** `POST /api/users/auth` (`usersModel.authenticate :481-519`), `POST /api/users` (`userController.js:97-103,144-153`), `POST /api/users/forgot-password` (`:213-232`), `GET /api/users/reset-password/:token` (`:308-326`).
- **Attack sequence:** 10 wrong passwords spaced/rotated around `authLimiter` (5/15 min **IP-keyed**) → victim 423 for 1h, repeatable hourly (per-account, DB-backed, client-unbound counter). Register: 400 vs 201 discloses existence; forgot-password: two distinct 200 bodies + timing (SMTP round trip only for real users); reset-token GET returns `valid:true/false` (3/h/IP).
- **Business impact:** Targeted lockout of customers/vendors during peak trade; verified-email lists for phishing.
- **Security impact:** Anti-enumeration defeated; unauthenticated targeted auth DoS.
- **Root cause:** *(i) auth must do equal work for unknown users; (ii) failure counters must be bound to a client key so third parties cannot consume them; (iii) public auth endpoints must be response-identical regardless of state.*
- **Minimal fix:** Dummy `bcrypt.compare` for unknown users; single generic body for forgot-password (send async/decoy); register returns one constant response; reset-token GET returns one constant body (frontend attempts POST).
- **Defense-in-depth fix:** Limiter keyed `${email}:${ip}` (pattern already exists: `staffAuthLimiter :66-70`); lockout only counts failures from a stable source; alert on lockout storms.
- **Regression test:** Deep-equal responses for existing vs non-existing emails; timing delta under threshold; 10 failures from fresh IPs must not 423 unless the per-account bucket genuinely tripped.
- **Manual verification:** Loop 10 wrong passwords from rotating IPs → victim locked with correct password.

### V-11 | Vendor can skip fulfilment stages (forward jumps arm escrow clock)
- **Severity:** Medium-Low
- **Attacker role:** Approved vendor (own mark), single-vendor orders are the worst case.
- **Precondition:** Order in `processing`.
- **Endpoint/file/function:** `POST /api/vendors/orders/:id/status` (`vendorOrderController.js:296-446`).
- **Attack sequence:** Forward-only check rejects only backwards moves (`:356-362`) → vendor posts `orderStatus:'delivered'` directly from `processing` → for single-vendor orders consensus = delivered → escrow release deadline armed (`:433-446`) without `shipped/arrived` ever being true.
- **Business impact:** Customer sees "delivered" prematurely; auto-release clock starts without shipment evidence (escrow still waits the release window and customer confirmation).
- **Security impact:** State-machine gap: transitions allowed are not the declared pipeline (`processing → packaging → shipped → arrived → delivered`).
- **Root cause:** *The pipeline must be enforced as an ordered state machine (exactly +1 step per transition), not as "not backwards".*
- **Minimal fix:** Require `nextIdx === ownIdx + 1` (allow admin override), keeping `expectedCompletionDate` writes independent.
- **Defense-in-depth fix:** Track transition timestamps per stage and require `trackingNumber` before `shipped`.
- **Regression test:** `processing → delivered` → 400; `processing → packaging` → 200; multi-vendor consensus never advances past the slowest mark.

---

## 4. Medium / Low findings (compact)

| ID | Finding | Status | Sev | Root cause (invariant) | Minimal fix |
|---|---|---|---|---|---|
| C5 | Pending applicant holds `role='vendor'` (`vendorController.js:115`) and the owner branch of `vendorOrStaff` never checks `vendors.status` (`authMiddleware.js:173-194`) — staff branch does (`:215`) | PARTIAL | Low-Med | *Role ≠ approval: vendor-scoped routes must gate on the vendor row's lifecycle state for owners too, as they already do for staff* | Check `vendors.status==='approved'` in the owner branch (skip for `role==='admin'`); product/staff/withdraw/custom-request gates already hold (`vendorController.js:283-284,1041-1043`), coupons are not gated (`vendorRoutes.js:79-81`) |
| A8 | Bare `PUT /api/vendors/profile` and `GET /api/vendors/reviews` (`vendorRoutes.js:62,71`) reachable with any permission set | CONFIRMED | Low | *Every state-changing/data-returning vendor route must declare a permission; `vendorOrStaff` is authentication, not authorization* | Add `requireVendorPermission('manage_products'/'reply_reviews')`; route-table test enforcing the invariant |
| I3 | Absolute `SET stock = -5` accepted (vendor own product `vendorController.js:420-423`, `productModel` int cols); no `CHECK (stock>=0)` | PARTIAL | Low | *Stock is a non-negative quantity on every write path, arithmetic or absolute* | `Math.max(0, …)` clamp + DB CHECK + nightly `stock<0` alert |
| M-1 | Resend/verify limiter keyed per IP only (`authLimiter` 5/15min); OTP attempts reset on each resend (`usersModel.js:553`) | PARTIAL | Low-Med | *Abuse controls must be keyed to the target account as well as the client* | Key `${email}:${ip}`; do not reset attempt counters on resend (max 5 per code, 20 per account/hour) |
| M-6 | Unescaped `firstName`/address/item-name interpolated into HTML emails (`emailService.js:149…`, `orderEmailService.js:101-102,134`) | PARTIAL | Low | *Any user-controlled value rendered into a message must be HTML-escaped at the template boundary* | `escapeHtml()` in a `layout()` helper applied to every interpolation; stop storing raw client `item.name` (use DB title) |
| M-7 | No price bounds in validators | PARTIAL | Low | *Domain values must be range-validated at input* | `price: z.number().positive().max(1e7)` in product schema |
| M-8 | 2 `validate()` mounts vs 31 mutating routes | PARTIAL | Low | *Every mutating endpoint declares a schema* | Zod schema per route + CI check: `grep -c validate( routes` ≥ mutating route count |
| C2 | Admin percentage coupons uncapped (`couponController.js:13-19`); PUT total `subtotal+ship+tax-discount` unclamped (`orderController.js:696`) → negative `totalAmount` rows possible | PARTIAL | Low | *Discount ∈ [0, subtotal] and totalAmount ≥ 0 on every path* | Cap admin % at 100 (or explicit `allowNegative` flag) + `Math.max(0, …)` clamp; DB CHECK `totalAmount >= 0` |
| X1 | Distinct coupon failure messages + `minPurchase` echoed (`couponModel.js:173-210`) | PARTIAL | Low | *Validation endpoints return one generic failure shape* | Unified `{valid:false, message:'Coupon cannot be applied'}` + keep limiter |
| X4a | Public unauthenticated `/metrics` (`server.js:338-339`) | CONFIRMED | Low | *Telemetry endpoints are internal* | Bind to admin/IP-allow-list or drop authless exposure |
| N-1 | See V-09 | — | Med | — | — |
| N-2 | `!decoded.tv` rejects `tv:0` OAuth exchange (`authRoutes.js:175`) | CONFIRMED | Low (bug) | *Presence checks must use `!== undefined`* | `decoded.tv === undefined \|\| decoded.tv === null` |
| N-3 | (folded into X4a) | — | — | — | — |
| N-4 | Vendor A's `productionNote` overwrites shared order row note shown to customer (`vendorOrderController.js:423-425`) | CONFIRMED | Low | *Per-vendor writes must never clobber shared/other-tenant state* | Render customer note from marks only, or namespace the shared column per vendor |
| N-5 | `npm run db:migrate` crashes mid-chain (order-items backfill) → partial schema | CONFIRMED | Low (ops) | *Migrations are atomic/idempotent and verified* | Fix backfill, wrap each step, add post-migrate assertion job |
| N-6 | Suspension/unapproval never unpublishes products (`productModel.js:177-186` filters only `p.approvalStatus`; `updateVendorStatus` doesn't touch products) | CONFIRMED | Med | *Vendor state gates storefront visibility: public product queries require `v.status='approved'`* | Add `AND v.status='approved'` to public queries (or bulk-set `approvalStatus='pending'` on suspend) |
| M-5 | Frontend `npm audit`: 6 high (axios ≤1.19.0 + braces chain) | PARTIAL | Med (advisory) | *Production dependencies carry no known high/critical advisories at launch* | `npm update axios braces` + CI `npm audit --omit=dev --audit-level=high` gate (backend already 0) |
| F2 | Unanchored regex `/jpeg\|jpg\|png\|gif\|webp/` in `uploadMiddleware.js:31-33` (anchored twin exists in `profileRoutes.js:51-60`) | PARTIAL | Info | *Defense layers independently correct* | Share one anchored `imageFileFilter` module |
| F4a | Try-on: syntactic-only URL validation → DNS-rebind/redirect delegated SSRF to Replicate | PARTIAL | Low | *Validate at resolution time; revalidate redirects* | Resolve → check IP → pin; or allow-list/`data:`-only |
| A5 | Login timing oracle (bcrypt skipped for unknown email) | PARTIAL | Low | *Equal work for unknown users* | Dummy bcrypt compare |
| R2 | Partial-refund `remaining` check is check-then-act (`returnController.js:160-163,276-279`) | PARTIAL | Low | *Refundable-balance decrement must be conditional* | `UPDATE orders SET refundedAmount = refundedAmount + ? WHERE id=? AND refundedAmount + ? <= totalAmount` + affectedRows gate |
| R3 | Refund restores stock once (conflict products skipped) | FALSE POSITIVE | — | — | `refundRestore.test.js` passes |
| V-02a | Multi-vendor order: buyer PII visible to any vendor with a line item (by design), no unrelated-order access found | FALSE POSITIVE | — | — | — |
| X2 | AI try-on spend capped per user + validate-before-credit | FALSE POSITIVE | — | — | — |
| X3 | Redis-backed limiters active (`REDIS_URL` set); fallback memory | FALSE POSITIVE | — | — | — |

---

## 5. False positives (claims disproven against current code)

| Claim | Why it is now FALSE |
|---|---|
| Cross-vendor coupon scope (C-1 core) | `Coupon.validate` enforces all-cart-lines == issuing vendor (`couponModel.js:197-212`); checkout passes vendor ids (`orderController.js:397-405`); `couponScope.test.js` asserts it |
| Platform coupon list leak to vendors | `getVendorCoupons` now `WHERE vendorId = ?` only (`vendorController.js:746`) |
| Email-change keeps verified flag / OAuth pre-hijack (H-5) | `usersModel.update` resets `is_email_verified` + bumps `tv` on any email change (`usersModel.js:329-376`); covered by `authHardening.test.js` |
| Moderation bypass (H-3) | `publicApprovalFilter` on all public reads, detail gate (`productController.js:12,105`), checkout rejects non-approved (`orderController.js:323`); `productModeration.test.js` |
| Cross-vendor fulfilment / escrow arming (H-7) | 403 `orderHasVendorItem` (`vendorOrderController.js:308`), per-vendor marks, consensus = slowest (`:407-413`), escrow only on consensus delivered (`:433-446`); `vendorIsolation.test.js` |
| Stale escrow after coupon (M-9) | `reallocateOrderEscrow` on discount change with 409 fail-closed (`orderController.js:712-729`) |
| Payment amount manipulation / reference reuse | Server-recomputed totals (`:386,696`), exact-kobo verify (`paymentRoutes.js:140-147,337-346`), ownership check (`:137`), reference UNIQUE + once-only attach (`:435-452`, `orderController.js:631-654`) |
| Webhook replay / double processing | HMAC rawBody, `webhook_events` claim, CAS flip + `affectedRows` gates escrow/stock/coupon side effects (`paymentRoutes.js:153-164,383-434`) |
| Escrow release double-credit | `releaseAllocation` CAS `held→available` + affectedRows + wallet ledger unique key + revert (`escrowService.js:311-340`) |
| Payout duplication / double withdraw | `payoutAllocation` transactional claim `WHERE status='available' AND payoutAmount>=?` with idempotency key persisted **before** transfer (`escrowService.js:395-404`); wallet debited only by signed webhook |
| Order/total manipulation by owner | PUT whitelist strips items/shipping/tax/discount/total/status/escrow fields (`orderController.js:603-622`) |
| Negative discount | `calcCouponDiscount` clamps ≥0 and fixed ≤ subtotal (`shared/pricing.js:59-65`) |
| Registration role assignment (A7) | Role hardcoded `customer` (`userController.js:122`), self-edit schema `.strict()`, role change behind `protect, admin` (`userRoutes.js:105-108`) |
| JWT revocation gaps (A6) | All 4 session issuers embed `tv`; all verifiers enforce it (`authMiddleware.js:30,88,185,222`, `authRoutes.js:192`) — with the N-2 availability caveat |
| Vendor A → B orders/customers/coupons/stock/escrow/wallet (V3–V6) | List WHERE clauses scoped to caller's items (`vendorOrderController.js:158-209`); no unscoped detail route exists; reviews `WHERE p.vendorId` (`vendorController.js:623`); wallet/withdraw keyed `req.user.id` + approved gate (`:588,1041`); no `req.body/params/Query.vendorId` consumption found; all stock decrements conditional |
| Upload XSS / key traversal / bombs / SVG (F3) | Fully server-generated keys (`uploadRoute.js:84,171`), magic-byte validation + 8192px bomb cap (`imageValidator.js:100-133`), `assertKeySafe`, traversal-safe static handler (`server.js:243-270`), nosniff/CSP |
| Staff cross-tenant reach (A8 half) | Verified: staff of vendor A cannot read/write vendor B anywhere tested |
| Refund stock restore (R3) | Restores exactly once, skips payment-time conflicts (`returnController.js:332+`); `refundRestore.test.js` passes |
| Rate-limit store durability (M-2) | Redis store on all limiters + `REDIS_URL` configured (`rateLimitMiddleware.js:16-18`) |
| AI spend abuse (M-12) | Daily per-user cap + validate-before-credit + allow-listed schemes/hosts (`tryOnController.js:112-182`) |
| Backend dependency vulnerabilities | `npm audit --omit=dev` = 0 (frontend still has 6 high — M-5 stands for the frontend only) |

**UNVERIFIED (stated honestly):** exact runtime arrival order of webhook vs frontend PUT for V-01 (both orderings are harmful, so classification is robust); whether production `db:migrate` has already run the new feature tables on Render (N-5 was observed locally); response-content leakage granularity of V-09 (endpoint reachability confirmed, data returned depends on Paystack route).

---

## 6. Security strengths (verified, not aspirational)

1. **Money invariants largely CAS-based:** payment flip (`paymentStatus != 'paid'` + affectedRows), escrow `held→available`, payout `available→releasing` with idempotency key persisted pre-transfer, return state machine conditional transitions.
2. **Single pricing source:** `shared/pricing.js` drives cart, checkout, order creation, and escrow netting — client totals are never trusted.
3. **Coupon/vendor scoping + caps:** all-cart-lines scope, 50% vendor cap, conditional usage increment, `toPublic()` redaction, per-route coupon limiter.
4. **Per-vendor fulfilment consensus** (slowest-vendor rule) with per-vendor marks, tracking, and escrow deadlines — a solid multi-tenant design.
5. **Moderation is enforced at read time** (`publicApprovalFilter`) with a regression test.
6. **Stock:** every decrement conditional (`stock >= ?`), reservation ledger (`stock_moves`), expiry sweeper, made-to-order exemptions explicit.
7. **Auth:** `tv` claim everywhere, strict `.strict()` schemas on self-service paths, staff permission model + approved-vendor gate, OTP attempt counters, email-change resets verification (all now test-covered).
8. **Uploads:** server-generated UUID keys, magic bytes, bomb cap, no SVG/HTML path, traversal-safe static serving.
9. **Webhook:** HMAC over raw body + `webhook_events` idempotency + retries.
10. **Test culture:** 19 backend suites incl. `vendorIsolation`, `couponScope`, `productModeration`, `authHardening`, `refundGuard`, `stockRace` — 28/28 executed green in this review.
11. **Redis-backed rate limiting** across all limiters with graceful fallback.

---

## 7. Required security regression suite (extend what exists)

| # | Test (file) | Invariant asserted |
|---|---|---|
| 1 | `checkoutCouponE2E.test` (new) | charge amount (pesewas) == booked `totalAmount` == escrow basis, for coupon and non-coupon orders; verify rejects mismatch (V-01) |
| 2 | `uploadDelete.test` (extend `uploadValidation.test.js`) | `DELETE /api/upload/<me>-x%2F..%2F<other>-…` → 400/403, file survives; same for `/reference/` (V-02) |
| 3 | `reservation.test.js` extend | duplicate-line payload → 400 + stock unchanged + compensating `stock_moves` row (V-03) |
| 4 | `couponScope.test.js` extend | concurrent payments with `maxUses=1` → exactly one discounted paid order; counter == 1; second order full-price/rejected (V-04) |
| 5 | `authHardening.test.js` extend | `/google` redirect carries `state`; mismatched/absent state → 400, no cookie (V-05) |
| 6 | `logout.test` (new) | staff logout → `users.tv` unchanged, `vendor_staff.tv`+1, cookie rejected after (V-06) |
| 7 | `refundGuard.test.js` extend | barrier-parallel approve+cancel → exactly one provider refund call, one ledger row, `refundedAmount <= totalAmount` (V-07) |
| 8 | `refundRestore.test.js` extend | injected post-create failure → stock identical at T+0 and after forced sweeper run (V-08) |
| 9 | `paymentHardeningSchema.test.js` extend | `reference='../../balance'` rejected; captured URL is exactly the verify path (V-09) |
| 10 | `authHardening.test.js` extend | forgot-password bodies deep-equal; reset-token GET constant body; 10 rotating-IP failures don't lock a fresh account from one source only (V-10) |
| 11 | `tracking.test.js` extend | `processing→delivered` → 400; `+1` step → 200 (V-11) |
| 12 | `vendorIsolation.test.js` extend | zero-permission staff: `PUT /profile`, `GET /reviews` → 403 (A8); pending vendor → coupons/products 403 (C5) |
| 13 | `productModeration.test.js` extend | suspended vendor's products invisible to public queries + storefront (N-6) |
| 14 | `escrowLogic.test.js` extend | platform-coupon netting matches policy decision; admin `%>100` rejected; `totalAmount >= 0` CHECK (C2, N-7) |
| 15 | CI gates | `npm audit --omit=dev --audit-level=high` (frontend + backend); route count vs `validate(` count (M-8) |

## 8. Required staging penetration tests (before pilot)

1. **Coupon flow, full-stack:** UI checkout with every coupon type (platform/vendor, %/fixed, min-purchase, 1-use) — assert Paystack charge == booked total, escrow sum == collected − fee, uses consumed exactly once.
2. **Concurrent abuse:** 10 parallel checkouts on last-unit stock; parallel duplicate-line orders; parallel coupon payments with `maxUses=1`; parallel approve+cancel refunds; parallel double withdraw — assert no stock < 0, one provider refund, one payout.
3. **Cross-tenant probes (curl):** `%2F` delete payloads both routes; vendor A tokens against every `/api/vendors/*` route with B's ids; staff with `permissions:{}` against all vendor routes; pending-applicant token against product/coupon/withdraw/staff/orders.
4. **Payment fraud:** reused reference across two orders; amount-short and amount-long charges; webhook replay (same event twice, tampered HMAC, wrong secret); `verify-paystack` with `../../balance`, `@evil`, `//evil`, non-string reference.
5. **Auth abuse:** OAuth login-CSRF end-to-end with two browsers; reset-link enumeration at scale (verify 429s); lockout DoS from IP rotation; staff logout cross-table probe; `tv=0` OAuth exchange.
6. **File abuse:** MIME spoofing (HTML/SVG bytes with image ext), 9000×9000 decompression bomb, polyglot GIF/JPEG, filename edge cases (`..%2F`, null byte, unicode normalization).
7. **Fulfilment/escrow:** stage-skip attempts (all 5 stages × both roles), single-vendor instant-delivered, per-vendor confirm-received isolation, auto-release with one vendor undelivered.
8. **Inventory lifecycle:** cancel-then-expiry-sweeper on same order; refund + cancel same order; made-to-order bypass attempts; `stock:-5` set then purchase attempt.

## 9. Production security checklist (launch gate)

- [ ] V-01 coupon/charge divergence fixed and E2E test green (money correctness — hard blocker)
- [ ] V-02 delete canonicalization fixed (both routes) (hard blocker)
- [ ] V-03 reservation rollback fixed (hard blocker)
- [ ] V-04 payment-time coupon re-validation (blocker if platform issues capped promos)
- [ ] V-05 OAuth `state`; V-06 role-aware logout; V-07 shared refund claim; V-08 single-owner stock recovery; V-09 `encodeURIComponent`; V-10 generic auth responses + email-keyed limiters; V-11 strict pipeline; N-6 suspension unpublish
- [ ] Frontend `npm audit` clean (axios/braces) + CI audit gate on both packages
- [ ] `REDIS_URL` set in Render for both instances' limiters; confirm memory fallback acceptable if not
- [ ] `db:migrate` crash (N-5) fixed; migrations verified atomic on staging clone
- [ ] `/metrics` restricted (auth/IP) or removed from public router
- [ ] Secrets audit: Paystack/JWT/DB in platform env only (repo clean — verified `.env` not committed; `backend/.env` is local)
- [ ] Admin actions (refunds, vendor status, monetary PUTs, coupons >50%) emit audit-log rows (`auditLog.js` wired to these routes)
- [ ] Backup/restore drill on TiDB (`.github/workflows/backup.yml` reviewed for secret exposure before commit)
- [ ] Support runbook: `coupon.exhausted` events, refund reconciler, `stock_moves` drift alert
- [ ] All 15 regression suites green in CI; staging pentest section 8 executed with evidence attached

---

## 10. Final table

ID | Finding | Status | Severity | Exploitability | Financial Impact | Data Impact | Fix Priority | Regression Test
---|---|---|---|---|---|---|---|---
V-01 | Coupon charged gross, booked net (checkout divergence) | CONFIRMED | High | Trivial (normal UI use) | Per-coupon-order overcharge or captured-but-unpaid order | Ledger/escrow divergence | P0 | #1 checkoutCouponE2E
V-02 | Cross-tenant delete via encoded `%2F` | CONFIRMED | High | Trivial (auth user; known filename) | Indirect (competitor image vandalism) | Cross-tenant file integrity loss | P0 | #2 uploadDelete
V-03 | Permanent stock destruction via failed reservation | CONFIRMED | High | Trivial (verified customer, ~5 requests) | Lost sales / fake sell-out | Inventory ledger integrity | P0 | #3 reservation extend
V-04 | Coupon cap bypassable at payment | PARTIALLY CONFIRMED | Medium | Moderate (API + real payments) | Discount funded beyond cap | Coupon usage ledger | P1 | #4 couponScope extend
V-05 | OAuth login CSRF (no state) | CONFIRMED | Medium | Moderate (one-click + Google flow) | Indirect (misattributed orders) | Session/account data exfil | P1 | #5 authHardening extend
V-06 | Logout revokes wrong principal; staff session survives | CONFIRMED | Moderate | Trivial (staff cookie) | Support/DoS cost | Cross-user session integrity | P1 | #6 logout.test
V-07 | Refund double-spend across paths (unchecked marker) | PARTIALLY CONFIRMED | Medium | Hard (needs concurrency; provider cap backstops) | Duplicate refund if provider semantics change | Reconciliation drift | P1 | #7 refundGuard extend
V-08 | Double stock restore (post-create failure) | PARTIALLY CONFIRMED | Medium | Opportunistic (needs server error) | Oversell → refunds | Inventory inflation | P1 | #8 refundRestore extend
V-09 | Paystack path injection w/ secret key | CONFIRMED | Medium | Trivial (any auth user) | None direct | Platform Paystack account data | P1 | #9 paymentHardening extend
V-10 | Account-lockout DoS + identity oracles | PARTIALLY CONFIRMED | Medium | Trivial (unauth) | Support cost, lost sales while locked | Email existence disclosure | P1 | #10 authHardening extend
V-11 | Fulfilment stage-skip arms escrow clock | PARTIALLY CONFIRMED | Medium-Low | Trivial (vendor) | Early release clock (still windowed) | Order state integrity | P2 | #11 tracking extend
C5 | Pending applicant retains vendor role w/o status gate | PARTIALLY CONFIRMED | Low-Med | Trivial (applicant) | Minimal (money paths gated) | Permission surface | P2 | #12 vendorIsolation extend
N-6 | Suspension doesn't unpublish products | CONFIRMED | Medium | Trivial (admin action exists; storefront ignores it) | Sales from sanctioned vendor | Policy/customer safety | P1 | #13 productModeration extend
A8 | Two vendor routes missing permission gates | CONFIRMED | Low | Trivial (zero-perm staff) | Store defacement | Customer PII (reviews) | P2 | #12 vendorIsolation extend
M-1 | OTP resend/attempt keying gaps | PARTIALLY CONFIRMED | Low-Med | Moderate (IP rotation) | Inbox flooding abuse | Email bombing | P2 | #10
M-5 | Frontend 6 high advisories (axios, braces) | PARTIALLY CONFIRMED | Medium (adv.) | Depends on advisory | DoS | SSRF-class in client | P1 | #15 audit gate
M-6 | Email HTML injection (unescaped interpolation) | PARTIALLY CONFIRMED | Low | Low (mostly self-impact) | Phishing credibility | Email content spoofing | P3 | template escape unit test
M-7 | Missing price bounds | PARTIALLY CONFIRMED | Low | Low (guards neutralize) | None found | Data integrity | P3 | schema test
M-8 | Weak schema coverage (2/31) | PARTIALLY CONFIRMED | Low | Indirect (future endpoints) | Latent | Latent | P2 | #15 CI count gate
C2 | Admin % coupon uncapped → negative totals | PARTIALLY CONFIRMED | Low | Admin-only footgun | Bookkeeping corruption | Ledger rows | P2 | #14 escrowLogic extend
X1 | Coupon validation oracle | PARTIALLY CONFIRMED | Low | Rate-limited (15/min) | None | Code/state enumeration | P3 | generic-message test
X4a | Public `/metrics` | CONFIRMED | Low | Trivial | None | Traffic/endpoint intel | P3 | route-auth test
F2 | Unanchored upload regex (unexploitable) | PARTIALLY CONFIRMED | Info | None today | None | None | P3 | #2 negative cases
F4a | Try-on delegated SSRF residual (DNS/redirect) | PARTIALLY CONFIRMED | Low | Needs AI enabled + custom DNS | Provider-side exposure | Metadata (3rd party) | P3 | URL validator unit tests
N-2 | `tv=0` OAuth exchange rejected (availability) | CONFIRMED | Low (bug) | N/A | Failed logins | None | P2 | exchange tv=0 test
N-4 | Shared `productionNote` clobber across vendors | CONFIRMED | Low | Trivial (vendor) | None | Note integrity/customer comms | P3 | multi-vendor note test
N-5 | `db:migrate` crashes mid-chain | CONFIRMED | Low (ops) | N/A | Outage/partial schema | Schema integrity | P1 | migration idempotency test
C-1 | Cross-vendor coupon abuse (original CRITICAL chain) | FALSE POSITIVE (fixed) | — | — | — | — | — | couponScope.test.js
H-3 | Moderation bypass | FALSE POSITIVE (fixed) | — | — | — | — | — | productModeration.test.js
H-5 | Email/OAuth takeover | FALSE POSITIVE (fixed) | — | — | — | — | — | authHardening.test.js
H-7 | Cross-vendor fulfilment/escrow | FALSE POSITIVE (fixed) | — | — | — | — | — | vendorIsolation.test.js
M-9 | Stale escrow after coupon | FALSE POSITIVE (fixed) | — | — | — | — | — | escrowLogic.test.js
M-2 | Rate-limit durability | FALSE POSITIVE (fixed) | — | — | — | — | — | limiter store unit test
Others (payment fraud, webhook replay, release/payout races, order totals, V3–V6 isolation, F3 uploads, R3, A6/A7, X2/X3, backend deps) | See §5 | FALSE POSITIVE | — | — | — | — | — | existing suites (19)
— | R2 partial-refund check-then-act | PARTIALLY CONFIRMED | Low | Hard (concurrent partials) | Bounded by provider cap | Ledger drift | P3 | refundGuard extend

---

## 11. What are the minimum security changes required before Kente Market can safely run a real-money multi-vendor pilot?

**Five changes are non-negotiable; everything else can follow during the pilot.**

1. **Make the charge equal the booking (V-01, P0).** Enforce the invariant *"the pesewas initialized at Paystack == the order's `totalAmount` at verification time == the basis of escrow allocations"* by applying the coupon to the server order **before** payment initialization (PUT-coupon-then-refetch-then-charge), keeping the existing exact-kobo verify/webhook check as the enforcement point. Until this is done, every coupon order either overcharges the customer or strands captured money — a pilot cannot price-correct at scale.

2. **Authorize on the canonical identifier (V-02, P0).** Enforce *"a request may act only on the object whose canonical (normalized) key it presents"*: reject any upload filename that differs from its `basename` **before** the ownership check, on both delete routes. This is the one remaining cross-tenant write.

3. **Make failed checkouts atomic (V-03, P0).** Enforce *"a request releases everything it consumed before it returns an error"*: restore reservations in the 400 branch (and merge duplicate lines). Without it, any verified customer can permanently destroy a vendor's sellable inventory — existential for trust in a multi-vendor pilot.

4. **Close the money-race trio (V-04, V-07, V-08, P1).** Enforce: (a) *a coupon slot is reserved atomically at the moment value is granted* (re-validate under conditional UPDATE at payment, not journal-and-honour); (b) *one refund claim per order, one shared dedupe key, affectedRows gates the provider call*; (c) *one recovery owner per reservation* (no in-memory restore for orders whose markers persist). These are the four paths where money or stock can move twice or move without being earned.

5. **Harden the session boundary (V-05, V-06, V-10, P1).** Enforce: *every OAuth flow is browser-bound via single-use `state`*; *logout revokes the principal that presented the token*; *public auth endpoints are response-identical regardless of account state and abuse counters are keyed `${email}:${ip}`*. Plus the two hygiene items that trip most launches: clear the frontend `npm audit` highs with a CI gate, unpublish suspended vendors' products (N-6), and fix the migration crash (N-5) so the schema you deploy is the schema you tested.

Everything ranked P2/P3 (schema coverage, note clobbering, `/metrics`, oracle messages, template escaping, strict pipeline steps) should ride along in the same sprint but does not block a controlled pilot — provided the 15-test regression suite runs in CI and the staging pentest list (§8) is executed with evidence before the first real-customer transaction.
