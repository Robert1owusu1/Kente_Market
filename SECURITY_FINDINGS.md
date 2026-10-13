# Security Findings — release-candidate mission (2026-10-11)

Scope and method: targeted code review of the payment, refund, escrow, custom-order and
order-ownership paths, a route-by-route middleware sweep, ownership checks on every vendor
`:id` handler, dependency and secret scanning, and regression tests for every confirmed
defect. **This is not a full penetration test or certification**; nothing was run against
the live site. Historical findings in `SECURITY_AUDIT_REPORT.md`, `FINAL_REDTEAM_REPORT.md`,
`REDTEAM_VERIFICATION_REPORT.md` and `security/KENTE_MARKET_SECURITY_REPORT.md` are
preserved; the ones re-verified here are listed in §3. No secret values or customer data
appear in this document.

## 1. Confirmed and fixed

| ID | Severity | Finding | Affected code | Fix | Regression test |
|---|---|---|---|---|---|
| S-1 | **High** (data safety) | `npm test` connected to whatever `backend/.env` names — on this machine the hosted TiDB database — and DB suites create/delete users, orders and refunds | `backend/package.json` test scripts | Preloaded guard refuses any non-loopback `DB_HOST` unless `ALLOW_REMOTE_TEST_DB=1` | Verified: suite exits 1 with a clear message against the TiDB host, no connection made; `tests/helpers/testDbGuard.mjs` |
| S-2 | **High** (data safety) | `npm run db:setup` executes `DROP DATABASE IF EXISTS $DB_NAME`, guarded only by `NODE_ENV=production`; the dev `.env` leaves `NODE_ENV` empty while pointing at TiDB | `backend/setupDB.js` | Refuses unless `DB_HOST` is loopback or `ALLOW_DESTRUCTIVE_DB=1`; validates `DB_NAME` | Refusal verified before any connection is opened |
| SEC-1 | Medium | Order owner could overwrite vendor-owned `expectedCompletionDate` and `productionNote` via `PUT /api/orders/:id` (denylist gap) | `orderController.updateOrder` | Added both to the owner denylist | `tests/orderOwnerFields.test.js` (mutation-verified) |
| SEC-2 | Medium (financial integrity) | Admin mark-paid CAS `WHERE paymentStatus != 'paid'` matched `refunded`; a refund landing between the handler's read and its UPDATE was resurrected to paid and paid side effects re-ran (paid-state resurrection class) | `orderController.updateOrderToPaid` | CAS excludes `refunded` | `tests/adminMarkPaidRace.test.js` (deterministic race; mutation-verified) |
| C-0 | **Critical** (availability) | `customRequestController.js` imported names `escrowService.js` does not export → ESM link error → **the backend could not boot** (`server.js` mounts the route) | uncommitted rewrite | Import from the defining modules | `tests/moduleGraph.test.js` loads every route module and every `server.js` import (mutation-verified) |
| C-1 | **Critical** (financial) | Custom-order checkout referenced `paymentMethod` outside its block scope → `ReferenceError` inside the order transaction **after** Paystack verified the charge: customer charged, no order | same | Function-scope variables | `tests/customRequestCheckoutHandler.test.js` drives the real handler (mutation-verified) |
| C-3 | High (financial) | Paid-order side effects were never recorded, so the (unwired) recovery job would have re-run stock/coupon/revenue on every historical paid order; a crash after the paid flip left stock/coupon/revenue unapplied forever | `paymentRoutes.js`, `orderController.js`, `escrowService.js` | Shared marker-tracked `applyPaidOrderSideEffects`; bounded recovery for tracked orders only | `tests/paidSideEffects.test.js` (8 tests, 2 mutation checks) |
| SEC-4 | Low | `vendorOrStaff` staff branch rewrote every staff failure (deactivated staff, inactive store — both 403) to 401 'staff token failed', which the SPA treats as session expiry; it also called `next()` inside its own `try`, so a synchronous downstream throw was re-reported as an auth failure | `middleware/authMiddleware.js` | Same contract as the owner branch: decided status and message kept; only an undecided (driver) failure becomes a generic 401 without its text; `next()` outside the `try` | `tests/staffAuthStatus.test.js` (8 tests, mutation-verified; added 2026-10-12) |
| R-5 | Medium (integrity / ops) | Return approval with a rejected/unknown refund answered "Return request status updated" (green toast); failure only in server logs | `returnController.updateReturnStatus`, admin Returns page | Response carries `refundOutcome` + explicit message; UI warns | `tests/returnRefundOutcome.test.js` |
| SEC-7 | Medium | `errorHandeler` (uncommitted previous-model change) used `err.status` whenever the response was still 200. An unhandled `AxiosError` carries the **upstream provider's** status, so a Paystack/Replicate 401 reached the browser as 401 — which the SPA treats as session expiry and logs the customer out — and a provider 404/400 was reported as the customer's fault | `middleware/errorMiddleware.js` | Only http-errors instances (boolean `expose`, what body-parser throws) set the status; everything else is a generic 500 | `tests/tryOnUploadSecurity.test.js` — 4 AxiosError cases (mutation-verified); a real `express.json` 413/400 was confirmed to still pass through |
| SEC-8 | Low-Medium | `cacheMiddleware` cached every `res.json` body, including 404/500 bodies; a cache hit replays with status 200, so one transient DB error on a cached GET (product detail, category, …) was served to every visitor as a successful response for the TTL | `middleware/cacheMiddleware.js` | Cache only 2xx | `tests/cacheMiddleware.test.js` (mutation-verified) |
| SEC-9 | Low | `npm run password:reset:test` — a manual script named like a test — issued a **live** reset token for a hard-coded real email address through whatever database `.env` names (here the hosted DB), sent a real email, and printed 20 characters of the token | `scripts/password-reset-flow.js` | Target address is now a required argument; the token is never printed | manual utility (syntax-checked; deliberately not run) |

### 1a. Independent final verification (2026-10-12) — reproduced, fixed, regression-tested

All seven (FV-1…5, FV-11, FV-12) reproduced on the unfixed code first (`backend/tests/finalVerificationRaces.test.js` failed), then fixed; details in `PRODUCTION_READINESS_TRACKER.md` Phase J-FV.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| FV-1 | **High** (financial) | Webhook paid-flip keyed by reference only; validation skipped when the order was bound after the validating SELECT → order paid for any charge amount (1 GHS paid a 1000 GHS order); same window let a terminal order be refunded/journaled unvalidated | Flip only the validated row at the validated total; unvalidated attempts wait and re-validate |
| FV-2 | **High** (financial) | Admin cancel wrote back a stale `paymentStatus`; a payment confirmed mid-cancel became `cancelled`/`pending` with no refund | Write conditional on the observed `paymentStatus`; lost race → 409 |
| FV-3 | Medium (financial) | Partial vendor refund used gross line value on discounted orders (over-refund) | Discount apportioned pro rata, as escrow does |
| FV-4 | Medium (ops) | Unmatched-charge reconciler starved by 25 already-reported receipts | Unreported first |
| FV-5 | Medium (availability) | No timeout on any Paystack call | 15 s timeout on every call |
| FV-11 | **High** (inventory / availability) | Checkout rejected for its coupon kept the reserved stock forever — a bogus coupon code let any customer drain any product's stock to zero (pre-existing) | Roll back the reservation on both coupon refusals |
| FV-12 | Medium (availability) | Stock helpers held a pooled connection while taking another → pool-exhaustion stalls (12 s timeouts) under concurrency (pre-existing) | Statements run on the pool |
| R-8 / R-8a | Medium (financial integrity) | A partial vendor payout that failed or was reversed after the allocation left `available` — remainder withdrawn (`releasing`), later payout succeeded (`released`), or order refunded while it was in flight (`failed`) — could never settle: settlement threw, the webhook 500'd forever, no admin alert | `transferSettlementService.js`, `escrowService.payoutAllocation` | Payout lifecycle redesign (`PAYOUT_LIFECYCLE_DESIGN.md`): allocation-first locking, state-independent restore + recompute, in-transaction clawback for voided allocations, `reconciliation_required` with deduplicated alerts | `tests/payoutLifecycle.test.js` 10a–10d (mutation-verified) |
| W-1 | Medium (financial integrity) | A withdrawal whose transfer initiate timed out was reported `paid:false` although its funds were reserved; the controller then reserved the same amount from the next allocation (one request for 100 could send 200 of the vendor's money) | `vendorController.withdrawVendorBalance` | Pending reservations count toward the request | 8b (mutation-verified) |
| W-3 | Medium | Signed transfer webhooks were settled by reference without comparing the provider's amount/currency with the reservation | `paymentRoutes.js`, settlement | Evidence compared; mismatch parks the attempt for review, no money moves | 22 (mutation-verified) |
| W-4 | Medium (ops) | Reconciler starvation (oldest-25 scan), non-final provider states ignored, no alerting, and a 404 after Paystack had acknowledged the transfer released funds | `transferReconciliationService.js` | Rotating bounded scan, deduplicated alerts, contradictory 404 → review | 7b, 11/23, 13, 16b (mutation-verified) |
| W-5 | Low | Withdrawal amount parsed with `parseFloat` (accepted `"50abc"`, `[5]`); currency unchecked; duplicate submissions reserved twice | `vendorController.js`, `VendorPayouts.tsx` | Strict pesewa parsing, GHS-only, per-vendor idempotency key | 12, 21, 22 |
| SEC-11 | Low (authorization) | Staff permission `view_earnings` (a read permission) authorised `POST /api/vendors/withdraw` | `routes/vendorRoutes.js`, `controllers/staffController.js` | New `request_payouts` permission required; only the store owner can grant it (a staff manager cannot, even while holding it); `view_earnings` stays read-only | `tests/payoutAdminPolicy.test.js` (route and grant rule mutation-verified) |
| INT-1 | Medium (financial integrity) | A refund does not void an in-flight (`releasing`) payout. If that transfer then failed, the money was restored as **withdrawable**. After a per-vendor partial refund (order still `paid`), the vendor could withdraw money for lines the customer had been refunded for | `Services/transferSettlementService.js` | Returned payout money is clawed back when the customer was refunded for that vendor's lines; allocation closed | `payoutLifecycle.test.js` 10e/10f (mutation-verified) |
| FV-13 | Low–Medium (availability) | Webhook held a pooled connection while running paid side effects that take more from the same pool (hold-and-wait). **Reproduced:** with a 3-connection pool, 6 concurrent paid deliveries failed with `DB execute timed out after 12000ms` | `routes/paymentRoutes.js` | Side effects run after the attempt's connection is released (validate→flip unchanged, FV-1 guarantee kept) | `tests/webhookPoolOccupancy.test.js` (fails on the old code) |
| FV-6 | Low–Medium (ops / refund visibility) | Stale refund-claim reconciler re-selected review rows (`LIMIT 25`, no order) and re-alerted every 15 min; ≥ 25 such rows starved the rest | `Services/paymentReconciliationService.js` | Durable per-order state (`reconciliation_checks`), due-only + never-checked-first selection, 6 h re-check for review rows, one alert per reason per 24 h, admin review list | `tests/recoveryFairness.test.js` (ordering and dedupe mutation-verified) |
| FV-7 | Low–Medium (ops) | Stuck-pending recovery re-verified every unpaid pending order every 30 min, oldest first, 100/run; a backlog starved newer genuinely-paid orders; amount-mismatched paid charges only logged | `Services/escrowService.js` | Same state table; exponential back-off (30 min → 12 h); never-checked first; mismatch → durable review item + one alert | `tests/recoveryFairness.test.js` (mutation-verified) |
| FV-8 | Low (accounting) | `platform_revenue` never reversed on refund | `Services/escrowService.js`, `orderController.cancelOrder`, `returnController`, `reconcileRefundedButPaid` | One negated `refund` row per fully refunded order + journal; bounded hourly backfill sweep | `tests/recoveryFairness.test.js` (cancel hook mutation-verified) |
| INT-2 | Medium (wallet integrity) | `reconcileAvailableAllocations` scanned the 200 oldest `available` allocations, mostly ordinary unwithdrawn balances that never leave that status; past 200, a crash-stranded wallet credit was never recovered | `Services/escrowService.js` | Select only allocations missing their credit | `payoutLifecycle.test.js` 10g (mutation-verified) |

## 2. Confirmed, not fixed (decision or follow-up required)

Added 2026-10-12 (final verification) — **FV-6, FV-7, FV-8 and FV-13 were fixed later the same day (see §1); FV-9 remains a policy decision:** **FV-6** stale-refund-claim reconciler re-alerts every 15 min and can be starved by ≥ 25 manual-review rows; **FV-7** stuck-pending recovery can be starved by > 100 unpaid pending orders with references; **FV-8** `platform_revenue` never reversed on refund (unused today); **FV-9** partial refunds exclude tax/shipping share (policy); **FV-13** the webhook still holds a connection while running paid side effects (≥ pool-size concurrent flips can stall). Each needs a schema change or a business decision.


| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| SEC-3 | Low-Medium | Custom-request **quote / decline / start** routes require staff permission `view_customers` — a read-type permission authorises setting prices | Business decision: introduce/assign a write permission (e.g. `manage_orders`) — changing it would lock out staff who use it today |
| SEC-5 | Low | Scheduler lock fails **open** (runs unlocked) when the lock table is missing or the acquire query errors; financial jobs could then run on two replicas concurrently. Refund/claim CAS markers limit the damage | Run `migrateOps.js` before deploy (gate); consider fail-closed for money-moving jobs |
| SEC-6 | Low | `updateOrder` protects owner-forbidden fields with a **denylist**; any future column added to the model allowlist becomes owner-writable by default | Convert to an owner allowlist (`notes`, `shippingAddress`, `billingAddress`, one-time `paymentReference`) |
| R-6 | Medium (process) | Return approval voids/claws back vendor escrow **before** the refund is claimed/issued; if the refund then fails, the vendor is debited while the customer is not refunded until an admin refunds via cancel. Now visible to the admin (R-5) but not automatic | Business decision on ordering; current order deliberately prevents paying a vendor for a refunded order |
| R-7 | Product limitation | One refund claim per order for its lifetime: after a partial (per-vendor) refund, no further refund (another vendor, or full) can be issued automatically | Documented pilot limitation; needs product decision before multi-vendor returns at scale |
| SEC-11 | Low | **FIXED 2026-10-12 (see §1).** Original: staff permission `view_earnings` (a read permission) authorises `POST /api/vendors/withdraw`. Money still goes only to the vendor's own registered recipient | Owner decision: introduce a payout permission for staff |
| SEC-10 | Low (hardening) | CSRF layer 2 lets a state-changing request through when **no** CSRF cookie is present. Not reachable today: every session cookie (user, OAuth, staff) is issued together with a CSRF cookie whose lifetime is ≥ the session's, and a cross-site attacker cannot delete a host-only cookie | Require the CSRF pair whenever a `jwt` cookie is present (check the SPA's token-refresh path first) |
| OPS-1 | Medium (ops) | Production traffic is browser → Vercel rewrite → Render proxy → Node. With `TRUST_PROXY=0`/unset, `req.ip` is a proxy address and **every customer shares one rate-limit bucket** (login/reset/API limiters throttle everyone); with too high a value, a caller hitting `*.onrender.com` directly can choose its own IP | Determine the hop count on staging (runbook §2) and set `TRUST_PROXY` accordingly; consider blocking direct access to the Render origin |

## 3. Historical findings re-verified against current code

| Historical finding | Current status | Evidence |
|---|---|---|
| Paid-order state resurrection | Webhook/verify/stuck flips whitelist `pending`/`failed`; admin flip fixed (SEC-2) | code + tests |
| Escrow release guards (cancelled/refunded/unpaid) | Holds — `assertOrderReleasable` + guarded CAS | `escrowCancellationRefund.test.js` 20/20 (this suite never ran in prior baselines: it was pinned to port 3307) |
| Suspended-vendor products orderable | Fixed — `addOrderItems` re-prices from DB, refuses unapproved products and non-approved vendors; custom checkout re-checks vendor status | code |
| Payment reference / amount validation | Holds — webhook, verify and stuck recovery compare full amount in GHS before any flip or terminal-order refund | code + `paymentRecovery`, `paystackReferenceGuard` |
| Webhook signature | HMAC-SHA512 over raw body, constant-time compare, fails closed without secret | code |
| OAuth state, staff logout/session revocation, login lockout | Existing suites pass (`oauthStateGate`, `authSessionRevocation`, `loginLockout`, `loginTiming`) — not re-reviewed line by line | test run |
| Cross-tenant vendor operations | Every vendor `:id` handler checks `existing.vendorId === req.user.id` (staff tokens resolve to the parent vendor) | code sweep + `vendorIsolation` |
| `/api/orders/myorders` response cache | Not a leak: cache key includes the user id and `protect` runs first | `middleware/cacheMiddleware.js` |
| Frontend payment-reference storage | Namespaced `pendingPaymentRef:{order|custom}:<id>`; ambiguous flat legacy keys deliberately ignored; 24h TTL | `src/utils/paymentRef.ts` + vitest |
| Previous models' uncommitted AI try-on rewrite (SSRF / upload) — never covered by any earlier report | Holds: model image must be an inline data: URI, is magic-byte sniffed, pixel-capped and re-encoded (EXIF/GPS stripped) before it leaves the server; the garment is resolved server-side from an **approved** product id (no client URL or path); remote catalog images need an operator allow-list (fail-closed when unset); local reads are confined by regex + containment check; per-user rate limit, concurrency caps and daily credit are checked before spend; status polling is owner-only (404 for others) | code review + `tryOnSsrf`, `tryOnUploadSecurity`, `tryOnGenerateFlow` |
| Password reset | Holds: 32-byte random token, stored as SHA-256, 1 h expiry, cleared on use; reset bumps `tokenVersion` (revokes sessions) and clears lockout; forgot/validate replies are identical for existing and unknown accounts | code review (2026-10-12) |
| Review edit/delete, upload delete | Owner-or-admin checks on the validated record/basename; editing a hidden review does not un-hide it | code review (2026-10-12) |
| Customer-side object ownership (every non-admin, non-vendor `:id` route) | Holds: addresses, designs, payment methods (scoped `AND userId = ?` in SQL, or `findById(userId, id)` before the write), notifications, message replies, buyback, custom requests (customer/vendor/admin), orders (read, update, confirm-received), returns (create, read) all check ownership or admin before acting | route-by-route sweep (2026-10-12) |
| Vendor withdrawals vs balance | Holds under real concurrency: the conditional claim (`payoutAmount >= ? AND status='available'`) is committed before any provider call | `tests/withdrawalConcurrency.test.js` (2026-10-12, mutation-verified) |

## 4. Scanning

| Check | Result |
|---|---|
| `gitleaks detect` (full git history, CI-equivalent) | **no leaks found** |
| `gitleaks detect --no-git` (working tree) | 5 findings, **all in `backend/.env`** (git-ignored, never committed). Paystack key there is a **test** key (`sk_test` prefix only inspected). The DB credentials there point at the hosted TiDB database — treat as sensitive. |
| `npm audit --omit=dev` frontend / backend | 0 vulnerabilities / 0 vulnerabilities |
| CI audit ratchet (both workspaces) | pass; backend carries 3 accepted dev-only highs (nodemon → chokidar → braces) |

## 5. Not covered (residual risk)

Reviewed on 2026-10-12 (continuation): password reset, the CSRF middleware and its mount,
proxy trust, the try-on SSRF/upload pipeline, review and upload ownership, and the ownership check of every customer-side `:id` route.
Still **not** reviewed line by line: the OAuth (Google/Facebook) callback flow beyond its
existing suites, XSS in every rendered field, and per-route rate-limit coverage. Those areas rely on the
existing suites (all passing) and the historical reports. A live staging penetration test
is recommended before production.

## 6. Local assessment — session `566deb7e` (2026-10-12)

Scope: the areas §5 listed as not reviewed (OAuth callback flow, XSS rendering paths, rate-limit coverage),
plus the commission engine and its admin API. Local code review + tests on a disposable MySQL; no live testing.
Full tracker: `LOCAL_SECURITY_AND_BUG_TRACKER.md`.

| ID | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| SEC-12 | Medium (account takeover precondition) | Google sign-in linked to — or adopted — an existing account purely by email, without checking Google's `email_verified`. A Google identity carrying an unverified copy of a customer's address could sign in as that customer | Refuse (generic `google_failed`) whenever the provider email is not verified; identities already bound by provider id still sign in | `backend/tests/oauthEmailVerification.test.js` (5; guard mutation-verified) |
| COM-6 | Low–Medium (integrity) | Admin commission API accepted `"0.1abc"`, let an update move a rule to another scope/target unvalidated, never checked targets exist, and audited `before` as `{id}` only | Strict parsing, existence + pair validation, full before/after audit | `backend/tests/commissionEngine.test.js` |

Reviewed, no defect: OAuth state (signed, cookie-bound, single-use nonce), consent gate, exchange token
(purpose-bound, 10 min, single-use, tokenVersion-checked); suspended users with an OAuth cookie are refused by
`protect` (`isActive`). Frontend: no `dangerouslySetInnerHTML` / `innerHTML` / `eval` sinks; vendor-controlled
URLs reach only `img`/`video` `src` and a YouTube-id-only iframe; vendor social links are stored but not
rendered as anchors. Rate limiting: global `/api` limiter plus dedicated limiters on every auth, reset, OTP,
staff-login, order, coupon, upload, try-on and webhook route — correct per-client bucketing still depends on
OPS-1 (`TRUST_PROXY`). `npm audit --omit=dev` 0/0; gitleaks history clean, working-tree hits only in the
git-ignored `backend/.env`.

Still open (unchanged): SEC-3, SEC-5, SEC-6, SEC-10, R-6, R-7, FV-9 (decisions), OPS-1 (staging measurement).
Facebook login has no routes (disabled); its strategy would need its own email-trust design before enabling.
A live penetration test of the deployed staging app remains recommended; it was not performed.

## 7. Final local validation — session `fe49cfc1` (2026-10-12)

Method: tests and live black-box probes on a disposable MySQL 8.4.11 with every `backend/.env` key shadowed,
outbound HTTP blocked, Paystack webhooks signed with a local placeholder secret. Commands and per-file results:
`LOCAL_SYSTEM_TEST_REPORT.md`. Nothing was run against TiDB or Paystack.

**Correction to §6:** §6 lists the OAuth exchange token as "reviewed, no defect". That was wrong — see VAL-1.

### 7.1 Confirmed and fixed (each with a regression test that fails on the old code)

| ID | Severity | Finding | Fix | Regression |
|---|---|---|---|---|
| VAL-1 | Medium | `protect` / `optionalAuth` / `vendorOrStaff` accepted any JWT carrying `{id, tv}`: the 10-min `oauth_exchange` token worked as a session cookie and bypassed its single-use `jti` (live: 200) | purpose-bound tokens rejected (`authMiddleware.js`) | `purposeTokenSession.test.js` 3/3 (0/3 with fix removed); live A-JWT3 → 401 |
| VAL-2 | Low (availability) | Concurrent referral withdrawals / pay-with-earnings deadlocked (S→X lock upgrade on `INSERT IGNORE` of an existing wallet row) → HTTP 500; no double reservation | wallet row created outside the transaction (`referralPayoutService.js`) | `referralSystem.test.js` concurrent test (6× `ER_LOCK_DEADLOCK` without fix); live H1 |
| VAL-3 | Low | International migrations swallowed real `ALTER` errors, printed ✅, exited 0 | rethrow (`migrateInternational{Addresses,Orders}.js`) | `migrationFailureExit.test.js` 4/4 (fails without fix) |
| VAL-4 | Low | `migrateMarketplace.js` indexed tables created by later migrations → fresh ≠ upgraded schema | redundant entries removed | `migrationPortability.test.js` ordering guard (fails when reintroduced); dump diff identical |
| VAL-5 | Low | Owner order update with only protected fields → 500 | 400 before `Order.update` | `orderOwnerFields.test.js` |
| REF-ASYNC | Medium (financial visibility) | Paystack refunds are asynchronous but every path books the refund on request acceptance; `refund.*` webhooks were "Unhandled", so a refund that later failed left the customer unpaid while the order showed `refunded`, with no alert | `refund.*` events recorded (`webhook_events`); `refund.failed` journaled (`info`) + one admin alert; duplicates ignored; **no automatic money/state change** | `refundLifecycle.test.js` 1–2 (fail without fix); live G2–G4 |
| REF-RELEASED | Low–Medium (financial visibility) | A refund after the vendor allocation was paid out (`released`) silently left the platform carrying the loss | `flagReleasedAllocationsAfterRefund` → one `reconciliation_checks` row per order (`refundAfterRelease`, `needs_review`, in the admin review list) + one alert; no debit invented (R-6) | `refundLifecycle.test.js` 3 (fails without fix) |

### 7.2 Confirmed and open

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| STORE-1 | Low (ops/data loss) | Profile pictures use `multer.diskStorage` directly and bypass `storageService`, so with an ephemeral disk (Render without a persistent disk) they disappear on redeploy even when `STORAGE_BACKEND=s3` | Route profile uploads through `storageService`, or attach a persistent disk |
| DOC-1 | Low | `backend/.env.example` omits variables the code reads (`S3_*`, `DB_POOL_SIZE`, `EMAIL_HOST/PORT/SECURE`, …; list in `SYSTEM_INVENTORY.md` §9). The production runbook said only `local` storage exists — S3 is implemented | Update `.env.example` (runbook corrected in its §6) |
| CFG-1 | Low (ops) | `FRONTEND_URL` is parsed as a comma-separated CORS/CSRF allow-list but used verbatim as a URL base (reset links, OAuth redirects, Paystack `callback_url`, referral links). More than one origin breaks those flows | Set exactly one origin (runbooks updated); optionally add a separate `CORS_EXTRA_ORIGINS` later |
| MIG-2 | Low | Several other migration scripts still log-and-continue on some statement errors (by design, see `migrationPortability.test.js` header) | Keep the runbook rule: every `Could not` line in a migration log must be explained |
| SEC-3, SEC-5, SEC-6, SEC-10 | Low / Low-Medium | Re-checked in code this pass: unchanged (SEC-5 lock fail-open at `schedulerLock.js:63`; SEC-6 still a denylist; SEC-10 no-cookie pass-through at `csrfMiddleware.js:134`) | as in §2 |
| R-6, R-7, FV-9 | Decision | Behaviour documented in `DATABASE_AND_FINANCIAL_INTEGRITY_REPORT.md` §4 | owner decision |
| OPS-1 | Medium (ops) | `TRUST_PROXY` hop count unmeasured | staging runbook §2 / §9 |

### 7.3 Critical / high findings re-verified against the current code (executed this pass)

| ID | Original severity | Verification | Status |
|---|---|---|---|
| S-1 test suite against remote DB | High | `testDbGuard` with `DB_HOST=203.0.113.7` → exit 1 "REFUSING TO RUN TESTS", no connection | Confirmed fixed |
| S-2 `db:setup` drops remote DB | High | `setupDB.js` with the same host → exit 1 "Refusing to DROP DATABASE" | Confirmed fixed |
| C-0 backend could not boot | Critical | `moduleGraph.test.js` 3/3; live server booted 3× this session | Confirmed fixed |
| C-1 charged, no order (custom checkout) | Critical | `customRequestCheckoutHandler.test.js` 5/5 | Confirmed fixed |
| C-3 paid side effects untracked | High | `paidSideEffects.test.js` 8/8 | Confirmed fixed |
| FV-1 webhook paid any amount | High | `finalVerificationRaces.test.js` 9/9; live C2 (underpaid → not paid) | Confirmed fixed |
| FV-2 cancel overwrote confirmed payment | High | `finalVerificationRaces.test.js` | Confirmed fixed |
| FV-11 coupon refusal leaked stock | High | `finalVerificationRaces.test.js` | Confirmed fixed |
| SEC-12 OAuth unverified email adoption | Medium | `oauthEmailVerification.test.js` 5/5 | Confirmed fixed |
| Cross-tenant vendor access | High (class) | `vendorIsolation.test.js` 9/9; live B-IDOR1/5/6 | Not reproducible |
| Paid-state resurrection | High (class) | `refundGuard` 10/10, `adminMarkPaidRace` 1/1, `paymentLateCharge` 11/11 | Not reproducible |
| Double refund / double payout | High (class) | `refundDoubleSpend` 5/5, `withdrawalConcurrency` 4/4, `payoutLifecycle` 29/29; live H1 | Not reproducible |

### 7.4 Suspected, not verified / not tested

| Area | Status |
|---|---|
| TiDB-specific locking/FK/JSON behaviour behind the concurrency guarantees | Not tested (no TiDB) |
| Real Paystack refund/transfer asynchrony, OTP, webhook retry schedule | Not tested (mocked) |
| `TRUST_PROXY` behind Vercel → Render (spoofable IP vs shared bucket) | Not tested (needs staging) |
| Multi-replica scheduler lock contention | Not tested (single process) |
| XSS via stored content in every admin view | Suspected low risk (no raw-HTML sinks found earlier), not re-tested this pass |
| Facebook login | Not tested (no routes; disabled) |

### 7.5 Scans (this pass)

| Scan | Command | Result |
|---|---|---|
| npm audit frontend | `npm audit --json` + `audit-gate.mjs` | 0 advisories; gate pass |
| npm audit backend | same in `backend/` | 3 high, all dev-only (`nodemon` → `chokidar` → `braces`, GHSA-vfj7-8cjw-p6xm, stack-exhaustion DoS in glob patterns); all in the CI baseline; gate pass. npm's only fix is a **downgrade to nodemon 1.14.10** (semver-major, breaking, unmaintained) — not applied. Not exploitable at runtime (not in the production tree) |
| npm audit runtime | `npm audit --omit=dev` (both) | 0 / 0 |
| gitleaks history | `gitleaks detect --source . --redact` (8.24.3) | no leaks |
| gitleaks working tree | `--no-git` over tracked + untracked-not-ignored files (565) | no leaks; `backend/.env` is git-ignored and has never been committed (`git log --all -- backend/.env` empty) |

## 8. Staging preparation — session `fe49cfc1` (2026-10-13)

Status changes to §7.2 (each with a regression test that fails on the previous code):

| ID | Severity | Change | Regression |
|---|---|---|---|
| CFG-1 | Low (ops) | **Fixed.** `config/frontendOrigins.js` is the only reader of `FRONTEND_URL`: all entries allowed by CORS/CSRF, the first is the link/redirect base; trailing slashes normalized (they used to make the allow-list reject the real `Origin`); production boot refuses non-https / path-bearing entries | `tests/frontendOrigins.test.js` 7/7 (boot checks fail 4/4 without the guard); source guard forbids direct reads |
| STORE-1 | Low (data loss) | **Fixed.** Profile pictures stage through the shared upload middleware, are byte-validated, and are stored via `storageService` (`profiles/` key); works with `local` and `s3` | `tests/profileUploadStorage.test.js` (fake S3 on loopback; original route fails 3/4); `uploadGate.test.js` updated |
| PIC-1 | Low (functional, **new**) | **Found and fixed.** The profile route read `user.profile_picture`, but the model exposes `profilePicture`: `DELETE /api/profile/picture` always answered 400 and replaced pictures were never removed (orphaned files) | `profileUploadStorage.test.js` replace/delete cases |
| DOC-1 | Low | **Fixed.** `backend/.env.example` documents every variable the runtime reads (scan: 0 undocumented) and no longer says S3 is unimplemented | scan in `LOCAL_SYSTEM_TEST_REPORT.md` |
| CI-1 | Low (assurance, **new**) | node:test reports a skipped `describe()` as `ok … # SKIP` but keeps `# skipped 0` in the summary, so a DB suite could skip silently in CI; `migrationFailureExit.test.js` always skipped there (no CREATE DATABASE). **Fixed:** CI grants `ci` rights on `km\_migfail\_%` only (`scripts/ci-grant-scratch-db.mjs`, loopback-only) and the MySQL job fails on any `# SKIP`/`# TODO` | grant rehearsed (scratch DB allowed, other DB denied); guard logic tested on sample logs. Not yet observed on GitHub Actions |

Still open: MIG-2, SEC-3, SEC-5, SEC-6, SEC-10, OPS-1 (measurement), decisions R-6, R-7, FV-9.
New operator tools (no data changes, no secret output): `scripts/staging-preflight.mjs` (tested 6/6, including a
no-secret-leak assertion) and `scripts/staging-smoke.mjs` (13 read-only checks, rehearsed against a production-mode
local stack).

## 9. TiDB verification (2026-10-13)

New, fixed with regression tests: **DB-PING** (Medium, availability — keep-alive ping killed in-use connections →
500s under slow statements), **TIDB-COLL** (Medium, functional — case-sensitive search on TiDB), **NOTIF-1**
(Low–Medium — custom-request and buyback notifications never stored). Open: **TIDB-CHECK** (CHECK constraints not
enforced on TiDB by default; negative stock prevented by application code only), **TIDB-TLS** (development `.env`
uses unverified TLS; set `DB_SSL_CA`). Evidence: `DATABASE_AND_FINANCIAL_INTEGRITY_REPORT.md` §7.
