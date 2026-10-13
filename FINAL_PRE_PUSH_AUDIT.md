# FINAL PRE-PUSH AUDIT — Kente Market

**Project:** Kente Market (multi-vendor marketplace)
**Branch:** `fix/global-production-integration`
**HEAD:** `2df4428b793dd3be4a829b5afaeff1b85984a8b8` — *"integrate: unify global-production checkout+shipping+payments (fail-closed)"*
**Audit date:** 2026-10-10
**Scope:** Independent pre-push verification of the F-1 → F-7 financial-integrity integration
**Authority:** Read-only. No push, commit, deploy, migration against a shared DB, or application-code modification was performed.

---

## 1. EXECUTIVE SUMMARY

All functional verification **passes**: 658/658 backend tests, 69/69 frontend tests, lint clean, root typecheck clean, production build clean, and syntax checks clean. The database safety gate was independently established and the full suite was executed **only** against a verified disposable local MySQL.

However, the prior remediation report's claims do **not** all survive independent verification. Four issues were confirmed that must be cleared before this work is pushed:

| # | Issue | Severity | Blocks push? |
|---|-------|----------|--------------|
| B-1 | Backend typecheck is **red and newly broken** — the 3 errors are *not* pre-existing (`main` typechecks clean at exit 0). CI runs this as a required step → **push produces a red CI**. | High | **Yes** |
| B-2 | `backend/package.json` `db:migrate` references `migratePaymentProcessingState.js`, which is **untracked**, while `backend/test-password-reset.js` is **deleted (tracked)**. A tracked-only commit **breaks `npm run db:migrate` and `npm run password:reset:test`**. | High | **Yes** |
| B-3 | **F-5 verified defect:** `trackPlatformRevenue` uses the platform-only gross as the discount denominator while `createEscrowAllocations` uses the whole-order gross. On multi-vendor **discounted** orders platform revenue is understated and gross/discount/net do **not** reconcile. Untested (the multi-vendor test uses `discount = 0`). | Medium | **Yes** |
| B-4 | **F-1 gaps:** recovery is unbounded (no `LIMIT`), is **not wired to any scheduler/startup/route**, does not exclude cancelled orders, and stock decrement is not idempotent per order (crash window double-decrements). Several stated F-1 acceptance criteria are untested. | Medium | **Yes** |

Additionally, a **test-harness safety hazard** was confirmed (see §5): the repository's documented test commands connect to the **shared TiDB Cloud database** unless `DB_HOST` is explicitly overridden. Only **one** test file self-pins to the scratch server.

**Verdict: CONDITIONAL GO** — the core engineering is sound and heavily tested, but B-1 → B-4 must be fixed before the push.

---

## 2. ACTUAL BRANCH, HEAD AND GIT STATUS

```
Working directory : /home/roberto/Documents/project/ecom_new
Branch            : fix/global-production-integration
HEAD              : 2df4428b793dd3be4a829b5afaeff1b85984a8b8   ← matches the reported HEAD
```

Recent history: `2df4428` ← `18e6fb9` ← `4352b82` ← `eeb1579` ← `f826492` ← `4007630` (= `main` tip). The branch is **5 commits ahead** of `main`.

**Nothing is staged. Nothing was committed. Nothing was pushed. HEAD is unchanged from the start of the audit.**

| State | Files |
|-------|-------|
| **Modified (15)** | `REMEDIATION_REPORT.md`, `backend/Services/escrowService.js`, `backend/Services/reservationService.js`, `backend/Services/shippingService.js`, `backend/controllers/internationalCheckoutController.js`, `backend/controllers/orderController.js`, `backend/migrateExchangeRates.js`, `backend/migrateShippingCarriersRates.js`, `backend/package.json`, `backend/routes/paymentRoutes.js`, `backend/tests/internationalCheckoutUnified.test.js`, `backend/tests/paymentHardeningSchema.test.js`, `branding_house.sql`, `docs/international-checkout-contract.md` |
| **Deleted (1)** | `backend/test-password-reset.js` |
| **Untracked (7 + 1 pre-existing)** | `backend/migratePaymentProcessingState.js`, `backend/scripts/` (`password-reset-flow.js`), `backend/tests/escrowCancellationRefund.test.js`, `backend/tests/internationalFxThreshold.test.js`, `backend/tests/paymentLifecycleRecovery.test.js`, `backend/tests/helpers/intlMissingTableProbe.mjs`, `INTEGRATED_VERIFICATION_REPORT.md`, `FINAL_PRE_PUSH_AUDIT.md` |

`backend/package.json` changes are **scripts only** — no dependency was added, removed, or version-bumped. No lockfile changed.

### Two changes that weaken existing checks

1. **`backend/tests/internationalCheckoutUnified.test.js`** — the `// @ts-check` directive was **deleted** (a one-line diff). This silences **27** TypeScript errors rather than fixing them, and is the only reason the backend typecheck error count fell from 27 (HEAD) to 3 (working tree).
2. **`backend/tests/paymentHardeningSchema.test.js`** — the fixture now inserts a `wallet_transactions` `credit` row. This is a **legitimate** fixture correction (the production clawback deliberately refuses to debit a wallet with no credit ledger row), *not* an assertion weakening. The clawback assertions themselves are unchanged.

No debug statements, hardcoded secrets, disabled tests, or skipped assertions were found in the financial paths. The `console.*` calls in `escrowService.js`/`paymentRoutes.js` are structured operational logging with no secret or PII material.

---

## 3. FILES REVIEWED

**Financial core:** `Services/escrowService.js`, `Services/reservationService.js`, `Services/walletService.js`, `Services/transferSettlementService.js`, `Services/ledgerService.js`, `Services/stockMoves.js`, `Services/paymentCurrency.js`, `Services/paystackservices.js`, `controllers/orderController.js`, `controllers/internationalCheckoutController.js`, `controllers/vendorController.js`, `routes/paymentRoutes.js`, `routes/orderRoutes.js`, `routes/internationalCheckoutRoutes.js`.

**Schema/migrations:** `migratePaymentProcessingState.js` (new), `migrateExchangeRates.js`, `migrateShippingCarriersRates.js`, `branding_house.sql`, `backend/package.json` (`db:migrate` chain).

**Tests:** the 4 target suites + 31 neighbouring suites + full-suite run (see §4).

**Config/security:** `config/db.js`, `config/mysqlTls.js`, `middleware/authMiddleware.js`, `middleware/rateLimitMiddleware.js`, `middleware/securityMiddleware.js`, `utils/redisClient.js`, `.github/workflows/ci.yml`, `docs/international-checkout-contract.md`, `.env` (keys enumerated, **values never printed**).

---

## 4. EXACT TEST COMMANDS AND OBSERVED RESULTS

Every command below was run from `/home/roberto/Documents/project/ecom_new` with the database-safety environment of §5.

| # | Command | Result | Exit | Duration |
|---|---------|--------|------|----------|
| A1 | `node --test tests/paymentLifecycleRecovery.test.js` | **21/21 pass** | 0 | 14.2s |
| A2 | `node --test tests/paymentHardeningSchema.test.js` | **5/5 pass** | 0 | 5.2s |
| A3 | `node --test tests/escrowCancellationRefund.test.js` | **20/20 pass** | 0 | 5.6s |
| A4 | `node --test tests/internationalFxThreshold.test.js` | **40/40 pass** | 0 | 81.5s |
| B | 31 neighbouring suites (payment/webhook/escrow/settlement/refunds/coupons/stock/vendor-isolation/shipping/intl) | **306/306 pass** | 0 | 54.7s |
| C | `npm test` (= `node --test --test-concurrency=4 "tests/**/*.test.js"`) | **658/658 pass**, 139 suites, 0 skipped | 0 | 2m50s |
| D1 | `npm run lint` | **0 errors**, 13 warnings | 0 | 50.3s |
| D2 | `npx tsc --noEmit -p tsconfig.json` (root) | **clean** | 0 | 41.0s |
| D3 | `npm run typecheck --prefix backend` | **3 errors** | **2** | 12.7s |
| D4 | `npm run test:frontend` (vitest) | **69/69 pass**, 9 files | 0 | 54.5s |
| D5 | `npm run build` (vite prod build) | **built in 43.13s** | 0 | 50.0s |
| D6 | `node --check` on all 16 changed/new `.js`/`.mjs` files | **all OK** | 0 | — |

Baseline comparison (run against pristine `git archive` copies in `/tmp`, **not** against the working tree):

| Ref | Backend typecheck |
|-----|-------------------|
| `main` (`4007630`) | **exit 0 — clean** |
| `HEAD` (`2df4428`) | exit 2 — **27 errors**, all in `tests/internationalCheckoutUnified.test.js` |
| Working tree | exit 2 — **3 errors** |

Claimed counts **21/21, 5/5 and 658/658 are confirmed exactly**. No test was weakened, rerun-to-green, or configured differently.

---

## 5. DATABASE IDENTITY AND SAFETY CONFIRMATION

**This was the highest-risk area of the audit, and the prior report's assurance does not hold.**

`backend/.env` points at the **shared TiDB Cloud database** (`…eu-central-1.prod.aws.tidbcloud.com:4000`, schema `branding_house`). `config/db.js` calls a bare `dotenv.config()`, so **any process started from `backend/` with no overrides connects to TiDB Cloud** — including `npm test`.

Proof (connection identity only, credentials never printed):

| Invocation | Resolved server |
|-------------|-----------------|
| `node -e 'import("./config/db.js")…'` (no prefix) | **port 4000 — TiDB Cloud** |
| same, with `DB_HOST=127.0.0.1 DB_PORT=3307 …` | **port 3307 — local scratch** |

`dotenv` does not override pre-existing variables, so an explicit prefix is effective.

**Scratch server verified disposable:**
`127.0.0.1:3307`, MySQL **8.4.11-0ubuntu0.26.04.1**, hostname `roberto` (local), schema `branding_house`, 51 tables, `orders = 0`, `escrow_allocations = 0`, `wallet_transactions = 0`. Not TiDB, not production, not staging, no real user data.

**Environment used for every test run** (mirrors the `backend-tests-db` job in `.github/workflows/ci.yml`):

```
DB_HOST=127.0.0.1  DB_PORT=3307  DB_USER=root  DB_PASSWORD=  DB_NAME=branding_house  DB_SSL=
PAYSTACK_SECRET_KEY=ci-placeholder-paystack-secret  PAYSTACK_PUBLIC_KEY=ci-placeholder-paystack-public
EMAIL_DISABLED=1  REDIS_URL=  SENTRY_DSN=
```

The placeholder Paystack key guarantees no real payment, transfer or withdrawal can succeed, and `REDIS_URL=`/`SENTRY_DSN=` prevent writes to the shared Upstash Redis and real Sentry project that `backend/.env` otherwise points at.

**Paystack exposure was audited before any run:** `PAYSTACK_SECRET_KEY` **is set** in `backend/.env`. Only 3 test files reference a live Paystack method (`refundTransaction`) and **all three stub it**; the only `axios` use in tests is `mock.method`-patched. `payoutAllocation` is reached from a guard-refusal test, but the guard is present and passes, so no outbound call occurs.

**Hazards identified (report-only):**

- **Only `escrowCancellationRefund.test.js` self-pins to 3307.** Every other DB-backed suite — including `paymentLifecycleRecovery.test.js` and `paymentHardeningSchema.test.js`, which are *not* covered by that file's interlock — trusts ambient env and would silently target TiDB Cloud.
- The `.github/workflows/ci.yml` "skip path" job runs `npm test` with **no database**, relying on suites self-skipping. A developer reproducing CI locally without the prefix gets **TiDB Cloud**, not the skip path.
- During the audit the scratch server on **3307 stopped listening** (machine restart). Any subsequent DB run would now *fail to connect* and the suites would **self-skip into a false green**. DB-dependent commands were therefore not re-executed after the restart.
- `internationalFxThreshold.test.js` executes `DROP DATABASE` + the full `db:migrate` chain — but only against its own scratch schema `finaud_fresh_mig`, and it **refuses when `DB_HOST` matches `tidbcloud.com`**. Verified safe.

---

## 6. RESULTS FOR F-1 → F-7

### F-1 — Payment recovery — ⚠️ **GAPS**

Verified good: per-effect idempotence via an atomic conditional `JSON_SET` update; `orderHasCoupon()` fails closed on malformed `couponId`; unknown orders return the full required set; `charge.collected` uses a stable `dedupeKey`; no-coupon orders are not permanently blocked.

**Defects (B-4):**

1. **Unbounded.** `recoverIncompletePaidOrders()` has **no `LIMIT`** — contrast `reconcileAvailableAllocations`, which uses `LIMIT 200`. Violates the "does not unexpectedly process thousands of records" requirement.
2. **Not wired anywhere.** It is exported but has **no caller** in `server.js`, `utils/cleanupJobs.js`, any route, or any controller. F-1 recovery is **operationally unreachable** in production.
3. **No cancelled-order exclusion.** The `WHERE` clause filters `paymentStatus = 'paid'` only. A paid-then-cancelled order is still selected: escrow hold is a safe no-op, but **stock is still decremented and platform revenue still recorded** for a cancelled order.
4. **Stock decrement is not idempotent per order.** `decrementStockForOrder` issues `stock = stock - ?` with no orderId dedupe, and `recordStockMove` is a plain `INSERT` with no unique key. A crash between the decrement and the `markPaymentSideEffect` call — or two concurrent recovery workers — **double-decrements**. The "idempotent" test only covers a sequential re-run *after* marking.
5. A malformed `items` payload silently becomes `[]`, after which stock and revenue effects are marked complete **without doing the work**; a null `paymentReference` prevents `financialEventRecorded` from ever being set, so the order is re-selected forever.
6. Per-order failures are `console.warn`-only — recoverable, but not "visible" in the alerting sense.

**Untested criteria:** crash-after-decrement duplicate prevention, cancelled/refunded exclusion, concurrent recovery workers, boundedness.

### F-2 — Cancellation & clawback — ✅ **SOUND**

`assertOrderReleasable` / `assertOrderWithdrawable` are the central invariants. `releaseAllocation` performs the eligibility check, then `SELECT … FOR UPDATE`, then commits the transition and the wallet credit **atomically on one connection** — structurally closing the split-brain where a void could debit a vendor for funds never credited. `clawbackAvailableAllocation` debits only when a matching `type='credit'` ledger row exists (fixture now models this correctly). `payoutAllocation`'s claim carries a `NOT EXISTS (cancelled/refunded)` guard **inside** the atomic `UPDATE`. Withdrawal races serialize on the row lock. Verified by the 20/20 F-2 suite.

### F-3 — Automatic release — ✅ **SOUND**

`autoReleaseExpiredEscrows` candidates are filtered to `orderStatus='delivered' AND escrowStatus='held' AND paymentStatus='paid' AND deadline < NOW()`, and every path re-enters `assertOrderReleasable` against live DB state — so a scheduled job cannot bypass the service guard. Cancelled, refunded and unpaid orders are refused.

### F-4 — Revenue tracking — ✅ **SOUND**

`trackPlatformRevenue` writes `INSERT … ON DUPLICATE KEY UPDATE` keyed on `orderId`, so duplicate webhook delivery cannot duplicate revenue; `charge.collected` dedupes by `dedupeKey`; the webhook, verify-fallback, admin mark-paid and recovery paths all call it (asserted by tests). Journal deduplication works.

### F-5 — Gross / discount / net — ❌ **DEFECT (B-3)**

The discount apportionment uses **two different denominators**:

| Function | Denominator |
|----------|-------------|
| `createEscrowAllocations` (escrowService.js:217) | `grossSubtotal` = **whole order** gross (line 206 adds platform items *before* the `if (!vendorId) continue`) |
| `trackPlatformRevenue` (escrowService.js:1272) | `gross` = **platform items only** |

`trackPlatformRevenue`'s comment claims *"same logic as escrow allocation"* — it is not. Worked example: order 1000 GHS (platform 200 + vendor 800), discount 100.

- Escrow: `netFactor = 1 − 100/1000 = 0.9` → vendor net **720** ✓
- Platform revenue: `netFactor = 1 − 100/200 = 0.5` → platform net **100**
- Correct pro-rata platform share of the discount is 20 → platform net should be **180**
- **720 + 100 = 820 ≠ 900.** 80 GHS is unaccounted for.

If `discount > platformGross`, `netFactor` clamps to **0** and platform revenue is recorded as **0**. The accounting therefore fails the F-5 requirement that vendor allocations reconcile to net and that nothing is omitted. Severity Medium — a reporting/reconciliation integrity defect rather than an immediate cash loss.

**Why the suite missed it:** `trackPlatformRevenue records gross, discount and net` uses a **platform-only** cart (denominators coincide), and the multi-vendor test `only tracks platform-owned items` uses **`discount = 0`**. There is **no test** for a multi-vendor order carrying a discount — the exact divergence case.

### F-6 — Schema & migrations — ✅ **SOUND**

Verified present in both the canonical dump and the executed chain: `exchange_rates` (5 seeded rows), `shipping_carriers` (5), `shipping_rates` (6), `vendor_shipping_destinations`. A clean database is initialised from `branding_house.sql`, and the F-6 suite executed the **full** `db:migrate` chain **twice** against a fresh scratch schema, asserting identical `SHOW CREATE TABLE` structure and identical row counts — so re-runs neither duplicate seed rows nor re-date operator-maintained FX rates. The chain includes the new `migratePaymentProcessingState.js`, which therefore **executes successfully at runtime** despite its typecheck error.

### F-7 — Shipping & FX currency rules — ✅ **SOUND**

Quote and booking both normalise amount **and** free-shipping threshold to GHS through the shared `toGHS()` helper; quote `isFree`/`amountGHS` equal the booked figure. Missing or invalid rates fail closed (`502 SHIPPING_FX_UNAVAILABLE`); a missing migration fails closed (`503 SHIPPING_TABLES_MISSING`) with no fallback to the static table; stale rates emit `warnings: ["STALE_EXCHANGE_RATE"]` rather than an outage. Domestic GH behaviour is preserved. Server-side vendor eligibility is fail-closed (`checkVendorDestination`; a missing row means not eligible; a missing table means 503), `/vendor-eligibility` requires `protect`, and an ineligible cart cannot reach payment. Charge currency is GHS-only by exact equality; the payment-amount snapshot is frozen at payment and post-payment address changes cannot alter it. All 40 assertions observed passing.

### Documentation vs. capability — ✅ **HONEST**

`docs/international-checkout-contract.md` explicitly disclaims what is not built: *"No multi-currency charging, no instant settlement"*, *"Shipping rates are table rates, not live couriers — no carrier API call, tracking, label, or webhook integration"*, and mobile money is Ghana-only. No overclaiming found.

---

## 7. SECURITY FINDINGS AND SEVERITY

This is a targeted review, **not** a comprehensive security certification.

**Verified good:**
- Webhook signature verified with **HMAC-SHA512 over `req.rawBody`** and `crypto.timingSafeEqual` (constant time); `webhookLimiter` applied; missing signature → 400.
- `/verify-paystack` and `/paystack/banks` require `protect`; the banks route also carries `apiLimiter`.
- `PUT /orders/:id/pay` is `protect, admin, updateOrderToPaid` — admin-only.
- Vendor/tenant isolation enforced in queries; international eligibility checked server-side, fail-closed.
- Secrets: **no key-shaped values** in any changed/new file; `.env` is **not tracked**; no credentials printed during this audit.
- TLS fail-closed: `DB_SSL=1` without a CA refuses to start in production unless explicitly opted in.
- Redis rate-limit degradation fails **closed** (per-instance counters, carried across the outage) rather than open.
- Dependency state unchanged (no version bumps); CI carries a gitleaks secret scan and an npm-audit ratchet.

**Findings:**

| ID | Severity | Finding |
|----|----------|---------|
| S-1 | Medium (operational) | **Documented test workflow targets the shared TiDB Cloud DB.** Only 1 of ~50 suites self-pins to a scratch server. A local `npm test` with no prefix writes to the shared database. Needs a repo-level guard (e.g. a `tests/dbTarget.js` interlock applied to every DB suite, or a `db:test` script that hard-sets the target). |
| S-2 | Low | Per-order recovery failures are `console.warn`-only — no Sentry/admin surfacing for silently-unrecoverable financial orders. |
| S-3 | Low | The F-5 accounting divergence (B-3) is a financial-reporting integrity issue, not an access-control one. |

**Out of scope / not verified:** live penetration testing, OAuth provider configuration, session-store hardening under load, and full dependency CVE triage beyond the existing CI ratchet.

---

## 8. TYPECHECK FINDINGS

```
Services/shippingService.js(382,9):  error TS2353: 'staleRate' does not exist in type '{ ok:true; amountGHS; carrier; serviceLevel; isFree }'
Services/shippingService.js(397,7):  error TS2353: 'staleRate' does not exist in type '{ ok:true; amountGHS; carrier; serviceLevel; isFree }'
migratePaymentProcessingState.js(11,32): error TS2339: Property 'createConnection' does not exist on type 'typeof mysql2/promise'
```

**Are they pre-existing? No — this claim is refuted.**

- `main` typechecks **clean (exit 0)**.
- `staleRate` does **not** exist in `HEAD`'s `shippingService.js` — it is introduced by this uncommitted change (lines 324/343/351/374/382/397). The JSDoc return type was never updated to declare it.
- `migratePaymentProcessingState.js` is an **entirely new, untracked file**, so its error is by definition new.

The error *count* fell from 27 → 3 only because `// @ts-check` was **deleted** from `tests/internationalCheckoutUnified.test.js`, silencing 27 errors instead of fixing them.

**Runtime impact:** none. `TS2353` is an excess-property check; `TS2339` is a JSDoc resolution-mode artefact — and the migration chain (which includes that script) demonstrably executes successfully, as proven by the passing F-6 suite.

**Should they block?** They block the **push**, not staging functionally: `.github/workflows/ci.yml` runs `npm run typecheck --prefix backend` as a required step, and it exits 2. A push today yields a red CI on this branch, while `main` stays green — a visible regression on the integration branch.

**Root-level typecheck** (`npx tsc --noEmit -p tsconfig.json`) is **clean** and does cover the frontend plus `shared/`, but it does **not** substitute for the backend gate.

---

## 9. DEPLOYMENT PREREQUISITES

**Code readiness ≠ deployment readiness. No deployment was performed or authorised.**

Must be completed **before the push** (see verdict): fix B-1 (typecheck), fix B-2 (commit the untracked files, or stop referencing them), fix B-3 (F-5 denominator), and decide on B-4.

Must be completed **before staging**:
1. Run `npm run db:migrate --prefix backend` against the **target** database, in order — the chain now ends with `migratePaymentProcessingState.js`, which must exist on disk.
2. **FX rates:** `exchange_rates` is seeded **manual** data. Feed it from a real source and document the refresh cadence; seeds are estimates and rates older than 90 days only warn.
3. **Paystack webhook:** register the production webhook URL and confirm the signing secret matches `PAYSTACK_SECRET_KEY`. Signature verification is enforced, so a mismatch silently drops every event.
4. **Env matrix:** `backend/.env` currently points at TiDB Cloud with a real `PAYSTACK_SECRET_KEY`, `SENTRY_DSN`, `REDIS_URL` (shared Upstash) and `FRONTEND_URL=localhost:5173-5175`. Staging/production need their own values; `FRONTEND_URL` must be the real origin or CORS/cookies break.
5. **Wire F-1 recovery** into `utils/cleanupJobs.js` (or an admin endpoint) with a `LIMIT` — otherwise F-1 never runs.
6. **Operational runbook:** financial reconciliation + recovery procedures, backup/restore, and rollback (see `DISASTER_RECOVERY.md`).
7. **Push side-effects:** a push to a Vercel-tracked branch may auto-deploy the **frontend**; the Render **backend** is a separate manual process. Neither was triggered.

---

## 10. REMAINING RISKS AND LIMITATIONS

- All 658 backend tests were executed **once**, against one disposable MySQL 8.4 instance. No cross-version or TiDB-compatibility run was performed.
- The audit's DB runs used an env prefix because `backend/.env` targets TiDB Cloud; the results therefore reflect a **local** topology, not TiDB latency/TLS behaviour.
- The scratch server disappeared mid-audit; post-restart DB re-runs were deliberately **not** executed (they would self-skip into a false green).
- Residual, deliberately accepted risk: if a guard regression ever reached `initiateTransfer`/`refundTransaction`, an outbound request to `api.paystack.co` could occur with a **placeholder** key — a 401, with **no possibility of moving money**. No such call was observed.
- Test residue remains in the disposable DB (and a scratch schema `finaud_fresh_mig` was created on it); it is now unreachable and disposable.
- The security review is targeted, not a certification.
- No dependency audit (`npm audit`) was executed — it requires network access and was not essential to the financial verdict.

---

## 11. DID ANY FILES CHANGE DURING THE AUDIT?

**No application code, configuration, or tracked file was modified, staged, committed, or pushed.** HEAD is byte-identical to the audit start.

- `dist/` was regenerated by `npm run build` — it is **git-ignored** (`.gitignore:11`) and not part of the release.
- No lockfile changed. No dependency was installed or upgraded.
- Test execution wrote only to the disposable database.
- **`FINAL_PRE_PUSH_AUDIT.md`** is the one file this audit wrote (the requested deliverable). A version of this file **already existed** when the audit resumed, created at 12:45 during a server restart and *not* present at audit start. It attributed itself to a different agent and reached a **"GO FOR STAGING PUSH"** verdict whose central claim ("three *pre-existing* backend typecheck errors") this audit **refutes**. It was preserved verbatim at `/tmp/opencode/audit/PRIOR_FINAL_PRE_PUSH_AUDIT.md` (md5 `6ff862bfb465a1428b025eba80927b1c`) before being replaced. **Its provenance is unverified — treat it as prior-session residue, not as reviewed work.**
- The password-reset utility remains usable at its updated path: `backend/scripts/password-reset-flow.js` exists, passes `node --check`, and is what `npm run password:reset:test` now invokes. The old `backend/test-password-reset.js` is deleted and no longer referenced anywhere.

---

## 12. FINAL RELEASE RECOMMENDATION

### VERDICT: **CONDITIONAL GO**

The engineering is genuinely strong: 658/658 backend + 69/69 frontend tests pass, F-2, F-3, F-4, F-6 and F-7 hold up under independent code review and execution, the escrow/withdrawal/cancellation invariants are properly atomic, the webhook signature check is constant-time over the raw body, and no secrets were exposed. Database safety was established and honoured.

**But the push is not yet safe.** Four issues must be resolved first:

1. **B-1 — make the backend typecheck green.** Update the `staleRate` JSDoc return type and fix the `mysql2/promise` import typing in `migratePaymentProcessingState.js`. `main` is clean; do not ship a red CI gate. *(Do not silence further checks the way `// @ts-check` was removed.)*
2. **B-2 — commit the untracked release files.** `migratePaymentProcessingState.js` and `backend/scripts/password-reset-flow.js` are referenced by `backend/package.json` but are **untracked**, while `test-password-reset.js` is deleted. A tracked-only commit breaks `db:migrate` and `password:reset:test`.
3. **B-3 — fix the F-5 discount denominator** in `trackPlatformRevenue` to use the whole-order gross, matching `createEscrowAllocations`, and add a multi-vendor **discounted** reconciliation test.
4. **B-4 — bound and wire F-1 recovery** (add `LIMIT`, exclude cancelled/refunded orders, make stock decrement idempotent per order, register it in `cleanupJobs.js`).

**Strongly recommended before staging (not push-blocking):** apply a repo-wide DB-target interlock (S-1) so no suite can ever reach TiDB Cloud by default.

Once B-1 → B-4 are fixed and the suite is re-verified against the disposable database, this work is a reasonable candidate for a **staging push**. This verdict authorises consideration of a push for **staging validation only** — it is **not** a production-readiness declaration, and neither push nor deployment was performed here.
