# Kente Market — Application Security Audit Report

**Target:** https://kente-market.vercel.app/ (production, multi-tenant marketplace)
**Repository:** https://github.com/Robert1owusu1/Kente_Market.git (audited against local working tree)
**Stack:** React 19 + Vite (Vercel) · Express 5 (Render) · MySQL/TiDB · Paystack · Passport (Google/Facebook) · Sentry
**Audit type:** Full static source-code review (white-box), attacker-oriented
**Date:** October 2026
**Auditor role:** Senior Application Security Engineer

---

## 1. Executive Summary

The platform shows evidence of deliberate security hardening — parameterized SQL everywhere, double-submit CSRF, token-version session revocation, webhook HMAC verification, bcrypt-12, edge CSP, magic-byte upload validation, and no committed secrets. The *infrastructure* layer is notably good for a project of this size.

However, the **authorization and business-logic layers are not consistent with that care**. The audit confirmed **1 Critical, 7 High, 13 Medium and 17 Low** findings. The most serious cluster is a **fully unauthenticated-to-theft chain**: any registered account can self-promote to `vendor`, mint coupon codes that are never scoped to their own store, and have the resulting discount silently netted out of *other vendors'* escrow payouts. A second cluster around **payment/coupon ordering** creates charged-but-unconfirmed orders and lets single-use coupons be redeemed many times.

| Severity | Count | Headline |
|---|---|---|
| **Critical** | 1 | Cross-vendor coupon theft chain (self-promoted vendor → unscoped coupons → escrow netting) |
| **High** | 7 | Coupon cap bypass · checkout amount mismatch · moderation bypass · cross-tenant file delete · email-change OAuth hijack · stock leak · multi-vendor order/escrow manipulation |
| **Medium** | 13 | OTP resend bypass, no Redis rate-limit store, OAuth state, password-reset enumeration, vulnerable axios, email HTML injection, price validation, validation coverage, stale escrow, buyback reuse, refund TOCTOU, coupon oracle, AI-spend limiting |
| **Low** | 17 | Status jumps, negative totals, staff logout, lockout DoS, timing oracles, fragment token, upload regex, error leakage, missing permission gates, etc. |

**Verdict: Do not launch publicly until all Critical and High findings are remediated and retested.** The Critical/High items are directly exploitable by an ordinary registered user against other vendors' money and data.

---

## 2. Scope & Methodology

Every route was traced end-to-end: `route → middleware → controller → model/SQL`. All 489 database call sites were pattern-scanned for injection; every dynamic-SQL family (ORDER BY, LIMIT, IN-lists, SET columns, LIKE) was inspected individually. Payment, escrow, coupon, inventory and refund flows were traced as state machines. The frontend was audited for XSS sinks, secret exposure and unsafe storage. Findings below were verified by re-reading the implicated code after automated review — line numbers were re-confirmed manually.

**Out of scope / not performed:** dynamic exploitation against the live production URL (no unauthorized testing of the deployed instance), penetration testing of Paystack itself, social-engineering and physical tests, infrastructure/cloud configuration review beyond `vercel.json`/deployment files.

---

## 3. Findings

### CRITICAL

---

#### C-1 — Cross-vendor coupon theft chain: any user self-promotes to vendor, mints unscoped coupons, and the discount is netted from other vendors' escrow

**Severity:** Critical

**Issue:** Three defects compose into direct, repeatable theft from other vendors.

**Description:**
1. `POST /api/vendors/apply` is open to any authenticated user and immediately runs `UPDATE users SET role = 'vendor'` while the vendor row is still `status:'pending'` (`backend/controllers/vendorController.js:104-116`, promotion at `:115`).
2. `vendorOrStaff` (the middleware guarding all vendor endpoints) checks only `role`, never `vendors.status` (`backend/middleware/authMiddleware.js:156-177`, role check at `:173-176`). Ironically the *staff* branch does check `vendorStatus === 'approved'` (`:198-201`) — the owner path is the weaker one. `requireVendorPermission` auto-grants every permission to owners (`:238-240`) with no status gate.
3. `Coupon.validate()` matches on code alone — it never checks `coupon.vendorId` nor whether the cart contains that vendor's items (`backend/models/couponModel.js:157-195`). The order controller applies the discount to the **entire cart subtotal** (`backend/controllers/orderController.js:377-388`), and escrow allocation then multiplies **every** vendor's gross by `netFactor = 1 - discount/grossSubtotal` (`backend/Services/escrowService.js:155-166`).
4. Compounding: `createVendorCoupon` has no approval gate (contrast product creation at `vendorController.js:283`) and caps only *percentage* coupons at 50% — `fixed` coupons are uncapped (`vendorController.js:695-704`).

**Affected area:** `backend/controllers/vendorController.js:104-116, 684-729`; `backend/middleware/authMiddleware.js:146-177, 233-245`; `backend/models/couponModel.js:157-195`; `backend/controllers/orderController.js:377-388`; `backend/Services/escrowService.js:155-166`; `backend/routes/vendorRoutes.js:55-56, 78-81`.

**Attack scenario:**
1. Attacker registers a normal account (registration is open).
2. `POST /api/vendors/apply` → `role` becomes `vendor` instantly; no admin review is ever required to pass the role gate.
3. `POST /api/vendors/coupons {code:"FREEKENTE", discountType:"fixed", discountValue:500}` → succeeds (no approval check, no fixed-value cap).
4. An attacker-controlled (or any) buyer orders GHS 1,000 of **Vendor B's** goods applying `FREEKENTE`. `Coupon.validate` passes with no vendor-scope check.
5. Buyer pays only tax + shipping; `netFactor` halves/zeroes **Vendor B's** escrow allocation. Vendor B ships full-price goods and is paid ~0.
6. Repeat with any code, any victim, at scale. Publishing the code publicly turns it into systematic underpayment of a competitor.

**Risk:** Direct financial loss to other vendors and the platform; erosion of marketplace trust; regulatory exposure (vendor funds held in escrow are mis-allocated); trivial to automate. This is the worst-case failure mode of a multi-tenant marketplace: one tenant can unilaterally discount another tenant's goods.

**Recommended fix:**
```js
// 1) authMiddleware.vendorOrStaff — enforce approval for owner tokens
req.user = user.getProfile();
if (req.user.role === 'vendor') {
  const [[v]] = await pool.execute(`SELECT status FROM vendors WHERE userId = ?`, [req.user.id]);
  if (!v || v.status !== 'approved') { res.status(403); throw new Error('Vendor application not approved'); }
}

// 2) vendorController.applyVendor — do NOT promote role at application time
//    (updateVendorStatus at vendorController.js:204 already sets role on approval)

// 3) couponModel.validate — scope vendor coupons
if (coupon.vendorId != null && !cartItemsByVendor[coupon.vendorId]) {
  return { valid: false, coupon, message: 'This code only applies to one store' };
}

// 4) orderController — apply vendor-coupon discount only to that vendor's
//    line items; replace the global netFactor with a per-vendor discount map
//    in escrowService.createEscrowAllocations.

// 5) vendorController.createVendorCoupon — require approved status AND cap
//    fixed coupons (e.g. ≤50% of eligible subtotal or an absolute ceiling).
```

---

### HIGH

---

#### H-1 — Coupon `maxUses` cap bypassed: validated at order creation, consumed (best-effort) at payment

**Severity:** High

**Issue:** A `maxUses = 1` coupon can be honored on an unlimited number of paid orders.

**Description:** `Coupon.validate()` checks `usesUsed >= maxUses` only at order creation (`backend/models/couponModel.js:176-178`), and the discount is baked into `totalAmount` (`backend/controllers/orderController.js:377-388`). Consumption is deferred to payment (`orderController.js:435-437`) where `incrementUses` is a *conditional* `UPDATE … WHERE usesUsed < maxUses` whose `affectedRows === 0` is only logged as a warning (`couponModel.js:217-240`, warning at `:230-232`) — payment proceeds regardless (`backend/routes/paymentRoutes.js:186-193`, `:423-432`; webhook path; admin mark-as-paid `orderController.js:726-734`). No re-validation of the coupon exists in `verify-paystack` or the webhook.

**Affected area:** `backend/models/couponModel.js:176-178, 217-240`; `backend/controllers/orderController.js:377-388, 627-648, 726-734`; `backend/routes/paymentRoutes.js:186-193, 423-432`.

**Attack scenario:** Create 10 pending orders with the single-use code (all validate while `usesUsed = 0`, each stores its own discount), then pay all 10. The first payment increments the counter; the other nine hit `affectedRows === 0`, log a warning, and are still marked paid. 10× the intended redemption, funded pro-rata from vendor payouts.

**Risk:** Direct monetary loss to the platform/vendors; campaign budget exhaustion; with C-1, the attacker can both mint the coupon and multiply its use.

**Recommended fix:** Consume the use **at order creation** inside the same transaction as the order insert (conditional increment; abort creation on `affectedRows === 0`), refunding the use on cancel/expiry. At minimum, re-validate the coupon at payment confirmation and treat `affectedRows === 0` as an error that voids the discount rather than a warning.

---

#### H-2 — Checkout charges the gross total, then applies the coupon, then verifies — paid orders stuck forever (or coupon silently dropped)

**Severity:** High

**Issue:** Every coupon checkout either wedges a charged order in `pending` or charges the customer full price after showing a discount.

**Description:** The pre-created order (from `CartPage`) carries `discount: 0` (`src/Pages/CartPage/CartPage.tsx:243-246`). Checkout initializes Paystack with `serverOrder.totalAmount` (gross, `src/Pages/CheckoutPage/checkout.tsx:203-205, 460-466`). **After** payment success, the client PUTs `couponCode` (`checkout.tsx:570, 580-583`), and the server rewrites `totalAmount = subtotal + shipping + tax − discount` (net) (`backend/controllers/orderController.js:627-648`, net write at `:645`). Only then is `verify-paystack` called (`checkout.tsx:596-598`), which requires `paidKobo === expectedKobo` (`backend/routes/paymentRoutes.js:140-147`); the webhook performs the same check (`:336-349`). Two mutually exclusive outcomes: (a) webhook lands after the PUT → amount mismatch → order never flips to `paid`, money captured, escrow/stock/fulfilment never start, and the stuck-order recovery job re-checks the amount so it never heals (`escrowService.js:780-857`); (b) webhook lands before the PUT → coupon attach rejected by the `paid` guard (`orderController.js:629-633`) and silently dropped — customer paid gross after seeing net.

**Affected area:** `src/Pages/CartPage/CartPage.tsx:243-246`; `src/Pages/CheckoutPage/checkout.tsx:203-205, 460-466, 570-598`; `backend/controllers/orderController.js:627-648`; `backend/routes/paymentRoutes.js:140-147, 336-349`.

**Attack scenario / Impact:** Every legitimate coupon user is affected (integrity bug), plus: an attacker can deliberately pair a valid coupon with a completed charge to manufacture charged-but-"unpaid" orders and apply social pressure on vendors/admins to ship anyway — while controlling the actual amount paid.

**Risk:** Direct revenue/support liability (charged customers with no confirmed orders), ledger divergence, refund exposure, marketplace trust damage.

**Recommended fix:** Apply the coupon **before** charging: allow `PUT /api/orders/:id` with `couponCode` on pending orders pre-payment (the endpoint already supports it), then initialize Paystack with the refreshed `totalAmount`. Freeze all monetary fields (including coupon changes) once a `paymentReference` is attached — not only once `paymentStatus === 'paid'`.

---

#### H-3 — Product moderation is bypassed on every public catalog endpoint (rejected products stay listed and purchasable)

**Severity:** High

**Issue:** Admin product rejection has no effect on the main catalog.

**Description:** `Product.findAll` adds `AND p.approvalStatus = 'approved'` only when the caller passes the option (`backend/models/productModel.js:131-134`) — none of the public controllers do (`backend/controllers/productController.js:33-41, 110, 131, 153`). `findById` has no filter (`productModel.js:200-215`); `findTrending` is a bare `WHERE 1=1` (`:246-271`). Checkout selects `approvalStatus` but never reads it (`orderController.js:303-309`), so rejected items are orderable with escrow created. This contradicts the code that *does* enforce it: museum pieces (`productController.js:20`), storefronts (`vendorModel.js:316`), campaigns (`campaignController.js:178`).

**Affected area:** `backend/controllers/productController.js:31-43, 77-79, 108-160`; `backend/models/productModel.js:116, 131-134, 200-215, 246-271`; `backend/controllers/orderController.js:303-309`.

**Attack scenario:** Vendor submits a policy-violating product; admin rejects it with a note. The product remains publicly listable at `GET /api/products(/:id|/category|x|/featured|/trending)` and fully purchasable — moderation is cosmetic.

**Risk:** Policy-violating/counterfeit goods continue to sell after takedown; compliance and payment-processor risk (Paystack acceptable-use); admin moderation is ineffective.

**Recommended fix:** Pass `approvalStatus:'approved'` from every public controller; add a `publicOnly` mode to `findById`; reject `approvalStatus !== 'approved'` items during checkout.

---

#### H-4 — Cross-tenant file deletion via percent-encoded `/` in `DELETE /api/upload/:filename`

**Severity:** High

**Issue:** Ownership is checked on the raw route parameter, but deletion runs on `path.basename(...)` — an attacker deletes *other tenants'* images while passing their own ownership check.

**Description:** `const ownerId = filename.split('-', 1)[0]` runs on the decoded param (`backend/routes/uploadRoute.js:119`), then `path.basename(filename)` is used for the actual delete (`:126-128`). Express **5.2.1** (installed version) decodes `%2F` inside a path segment after routing, so a single segment can carry a traversal-shaped string:

```
DELETE /api/upload/7-x%2F..%2F8-product-abc.jpg
  → req.params.filename = "7-x/../8-product-abc.jpg"
  → ownerId  = "7"        (passes for user 7)
  → basename = "8-product-abc.jpg"  → victim's file deleted
```
The same flaw exists on the reference route (`:191-209`), which requires only `protect` — **any** authenticated user. `assertKeySafe` (`backend/Services/storageService.js:20-29`) accepts `products/<file>` regardless of owner. Product image names are public (returned by `toPublic()`), so targets are trivially discoverable.

**Affected area:** `backend/routes/uploadRoute.js:112-143, 191-209`; `backend/Services/storageService.js:20-50`.

**Attack scenario:** Vendor 7 reads a rival's product image URL from `GET /api/products`, sends `DELETE /api/upload/7-x%2F..%2F8-product-uuid.jpg`, and the victim's file is unlinked. Repeat across every image on a rival store → persistent defacement/DoS (DB rows keep pointing at missing files).

**Risk:** Cross-tenant data destruction with only an authenticated session; brand damage; no audit trail ties the deletion to the true owner (the log records the basename).

**Recommended fix:** Normalize *first*, then authorize:
```js
const base = path.basename(filename);
if (base !== filename || filename.includes('..') || !/^\d+-(product|reference)-[\w-]+\.[a-z0-9]+$/i.test(filename)) {
  return res.status(400).json({ message: 'Invalid filename' });
}
if (req.user.role !== 'admin' && base.split('-', 1)[0] !== String(req.user.id)) {
  return res.status(403).json({ message: 'You can only delete files you uploaded' });
}
await deleteObject(`products/${base}`);
```
Apply to both routes. Longer term: authorize deletes from a DB row (key → ownerId), not from filename parsing.

---

#### H-5 — Email change keeps `is_email_verified = 1` — defeats the OAuth linking guard (account pre-hijack)

**Severity:** High

**Issue:** A user can silently claim a victim's email address as "verified," then wait for the victim to sign in with Google and take over the resulting account.

**Description:** `email` is in the self-editable whitelist (`backend/controllers/userController.js:455`), the update bumps `tokenVersion` on email change (`backend/models/usersModel.js:357-359`) but **never clears `is_email_verified`** — a repo-wide grep confirms nothing ever sets it to `0` outside a cleanup `WHERE` clause (`backend/utils/cleanupJobs.js:24,38`). No OTP is sent to the new address. The OAuth link/adopt decision trusts that flag (`backend/config/passPort.js:37-58`, decision at `:49`): `is_email_verified = 1` → **link** branch (victim gets an account whose password the attacker knows); `0` → **adopt** branch (password rotated — safe). The bug also exempts the attacker's account from the 7-day unverified-account purge.

**Affected area:** `backend/controllers/userController.js:441-488`; `backend/middleware/validators.js:19`; `backend/models/usersModel.js:336-365`; `backend/config/passPort.js:37-58`; `src/Pages/UserProfile/UserProfile.tsx` (editable email input).

**Attack scenario:**
1. Attacker registers and completes OTP → `is_email_verified = 1`.
2. `PUT /api/users/profile {"email":"victim@example.com"}` (must be unused) → flag stays `1`.
3. Victim later signs in with Google → found by email, `is_email_verified=1` → link branch → victim operates an account whose password the attacker knows; victim's legitimate sign-up is also blocked.
4. Attacker retains persistent access to victim orders, addresses, payment profile and messages until the victim manually changes the password.

**Risk:** Full account takeover of arbitrary (not-yet-registered) users; PII/order/payment exposure; silent (the victim is never notified of the email swap).

**Recommended fix:** On any email change: set `is_email_verified = 0`, null the verification token, send an OTP to the *new* address, and block the OAuth link branch until verified. `passPort.js:49` already handles unverified accounts correctly (adopt + rotate).

---

#### H-6 — Stock reservation leaked on failed checkout → permanent inventory DoS

**Severity:** High

**Issue:** A partial reservation failure returns 400 without restoring the units already deducted for *other* items in the same request.

**Description:** `reserveStockForItems` deducts atomically per item and continues after a failure (`backend/Services/reservationService.js:38-56`). On `reservationFailures.length > 0` the controller sets `reservedUnits = reserved` and then `return res.status(400)` **without any restore** (`backend/controllers/orderController.js:339-347`). The restore exists only in the `catch` (`:446-458`) and duplicate-reference paths (`:425-429`) — a `return` triggers neither. Since no `orders` row is created, the abandoned-reservation sweeper (which only scans `orders`, `reservationService.js:67-88`) never returns the units.

**Affected area:** `backend/controllers/orderController.js:339-347`; `backend/Services/reservationService.js:38-56, 67-88`; `backend/utils/cleanupJobs.js:222`.

**Attack scenario:** Fire concurrent `POST /api/orders` each carrying `[{victim product A, qty ≤ stockA}, {contended product B, qty ≤ stockB}]`. One request wins B's atomic reserve; the loser has already deducted A's units and gets a 400 with no restore. Repeat → A's stock reaches 0 with **no orders** for those units — the product is permanently out of stock for all legitimate buyers.

**Risk:** Trivial, cheap, unattributed denial of sales against any vendor's product (competitor sabotage); no order trail to investigate.

**Recommended fix:** In the failure branch, restore `reservedUnits` exactly like the `catch` path before returning; better, make reserve+validate all-or-nothing in one transaction (rollback on any failure). Add a test asserting stock is unchanged after a mixed success/failure checkout.

---

#### H-7 — One vendor can advance and mark delivered a whole multi-vendor order, arming escrow release for every vendor

**Severity:** High

**Issue:** Order fulfilment state is shared across vendors, but authorization is "any one item is mine."

**Description:** `orderHasVendorItem` is an any-match (`items.some(...)`) check (`backend/controllers/vendorOrderController.js:26-49`, used at `:182`), yet the mutation is order-global: `Order.update` writes one shared `orderStatus` for all vendors' items and, on `delivered`, arms `escrowReleaseDeadline` for the **entire order** (`:226-249` → `escrowService.js:471-479`), after which `autoReleaseExpiredEscrows` releases **every** held allocation (`escrowService.js:485-496`). There is no per-vendor fulfilment state; `productionNote`/`expectedCompletionDate` are shared fields any vendor can overwrite. The transition check allows forward skips (`processing → delivered`, `:206-214`) — while the admin path correctly restricts delivery to `processing|shipped` (`orderController.js:778-783`).

**Affected area:** `backend/controllers/vendorOrderController.js:26-49, 182, 206-214, 226-249`; `backend/Services/escrowService.js:426-432, 471-496`.

**Attack scenario:** Order contains Vendor A (GHS 100, in stock) + Vendor B (GHS 900, made-to-order, 3 weeks). A calls `POST /api/vendors/orders/:id/status {"orderStatus":"delivered"}` immediately. The customer sees the order delivered; the escrow auto-release clock starts for **both** allocations; B's GHS 900 can release without B shipping anything — B takes chargeback/dispute exposure while A manipulated the pipeline. The same any-match also lets A overwrite the shared production notes.

**Risk:** Cross-vendor escrow manipulation; buyer protection bypass; vendor-vs-vendor disputes the platform cannot adjudicate from its own data.

**Recommended fix:** Track fulfilment per vendor slice (per-allocation status). Only elevate `orders.orderStatus` when **all** slices are delivered; arm the escrow deadline per-allocation when that vendor's slice completes. Enforce state adjacency (`nextIdx <= currentIdx + 1`) or forbid `delivered` from `processing`.

---

### MEDIUM

---

#### M-1 — OTP resend defeats its own rate limit and resets the OTP attempt counter

**Severity:** Medium

**Issue:** Unbounded OTP email sending, and the 5-guess OTP ceiling is attacker-resettable.

**Description:** `POST /api/users/resend-otp` uses `authLimiter`, which is configured `skipSuccessfulRequests: true` (`backend/middleware/rateLimitMiddleware.js:45-57`, flag at `:50`) — a successful resend returns 200 and is never counted (`backend/routes/userRoutes.js:71`). There is no per-account cooldown (`userController.js:370-397`), and each resend calls `setVerificationToken`, which resets `verification_attempts = 0` (`backend/models/usersModel.js:532-540`).

**Affected area:** `backend/routes/userRoutes.js:71`; `backend/middleware/rateLimitMiddleware.js:45-61`; `backend/controllers/userController.js:370-397`; `backend/models/usersModel.js:532-540`.

**Attack scenario:** An authenticated unverified account loops resends → SMTP quota exhaustion / deliverability burn; each resend also resets the guess counter, leaving only the per-IP 5-failures/15-min limiter standing between an attacker and the 10⁶ OTP space.

**Risk:** Email infrastructure abuse; weakened email-verification guarantee.

**Recommended fix:** Dedicated `otpResendLimiter` (e.g. 3/10 min keyed IP+user, successes counted) plus a DB cooldown (`last_otp_sent_at`, ≥60 s), and do **not** reset `verification_attempts` on resend.

---

#### M-2 — Rate limiting is backed by the in-process `MemoryStore` (no Redis configured anywhere)

**Severity:** Medium

**Issue:** All limits reset on every redeploy and are per-instance if scaled.

**Description:** `redisStore(...)` silently returns `{}` when `createRateLimitStore` returns `undefined` (`backend/middleware/rateLimitMiddleware.js:16-27`, `backend/utils/redisClient.js:45`). Neither `.env` nor `.env.example` defines `REDIS_URL` (0 matches). Limits — including `authLimiter` 5/15 min — are lost on Render redeploys and divided across instances.

**Affected area:** `backend/middleware/rateLimitMiddleware.js:16-27`; `backend/utils/redisClient.js:45`; `.env.example` (missing key); `backend/server.js:188` (warns but doesn't fail).

**Attack scenario:** Run a credential-stuffing/OTP-guessing campaign; when a deploy restarts the process, the window resets. Scale to two instances → double the allowance.

**Risk:** Brute-force protections are advisory; a core control is not durable.

**Recommended fix:** Add `REDIS_URL` to `.env.example`; fail fast (or loud boot warning) when `NODE_ENV=production && !REDIS_URL`. Same gap affects the OAuth exchange-token replay cache (`authRoutes.js:171-207`, in-process Map) — multi-instance deploy could accept a replayed exchange token.

---

#### M-3 — Google OAuth flow has no `state` parameter (login CSRF / session fixation)

**Severity:** Medium

**Issue:** Nothing binds the OAuth callback to the browser that started the flow.

**Description:** `passport.authenticate('google', …)` is called with no `state` on either leg, and the callback never validates one (`backend/routes/authRoutes.js:106-142`, options at `:122, :137`; strategy at `backend/config/passPort.js:129-142`). The only gates are the 10-minute purpose-only `oauth_consent` cookie and the one-time `jti` exchange token.

**Affected area:** `backend/routes/authRoutes.js:106-142, 146-205`; `backend/config/passPort.js:129-142`.

**Attack scenario (login CSRF):** Attacker starts their own Google flow, captures the callback/exchange link, and tricks the victim into visiting it (a top-level GET, so the CSRF Origin check does not apply). The victim ends up **signed into the attacker's account** and enters shipping/payment details there — which the attacker can re-enter at any time.

**Risk:** Account confusion leading to PII/payment capture by an attacker; weakened by (but not eliminated by) the consent cookie.

**Recommended fix:** Signed `state` cookie (HMAC under `JWT_SECRET`, 10-min TTL, random nonce) set on `/google` and verified + cleared in `/google/callback`; add PKCE `code_verifier` in the same cookie.

---

#### M-4 — Password-reset endpoint enumerates accounts (contradicts its own comment)

**Severity:** Medium

**Issue:** Two distinct 200 responses reveal whether an email is registered.

**Description:** Unknown email → `"If an account exists with this email, a password reset link will be sent."` (`backend/controllers/userController.js:216`); known email → `"Password reset link has been sent to your email address."` (`:231`). The comment at `:214` claims the opposite. Timing also differs (known branch does a DB write + SMTP path). Limited only by `passwordResetLimiter` 3/hour/**IP** (`rateLimitMiddleware.js:160-168`).

**Affected area:** `backend/controllers/userController.js:202-242`.

**Attack scenario:** Script both strings → verified-customer list for credential stuffing and highly targeted "your Kente Market order…" phishing, cross-referenced with the register oracle.

**Risk:** User enumeration defeating privacy expectations; phishing amplifier.

**Recommended fix:** Identical response body for both branches; perform DB write + email asynchronously after responding so timing converges too.

---

#### M-5 — Frontend ships `axios@1.19.0` with an active high-severity advisory

**Severity:** Medium

**Issue:** Known-vulnerable dependency in the shipped bundle; the repo's own audit doc is stale.

**Description:** Root `package.json:22` pins `^1.11.0`, installed `1.19.0`; `npm audit --omit=dev` → 1 high (axios 1.0.0–1.19.0; `fixAvailable: true`) covering GHSA-vh66-26gq-q6x8 (fetch-adapter prototype-pollution gadget altering outbound requests), GHSA-c29m-xwm3-cm6r (ReDoS) and others. Backend audit is clean (0). `PRODUCTION_HARDENING_AUDIT.md:138` claims "0 vulnerabilities" — stale.

**Affected area:** `package.json:22` (frontend); `PRODUCTION_HARDENING_AUDIT.md:138`.

**Attack scenario:** Browser-context exploitability is limited (most gadgets target Node adapters), but the fetch-adapter gadget can alter outbound requests of a shared instance; the fix is a one-line bump.

**Risk:** Known-vuln dependency in production; audit-trail credibility.

**Recommended fix:** `npm install axios@^1.20.0` (or `npm audit fix`); run `npm audit --omit=dev` in CI for both packages.

---

#### M-6 — Stored HTML injection into outbound emails (phishing from the platform's own domain)

**Severity:** Medium

**Issue:** No HTML escaping in any email template; attacker-controlled strings are emitted verbatim.

**Description:** Zero escape/sanitize helpers exist in `backend/utils/emailService.js`, `backend/utils/orderEmailService.js`, or the wishlist services. Sinks: contact-form name (`emailService.js:425`), order item name/color/`productionNote` (`orderEmailService.js:48-49, 188`), product title in price-drop/restock mails (`wishlistPriceDropService.js:59-60`, `wishlistRestockService.js:56-57`). `productionNote` is accepted with only `.trim()` (`vendorOrderController.js:197, 256`).

**Affected area:** `backend/utils/emailService.js:425`; `backend/utils/orderEmailService.js:48-49, 188`; `backend/Services/wishlistPriceDropService.js:59-60`; `backend/Services/wishlistRestockService.js:56-57`; `backend/controllers/vendorOrderController.js:197, 256`.

**Attack scenario:** Malicious vendor sets a product title to `Kente</strong></p><p><a href="https://evil.tld">Verify your payment</a>` and triggers a price-drop/restock alert — every wishlist customer receives an attacker-controlled link **from the platform's sending domain**.

**Risk:** Credential harvesting with platform credibility; brand and deliverability damage.

**Recommended fix:** Shared `escapeHtml()` applied to every interpolated value; cap free text (e.g. `productionNote.slice(0, 500)`); strip tags server-side on write.

---

#### M-7 — Negative / NaN / unbounded prices accepted on the vendor product write path

**Severity:** Medium

**Issue:** `price: -500`, `0`, `"abc"`, `1e21` all pass vendor product create/update.

**Description:** Truthiness-only validation (`backend/controllers/vendorController.js:296`) and bare `parseFloat` (`:326`, update `:414-418`); admin `Product.update` has the same gap (`backend/models/productModel.js:423-445`). Only admin *create* enforces `price > 0` (`productModel.js:307-309`). `Order.validateOrder` blocks `totalAmount <= 0`, so the direct money-loss path is closed — but negative `rentPricePerDay`/`wholesalePrice` flow into commission/escrow math (`commissionService.js`, `escrowService.js`), and bad values poison sort/analytics and create un-orderable listings.

**Affected area:** `backend/controllers/vendorController.js:296, 326, 414-418`; `backend/models/productModel.js:423-445`.

**Attack scenario:** Hostile vendor publishes negative wholesale/rent prices → downstream commission/escrow calculations misfire; or publishes broken listings that 400 on every checkout.

**Risk:** Financial-math corruption; catalog sabotage; analytics integrity.

**Recommended fix:** One `money(v, field, {min:0.01, max:…})` helper enforcing finite + bounded + positive on every float money column, used by both vendor and admin paths.

---

#### M-8 — Zod validation enforced on exactly 2 of ~60 write endpoints; `registerSchema` is dead code

**Severity:** Medium

**Issue:** Request validation is inconsistent and mostly ad-hoc.

**Description:** `validate()` is consumed only at `backend/routes/userRoutes.js:86` and `:91`; `registerSchema` (`backend/middleware/validators.js:39`) is never imported. All other POST/PUT routes (`/api/orders`, `/api/vendors/products`, `/api/coupons`, `/api/campaigns`, `/api/custom-requests`, `/api/support`, `/api/reviews`, `/api/addresses`, …) validate ad-hoc inside controllers — some not at all.

**Affected area:** `backend/middleware/validators.js`; all write routes under `backend/routes/`.

**Attack scenario:** Type confusion, unexpected fields (mass-assignment surface), oversized arrays: `req.body.items` on order creation has no cap and each element issues a stock-reservation UPDATE (`orderController.js:261-267`) → one request = thousands of writes.

**Risk:** Defense-in-depth loss; future refactors silently drop existing checks; DoS via unbounded collections.

**Recommended fix:** Adopt `validate(schema).strict()` on every POST/PUT route (unknown fields rejected), enable `registerSchema`, cap arrays (`.slice(0,50)` → 400) and free-text lengths.

---

#### M-9 — Coupon attached after creation never recomputes escrow allocations (stale gross vendor liabilities)

**Severity:** Medium

**Issue:** Books diverge: platform collects net, ledger records gross.

**Description:** `createEscrowAllocations` runs only at order creation (`orderController.js:443`); the PUT coupon path updates `discount`/`totalAmount`/`couponId` (`:627-648`) with **no** escrow recomputation; `updateOrderToPaid` performs no `Σ allocations == collected` invariant check (`orderController.js:692-713` admin path likewise).

**Affected area:** `backend/controllers/orderController.js:443, 627-648, 692-713`; `backend/Services/escrowService.js:123-218`.

**Attack scenario:** Any coupon applied via the PUT path (the normal checkout path — see H-2) leaves per-vendor allocations at gross; on release, vendors can be credited more than the platform collected.

**Risk:** Ledger drift, reconciliation failures, amplified by C-1/H-1 discount abuse.

**Recommended fix:** Void/recreate allocations atomically with the money-field update; enforce `Σ allocations + platform share == collected` before flipping to `paid`.

---

#### M-10 — Buyback: repeatable redemption per purchased line; stock restored before goods are returned

**Severity:** Medium

**Issue:** One physical item can be redeemed for buyback repeatedly, and inventory is credited at *approval* rather than at physical return.

**Description:** Dedupe filters `status = 'pending'` only (`backend/controllers/buybackController.js:45-52`) — a previously **approved** request doesn't block a new one for the same `orderId + productId`; each request claims its own approval (`:127-151`) and runs `UPDATE product SET stock = stock + ?` unconditionally (`:152-155`), while the notification says "ship it back *and* your balance will be credited" — no return/inspection state exists.

**Affected area:** `backend/controllers/buybackController.js:45-52, 118-169`.

**Attack scenario:** Buy 1 unit → request buyback → admin approves (`stock +1`) → request again (dedupe only blocks pending) → approve → `stock +1` again. Each approval can also drive a payout for goods never shipped; inflated stock oversells phantom units.

**Risk:** Fraudulent payouts; inventory inflation; admin queue is indistinguishable from legitimate requests.

**Recommended fix:** Block creation when any prior request exists for `(customerId, orderId, productId)` with `status IN ('pending','approved')`; restore stock only on a terminal `received` state; DB-level guard on an order-line redeemed counter.

---

#### M-11 — Refund TOCTOU: return-approval and admin-cancel can both call Paystack for the same order

**Severity:** Medium

**Issue:** Non-atomic `read status → refund → write status` on two independent paths.

**Description:** `backend/controllers/returnController.js:141-163` reads `paymentStatus === 'paid'` at `:143`, refunds, *then* flips at `:159-163`; `backend/controllers/orderController.js:941-971` does the same. Divergent ledger dedupe keys (`refund:${order.id}:${returnId}` vs `refund:${order.id}`). The only double-payout guard today is Paystack-side (second full refund exceeds refundable balance).

**Affected area:** `backend/controllers/returnController.js:141-172`; `backend/controllers/orderController.js:941-971`.

**Attack scenario:** Two admins (or a compromised admin session) approve a return and cancel the order near-simultaneously → two `refundTransaction` calls in flight; state/ledger may diverge if the provider rejects the second.

**Risk:** Double-refund exposure once the provider allows partial refunds; inconsistent order state.

**Recommended fix:** Atomic claim first — `UPDATE orders SET paymentStatus='refunding' WHERE id=? AND paymentStatus='paid'` and proceed only on `affectedRows = 1`; single ledger dedupe key `refund:${orderId}` per order.

---

#### M-12 — Coupon validation oracle: distinct error messages + 3-character code space

**Severity:** Medium

**Issue:** Existence/state oracle for coupon codes with a tiny search space.

**Description:** Code regex `^[a-zA-Z0-9]{3,50}$` (`backend/controllers/couponController.js:12`); distinct messages for not-found / expired / limit-reached / min-purchase (`couponController.js:124-132`, `couponModel.js:164-186` — the min-purchase message even echoes the threshold). Two independent oracles: `/api/coupons/validate` (20/15 min/IP) and order creation (`orderController.js:379, 636`, 10/min/IP) — both defeated by IP rotation.

**Affected area:** `backend/controllers/couponController.js:12, 124-132`; `backend/models/couponModel.js:164-186`; `backend/controllers/orderController.js:379, 636`.

**Attack scenario:** Enumerate 62³ ≈ 238k codes across IPs; harvest live codes (especially valuable combined with H-1 multi-redemption).

**Risk:** Coupon theft; combined with H-1/C-1 → monetary loss.

**Recommended fix:** Enforce `min(8)` on new codes; single generic "invalid or inactive coupon" for all failures; rate-limit per attempted code as well as per IP.

---

#### M-13 — Costly/sensitive endpoints rely solely on the global 600/15-min-per-IP limiter

**Severity:** Medium

**Issue:** No targeted rate limits on payment verification, AI spend, and high-volume creation endpoints.

**Description:** `verify-paystack` triggers an outbound Paystack API call per request (`paymentRoutes.js:90-102`) with only `apiLimiter`; `POST /api/tryon/generate` costs real money (Replicate, `tryOnController.js:186-200`) bounded only by a per-account daily limit (10) while accounts are farmable at `registerLimiter` 10/15 min/IP — no per-IP or platform-wide spend cap; reviews/messages/custom-requests/suggestions/support/product+coupon creation have no dedicated limiter.

**Affected area:** `backend/routes/paymentRoutes.js:90`; `backend/routes/tryOnRoutes.js:15`; `backend/controllers/tryOnController.js:36-47, 171-200`; `backend/routes/reviewRoutes.js:25,28`; `backend/routes/messageRoutes.js:18`; `backend/middleware/rateLimitMiddleware.js:29-43`.

**Attack scenario:** Botnet exhausts Paystack API quota via repeated verify calls; or farms accounts to run unbounded paid AI generations.

**Risk:** Direct monetary loss (AI), third-party quota exhaustion (Paystack), content flooding.

**Recommended fix:** Dedicated limiters: `paymentVerifyLimiter` (15/min), `aiSpendLimiter` (per IP/day + global daily spend guard), `createLimiter` (5/min) on review/message/support/custom-request/product/coupon creation.

---

### LOW

| ID | Issue | Affected area | Attack scenario / Risk | Recommended fix |
|---|---|---|---|---|
| **L-1** | Vendor can jump `processing → delivered` (order check rejects only backward moves), arming escrow auto-release without shipping | `vendorOrderController.js:206-214, 236-249`; `escrowService.js:471-479` | Vendor marks delivered instantly → auto-release pays for undelivered goods | Enforce adjacency; forbid `delivered` from `processing`/`packaging` (match admin path `orderController.js:778-783`) |
| **L-2** | Negative `totalAmount` possible via PUT coupon path; admin percentage coupons can exceed 100% | `orderController.js:644-645`; `couponController.js:17-19`; `couponModel.js:164-188` | Corrupt orders; breaks verify/refund/escrow math | Route PUT through `calcOrderTotals` (clamps); reject `discountValue > 100` |
| **L-3** | Double stock restore when escrow creation fails after order insert (in-memory restore + marker-based sweeper both fire) | `orderController.js:433-459`; `reservationService.js:67-121` | Stock inflation → oversell phantom units | Exactly one owner of the release: delete/rollback the order row or zero `reserved` markers in the same transaction |
| **L-4** | Platform (admin) coupon codes leaked to every vendor (`OR vendorId IS NULL`) | `vendorController.js:671` | Vendors republish/farm admin campaign codes | `WHERE vendorId = ?` only |
| **L-5** | Two vendor routes missing `requireVendorPermission` while siblings enforce it | `vendorRoutes.js:62, 71` | Zero-permission staff rewrite storefront profile (defacement/phishing) and read all reviewer identities | Add `requireVendorPermission('manage_products' / 'view_customers')` |
| **L-6** | Logout mishandles staff tokens: bumps `users.tokenVersion` for an unrelated user id, leaves the staff session alive | `userController.js:165-179`; `staffController.js:57-70` | Stolen staff cookie survives logout (8h); innocent user force-logged-out | Branch on `decoded.role === 'vendor_staff'` → bump `vendor_staff.tokenVersion` |
| **L-7** | Per-account lockout (10 fails → 1h) with only per-IP throttling → cross-account DoS; no victim notification | `usersModel.js:476-501`; `rateLimitMiddleware.js:45-57` | Botnet locks any customer out hourly, indefinitely | Alert account on lock; add email+IP keyed limiter; progressive delay over hard lock |
| **L-8** | Login timing oracle: no bcrypt compare for unknown emails | `usersModel.js:470-480` | Remote account enumeration bypassing register throttle | Compare against a dummy cost-12 hash when user missing |
| **L-9** | `GET /api/users/reset-password/:token` returns `valid:true/false` — validity oracle contradicting its own comment | `userController.js:308-326` | Confirms leaked/partially-exfiltrated tokens before the mutating POST | Always identical response; POST is the only oracle |
| **L-10** | OAuth exchange token fragment never cleared from URL (history/screenshots); token is session-equivalent for 10 min | `authRoutes.js:84-93`; `src/Pages/Auth/OAuthCallback.tsx:76-92` | Credential lingers in history/support exports | `history.replaceState(...)` immediately; reject `purpose`-marked tokens at the session verification entry |
| **L-11** | OAuth linking never checks the provider's `email.verified` flag | `passPort.js:18, 31-58, 91-95` | A provider returning an unverified email would let an attacker claim an arbitrary address (defense-in-depth) | Require `profile.emails[0].verified !== false` before link/adopt |
| **L-12** | Upload extension/MIME filter is an **unanchored** regex (`/jpeg\|jpg\|png\|gif\|webp/`) | `uploadMiddleware.js:31-33` (contrast correct anchored version `profileRoutes.js:49-57`) | `photo.jpg2` accepted (mitigated today by magic bytes + `nosniff`) — the class of relaxation that becomes HTML/SVG smuggling if either guard changes | Anchor: `/\.(jpe?g\|png\|gif\|webp)$/i` + `/^image\/(jpe?g\|png\|gif\|webp)$/` |
| **L-13** | Raw driver/provider error text returned to clients on two endpoints | `uploadRoute.js:139-141` (`'Failed to delete image: ' + error.message`); `paymentRoutes.js:253-257` (Paystack error passthrough) | Storage paths / provider internals leaked to callers | Generic messages; log details server-side |
| **L-14** | Reviews: no purchase required on `POST /api/reviews`, auto-approved, no dedicated rate limit | `reviewRoutes.js:25`; `reviewModel.js:67, 88` | Reputation manipulation of any product by any account | Require verified order (like `addOrderReview`) or insert `status='pending'`; add per-account limiter |
| **L-15** | Unbounded free-text/collection fields (`productionNote`, support subject/message, `conditionNote`, order `items[]`) | `vendorOrderController.js:197`; `supportController.js:7-20`; `buybackController.js:34`; `orderController.js:261-267` | DB bloat / reservation-write amplification | `.slice(0, N)` + explicit 400; `items.length > 50 → 400` |
| **L-16** | Campaign list routes have no auth → `req.user` always undefined, admin branch is dead code (no leak, functional bug) | `campaignRoutes.js:15,19`; `campaignController.js:121-122, 161, 168` | Admins can never list drafts via API | Add `optionalAuth` (or `protect, admin` for `?all=1`) |
| **L-17** | Admin-only mass assignment (defense-in-depth): `req.body` spread into `Promotion.create/update` and `Product.create/update` | `promotionController.js:64, 76`; `productController.js:178, 218` | No escalation today (both behind `protect, admin`); any future route reuse becomes instant mass assignment | Whitelist fields at the controller boundary |

---

## 4. Areas Verified — Checked and Clean

These were examined in depth and found **not** exploitable; they represent genuine security strengths to preserve:

- **SQL injection — clean.** All 489 `query/execute` sites reviewed; every dynamic-SQL family is parameterized or allow-listed: `ORDER BY` via `allowedSortColumns` membership (`orderModel.js:136-138`), `LIMIT/OFFSET` after integer clamping, `IN (…)` as repeated `?`, `SET`/`INSERT` column lists from hardcoded arrays, `SELECT ${table}/${column}` with literal args, no `JSON_EXTRACT`, migrations not web-reachable.
- **Command/template/eval injection — clean.** No `child_process`, `exec*`, `spawn*`, `eval(`, `new Function(` anywhere in backend or SPA; no server-side templating.
- **Path traversal — clean** except H-4: `storageService.assertKeySafe`, `profileRoutes.resolveProfilePath`, placeholder middleware `resolve + startsWith` check.
- **Payment authenticity — strong.** Webhook HMAC-SHA512 over `req.rawBody` with `timingSafeEqual` (`paymentRoutes.js:276-284`); verify requires ownership + exact kobo amount + `GHS` currency (`:137-147`); one-reference→one-order with UNIQUE DB key (`:121-129`); `webhook_events` idempotency claim (`:295-309`); `paymentStatus` forced `pending` at creation; no client-settable paid flag.
- **Server-side pricing — strong.** All money math in `shared/pricing.js` (single `round2`, clamped `calcOrderTotals`); order creation re-prices from DB rows (`orderController.js:300-388`); per-item qty cap 99; owner PUT whitelists monetary/escrow fields (`:566-586`).
- **Passwords — strong.** bcrypt cost 12 on every path (create/update/reset/OAuth/staff) with legacy cost-10 upgrade; no plaintext comparisons; no `Math.random()` for security values; policy ≥8 chars + letter + number enforced consistently.
- **JWT/sessions — strong.** HS256 with string secret (no `alg:none`/confusion); `JWT_SECRET` hard-required in production; `tv` claim set on **every** issuing path and enforced in `protect`/`optionalAuth`/`vendorOrStaff`; password/email/reset/OAuth-adoption/logout all bump `tokenVersion`; old tokens fail closed; covered by `backend/tests/authSessionRevocation.test.js`.
- **Cookie flags — correct.** All four `res.cookie('jwt')` sites are `httpOnly` + `secure` (prod) + `sameSite` + `path:'/'`; no session token in any response body; guest/consent cookies httpOnly.
- **CSRF — sound.** Signed double-submit + Origin/Referer allow-list; boot-time invariant fails if `COOKIE_SAME_SITE=none` without the mount (`server.js:287-290`); upload route mounted with its own limiter+CSRF before the body parser (`server.js:201`).
- **CORS — sound.** Explicit allow-list, concrete origin reflection, credentials only for allowed origins, no `*` with credentials, preview origins excluded.
- **Frontend XSS — clean.** Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write` in app code; no markdown/HTML renderer exists; reviews/messages/descriptions rendered as JSX text children; the only user-controlled URL is scheme-filtered to `http(s)`; iframe src rebuilt from a `[\w-]` YouTube ID extract; CSP at the Vercel edge without `'unsafe-inline'` in `script-src`.
- **Secrets — clean.** No `.env` ever committed (`git log --all --diff-filter=A` empty); no hardcoded keys; secrets on disk are strong/random; only `VITE_API_URL`, `VITE_PAYSTACK_PUBLIC_KEY` (public by design), social URLs in the bundle.
- **Local storage — acceptable.** JWT explicitly stripped before persist (`authSlice.ts:36-37`); `userInfo` PII with 7-day TTL and logout clearing; no tokens/passwords.
- **Upload pipeline — strong overall.** Staged to tmp (not served dir), magic-byte + IHDR/SOF dimension validation with 8192px decompression-bomb cap (`imageValidator.js:106-138`), server-generated `crypto.randomUUID()` filenames, key allow-list, size cap 5MB, auth+role gates; SVG/HTML/JS impossible through every path.
- **SSRF — clean.** Try-on image URLs restricted to `https` + public hosts, rejecting metadata/loopback/RFC1918/CGNAT (`tryOnController.js:80-141`); no other user-controlled outbound fetchers.
- **Error handling / logging — mostly correct.** `errorMiddleware` genericizes 5xx, filters SQL/stack patterns from 4xx; logger redacts `token/secret/password/jwt`; `sendDefaultPii: false`; no `Authorization`/cookie/body logging.
- **Per-user resources — correctly scoped.** Address, design, notification, payment-method, wishlist, cart models all `WHERE id = ? AND userId = ?`; orders enforce ownership or admin; staff/messages/custom-requests/returns/support/certificates/buyback ownership verified end-to-end; admin routers carry `protect, admin`.

---

## 5. OWASP Top 10:2021 Checklist

| # | Category | Status | Evidence / Findings |
|---|---|---|---|
| **A01** | **Broken Access Control** | ❌ **FAIL** | C-1 (self-promotion to vendor, no `vendors.status` check in middleware), H-4 (cross-tenant file delete), H-7 (cross-vendor order/escrow mutation), L-4/L-5 (platform coupon leak, missing permission gates), L-16 (dead admin branch) |
| **A02** | **Cryptographic Failures** | ⚠️ **PARTIAL** | Strengths: bcrypt-12, HS256 JWT, HMAC webhook, SHA-256 reset tokens, TLS config in `config/mysqlTls.js`. Gaps: M-5 (vulnerable axios), L-8 (timing oracle), M-4/L-9 (enumeration oracles leak account existence) |
| **A03** | **Injection** | ⚠️ **PARTIAL** | SQLi: ✅ clean (489 sites parameterized/allow-listed). Command/eval: ✅ clean. Residual: M-6 (HTML injection into emails), M-8 (validation coverage), L-13 (raw error text) |
| **A04** | **Insecure Design** | ❌ **FAIL** | C-1, H-1 (coupon consumption design), H-2 (payment ordering design), H-7 (shared order state in multi-vendor model), M-10 (buyback lifecycle), M-11 (refund claim) — systemic absence of per-tenant/per-slice state and atomic consume-on-validate |
| **A05** | **Security Misconfiguration** | ⚠️ **PARTIAL** | Strengths: Helmet+CSP, HPP, boot-time secret fail-fast, CORS allow-list. Gaps: M-2 (no Redis → limits reset), `.env.example` missing `REDIS_URL`, L-17 (mass-assignment surface on admin routes) |
| **A06** | **Vulnerable Components** | ⚠️ **PARTIAL** | Frontend: 1 high (`axios@1.19.0`, M-5). Backend: 0 vulnerabilities. Stack generally modern (Express 5, React 19, jsonwebtoken 9, Vite 7). CI audit missing |
| **A07** | **Identification & Authentication Failures** | ❌ **FAIL** | H-5 (email change keeps verified flag → account hijack), M-3 (no OAuth `state`), M-4 (reset enumeration), M-1 (OTP resend/attempt reset), L-6 (staff logout), L-7 (lockout DoS), L-10/L-11 (OAuth hygiene). Strengths: token-version revocation, cookie flags, lockout, rate limits (when durable) |
| **A08** | **Software & Data Integrity Failures** | ⚠️ **PARTIAL** | Strengths: webhook signature over raw body, idempotent event claims, no CI/CD files in scope to review. Gaps: H-1/M-9 (deferred, non-atomic business-logic state), M-11 (TOCTOU refund), L-3 (double-restore) |
| **A09** | **Security Logging & Monitoring Failures** | ⚠️ **PARTIAL** | Present: `utils/auditLog.js`, structured request logs, Sentry with PII off, webhook event journal, admin audit-log endpoint (admin-only). Missing: no alerting on failed auth spikes, no dedicated security event trail for tenant-boundary violations (e.g. H-4 deletes log only the basename), no fraud/metrics dashboards |
| **A10** | **SSRF** | ✅ **PASS** | Only outbound user-influenced fetch (AI try-on) allow-lists `https` + public hosts and rejects loopback/metadata/RFC1918/CGNAT (`tryOnController.js:80-141`); no other user-controlled URL fetchers |

---

## 6. Marketplace-Specific Threat Model

### 6.1 Assets

| Asset | Sensitivity | Tenants |
|---|---|---|
| Vendor payout data (bank/momo, recipient codes, balances) | Critical | Per-vendor |
| Escrow/ledger/commission records | Critical | Platform + per-vendor |
| Customer PII (name, email, phone, addresses, order history) | Critical | Per-customer |
| Payment data & Paystack references | Critical | Shared |
| Product catalog, pricing, sales insights | High | Per-vendor |
| Coupon/promotion campaigns | High | Platform + per-vendor |
| Moderation/admin controls | Critical | Platform |
| Reputation (reviews, ratings, certificates) | High | Per-vendor |
| Messaging threads (buyer↔vendor) | High | Per-pair |
| Uploaded media | Medium | Per-vendor/customer |

### 6.2 Actors & Motives

| Actor | Capability | Motive |
|---|---|---|
| **Anonymous attacker** | Open registration | Enumerate users/coupons, spam, probe APIs |
| **Malicious customer** | Full customer session | Price/coupon abuse (H-1, M-12), free goods, refund fraud (M-11), chargebacks |
| **Malicious vendor (unapproved)** | `role='vendor'` via C-1 | Mint coupons, steal images (H-4), sabotage rivals (H-6), harvest platform data |
| **Malicious vendor (approved)** | Full vendor panel | Undercut rivals via coupons (C-1), manipulate shared orders (H-7/L-1), fake delivered (L-1), reputation attacks (L-14), phishing via storefront/email (M-6, L-5) |
| **Vendor staff** | Scoped permissions | Scope creep via missing permission gates (L-5) |
| **Malicious admin / compromised admin session** | Full platform | Coupon manipulation (L-2), double refund (M-11), bulk PII access — *mitigated today by admin-only routes but no step-up auth* |
| **Account hijacker** | Any email/OAuth identity | Email-change pre-hijack (H-5), login CSRF (M-3), token theft (L-10) |
| **Bot/scraper operator** | Cheap compute | AI spend abuse (M-13), inventory DoS (H-6), data scraping |
| **Paystack/webhook imposter** | Public internet | Forged payment events — *blocked by HMAC (clean)* |

### 6.3 Trust Boundaries

1. **Browser → API** (cross-site, `SameSite=None`) → CSRF is the only browser defense → double-submit implemented; verified sound.
2. **API → MySQL** → injection boundary → clean.
3. **API ↔ Paystack** (webhook + verify) → authenticity boundary → clean; **but** internal amount-consistency boundary (H-2) fails.
4. **Tenant ↔ Tenant** → the weakest boundary in the system: shared `orders.orderStatus`, filename-derived ownership, role-only middleware, vendor-blind coupons (C-1, H-4, H-7).
5. **User ↔ Own account** → email/verification boundary broken (H-5).
6. **Vendor → Platform inbox/email** → HTML injection into platform-branded email (M-6).

### 6.4 Abuse Cases (map → finding)

| # | Abuse case | Finding |
|---|---|---|
| 1 | Register → become vendor → mint a code → buy a rival's goods at a discount the rival never authorized | **C-1** |
| 2 | Redeem a single-use coupon N times | **H-1** |
| 3 | Get charged but never have the order confirmed (or pay gross after seeing net) | **H-2** |
| 4 | Get a rejected product delisted, but it keeps selling | **H-3** |
| 5 | Delete a rival's product images without touching your own files | **H-4** |
| 6 | Claim a victim's email as verified, wait for their Google login | **H-5** |
| 7 | Drive a product's stock to zero with no orders behind it | **H-6** |
| 8 | Mark another vendor's slice delivered to start their escrow clock / overwrite their production notes | **H-7** |
| 9 | Trigger unlimited OTP emails / reset the OTP guess counter | **M-1** |
| 10 | Enumerate customers and coupon codes at scale | **M-4, M-12, L-8** |
| 11 | Burn platform money on AI generations with farmable accounts | **M-13** |
| 12 | Phish customers from the platform's own sending domain | **M-6** |
| 13 | Redeem one physical item for repeated buybacks | **M-10** |
| 14 | Force any customer out of their account hourly | **L-7** |
| 15 | Extract a leaked reset/OAuth token before burning it | **L-9, L-10** |

---

## 7. Security Improvements Before Public Launch

### 🔴 Blockers (must fix before launch — retest required)

1. **C-1** — Enforce `vendors.status === 'approved'` centrally in `vendorOrStaff`; stop promoting `role='vendor'` at application time; scope vendor coupons to their own line items; replace the global escrow `netFactor` with per-vendor discount netting; cap fixed vendor coupons; gate `createVendorCoupon` on approval.
2. **H-1** — Consume coupon usage atomically at order creation (conditional increment inside the order transaction; abort on failure); re-validate at payment; treat `affectedRows === 0` as an error.
3. **H-2** — Apply the coupon **before** initializing Paystack; freeze monetary fields once a `paymentReference` exists; never rewrite `totalAmount` between charge and verification. Audit existing stuck orders and refund/confirm them manually.
4. **H-3** — Enforce `approvalStatus='approved'` on every public product endpoint and at checkout.
5. **H-4** — Normalize filename first, validate strictly (`basename === input` + regex), then authorize; apply to both delete routes; (ideally authorize via DB row).
6. **H-5** — Reset `is_email_verified = 0` + re-OTP on every email change; block OAuth link branch until the new address is verified.
7. **H-7** — Per-vendor-slice fulfilment status; per-allocation escrow release; enforce state adjacency.

### 🟠 High priority (first sprint after launch-blocking fixes)

8. **H-6** — Restore reservations on the partial-failure path; wrap reserve+validate in one transaction; add regression test.
9. **M-2** — Provision Redis, set `REDIS_URL`, add to `.env.example`, fail loud in production without it (this also fixes the OAuth exchange replay cache).
10. **M-1** — Dedicated resend limiter with successes counted + DB cooldown; stop resetting `verification_attempts` on resend.
11. **M-4 / L-8 / L-9** — Uniform responses on reset/register, dummy-hash timing equalization, remove the token-validity oracle.
12. **M-5** — Bump `axios@^1.20.0`; add `npm audit --omit=dev` to CI for both packages; correct the stale claim in `PRODUCTION_HARDENING_AUDIT.md`.
13. **M-6** — `escapeHtml()` in every email template; cap free-text fields.
14. **M-9** — Recompute escrow allocations on any money-field change; enforce `Σ allocations == collected` before flipping to `paid`.
15. **M-11** — Atomic refund claim (`paymentStatus='refunding'` CAS) before calling Paystack; one dedupe key per order.

### 🟡 Second sprint (hardening)

16. **M-3** — Signed `state` + PKCE on the Google flow.
17. **M-7 / M-8** — `money()` validation helper on every price field; `validate(schema).strict()` on all write routes; enable `registerSchema`; cap arrays/free-text.
18. **M-10** — Lifetime buyback cap per order line; restore stock only on physical `received`.
19. **M-12** — Min code length 8; generic validation errors; per-code rate limiting.
20. **M-13** — Targeted limiters on `verify-paystack`, AI generate (per-IP + global daily spend cap), and bulk-creation endpoints.
21. **L-1 … L-17** — All are small, localized patches; batch them into one hardening PR (each fix is given inline in the findings table).

### 🟢 Program-level (before scale)

22. **Authorization regression suite** — automated tests asserting: *every* vendor-scoped query filters `vendorId`; *every* customer-scoped query filters `userId`; pending vendors are rejected by every vendor route. The root cause of C-1/H-7/L-5 is inconsistent enforcement — make the invariant machine-checked.
23. **Security headers/CI gates** — `npm audit` (both packages), secret scanning (`gitleaks`), and an ESLint rule banning raw `pool.query(\`…${`) template interpolation.
24. **Logging/alerting** — alert on: repeated cross-tenant 403s, coupon validation failures per code, AI spend rate, webhook signature failures, mass 404s on upload deletes (H-4 reconnaissance).
25. **Admin controls** — step-up re-auth for admin sessions touching money (refund/commission/settings), immutable audit entries for every admin action on vendor/customer data.
26. **Dependency policy** — renovate/dependabot + monthly audit; pin and review transitive deps.
27. **Payment reconciliation job** — daily invariant: charged-but-unconfirmed orders (H-2 class), `Σ escrow allocations` vs collected totals, coupon `usesUsed` vs distinct paid orders redeeming it.
28. **Pre-launch penetration test** — re-run this methodology dynamically against a staging environment after fixes; specifically retest C-1 → H-1 → H-4 chains.

---

## 8. Appendix — Verification Notes

- Findings were confirmed by direct re-reads of the implicated code after review; key confirmations: `vendorController.js:115` role promotion · `couponModel.js:157-195` no vendor scope · `uploadRoute.js:119/126` check-vs-delete asymmetry · `orderController.js:339-347` missing restore on `return` (restore exists only in `catch` at `:446-458`) · `usersModel.js` never clears `is_email_verified` on update · `authRoutes.js` Google options contain no `state` · `userController.js:216/231` differing reset messages · `checkout.tsx:203-205, 460-466, 580-598` gross-charge → coupon-attach → verify ordering · `CartPage.tsx:243-246` `discount: 0` on pre-created orders · Express installed version **5.2.1** (required for the `%2F` decode behavior in H-4).
- Severity ratings follow CVSS-style reasoning adjusted for the multi-tenant context: **Critical** = direct cross-tenant financial/data theft by an unprivileged actor; **High** = exploitable by a single authenticated/registered user with material financial, integrity, or availability impact; **Medium** = requires specific conditions or yields limited impact; **Low** = hardening gaps, defense-in-depth, or limited scenarios.
- Not tested dynamically against the production URL; exploit paths are derived from source-level verification. Live verification of H-4 (percent-encoding) was reproduced against the installed Express version locally, not against production.
- Total: **1 Critical · 7 High · 13 Medium · 17 Low**.
