# REMEDIATION SUMMARY REPORT

> **Update 2026-10-10 — see the appended section “REMEDIATION REPORT — fix/global-production-integration” at the end of this file** for the follow-up fixes to the three failures left by the integrated verification (`paymentLifecycleRecovery`, `paymentHardeningSchema`, `test-password-reset.js`). The RB-01…RB-10 summary below is preserved unchanged.

## Files Changed

### Backend Core Services
1. **backend/Services/escrowService.js** - RB-02, RB-03 fixes
2. **backend/Services/reservationService.js** - RB-04 fix (sweeper marks order as cancelled)
3. **backend/controllers/orderController.js** - RB-01, RB-03, RB-04 fixes (main changes)
4. **backend/routes/paymentRoutes.js** - RB-03 fixes (webhook & verification endpoints)

### Tests Added
1. **backend/tests/rb01-checkout-rollback.test.js** - 5 tests for RB-01
2. **backend/tests/rb02-escrow-retry.test.js** - 6 tests for RB-02
3. **backend/tests/rb03-payment-paid-flip.test.js** - 10 tests for RB-03
4. **backend/tests/rb04-inventory-double-restore.test.js** - 4 tests for RB-04

---

## RB-01: CHECKOUT INVENTORY ROLLBACK ✅ FIXED

**Problem:** Order.create / newOrder lifecycle and rollback handling could cause inventory restoration to fail. If checkout reserves inventory and then fails before a valid order is created, inventory must be restored. If a valid order already exists, the generic in-memory rollback must NOT restore inventory that belongs to the created order.

**Fix Applied:**
- Modified `addOrderItems` catch block in orderController.js
- If `Order.create` succeeded but `createEscrowAllocations` failed: cancel the order (updates orderStatus to 'cancelled'), restore stock immediately, and void escrow allocations
- If `Order.create` never succeeded: simple in-memory rollback (existing behavior)
- This ensures inventory is restored exactly once regardless of failure point

**Tests:** 5/5 passing covering:
1. reservation → failure before Order.create (stock restored)
2. reservation → Order.create → later failure (stock restored via cancel)
3. successful checkout (stock decremented at payment, not double-restored)
4. repeated failure/recovery (multiple checkouts fail, stock consistent)
5. no double restoration (cancel + sweeper cannot both restore)

---

## RB-02: ESCROW RETRY AFTER REFUND/VOID ✅ FIXED

**Problem:** A failed escrow/wallet operation may be retried after an order has been refunded or voided. A refunded or voided allocation must NEVER become vendor wallet credit through retry.

**Fix Applied:**
- Modified `retryFailedAllocations` in escrowService.js
- Added check at start: if order paymentStatus='refunded' OR orderStatus='cancelled', skip retry and return skipped count
- Only process retries for active orders (paid, not cancelled/refunded)
- Updated return value to include `skipped` count
- Fixed status check: `releaseAllocation` returns 'available' not 'releasing'
- Updated `retryEscrowPayouts` controller to check order state before calling retry and include skipped in response

**Tests:** 6/6 passing covering:
1. wallet credit failure (allocation stuck in failed, can be retried)
2. retry before refund (should succeed)
3. retry after refund (should NOT retry - allocation stays failed)
4. retry after void (should NOT retry - allocation stays failed)
5. duplicate retry (idempotent - second retry does not double-process)
6. concurrent retry workers (only one should succeed)

---

## RB-03: PAYMENT PAID-FLIP RESURRECTION ✅ FIXED

**Problem:** A cancelled order must never be resurrected to paid. A refunded order must never be resurrected to paid. Multiple paths could set paymentStatus='paid' without checking order status.

**Fix Applied:**
- **Paystack webhook** (paymentRoutes.js): Added `AND orderStatus NOT IN ('cancelled', 'refunded')` to the UPDATE query
- **verify-paystack endpoint** (paymentRoutes.js): Same guard on the UPDATE query
- **recoverStuckPendingOrders** (escrowService.js): Same guard on the UPDATE query
- **updateOrderToPaid** (orderController.js): Added explicit check at start - reject if paymentStatus='refunded' OR orderStatus='cancelled'
- All paths now use atomic conditional updates with orderStatus guards

**Tests:** 10/10 passing covering:
1. normal payment (webhook marks order paid)
2. duplicate webhook (second webhook should not double-process)
3. webhook after cancellation (should not resurrect cancelled order)
4. webhook after refund (should not resurrect refunded order)
5. verification after cancellation (verify-paystack endpoint)
6. verification after refund (verify-paystack endpoint)
7. recovery after cancellation (recoverStuckPendingOrders)
8. recovery after refund (recoverStuckPendingOrders)
9. admin mark-paid against cancelled order (updateOrderToPaid)
10. admin mark-paid against refunded order

---

## RB-04: INVENTORY DOUBLE RESTORATION ✅ FIXED

**Problem:** Cancellation and reservation expiry can both restore the same stock. Concurrent cancel + expiration sweeper must never restore stock twice. Repeated cancellation must be idempotent. Sweeper retries must be idempotent.

**Fix Applied:**
- **Sweeper** (reservationService.js): Now also updates `orderStatus = 'cancelled'` when releasing expired reservations (along with zeroing reserved markers)
- **cancelOrder** (orderController.js):
  - Uses conditional UPDATE with `WHERE orderStatus IN ('pending', 'processing')` and checks `affectedRows`
  - If `affectedRows === 0`, another process (sweeper or concurrent cancel) already cancelled it → skip all processing including stock restoration
  - Re-fetches current items to get latest reserved markers
  - Only restores stock if `statusChanged === true` AND (`wasPaid === true` OR `reservedTotal > 0`)
  - This prevents double restoration when sweeper already ran

**Tests:** 4/4 passing covering:
1. cancel + expiration sweeper concurrent (no double restore)
2. repeated cancellation is idempotent (no double restore)
3. sweeper retries are idempotent (no double restore on retry)
4. atomic conditional updates prevent race conditions (10 concurrent operations)

---

## Additional Fixes

### RB-10: ADMIN MARK-PAID ✅ FIXED
- Admin payment recovery now obeys the same financial state machine
- Cannot bypass cancellation or refund states
- Uses atomic guarded update with explicit error message

---

## Test Results Summary

| Test Suite | Tests | Pass | Fail |
|------------|-------|------|------|
| rb01-checkout-rollback | 5 | 5 | 0 |
| rb02-escrow-retry | 6 | 6 | 0 |
| rb03-payment-paid-flip | 10 | 10 | 0 |
| rb04-inventory-double-restore | 4 | 4 | 0 |
| stockRace | 6 | 6 | 0 |
| reservation | 5 | 5 | 0 |
| paymentHardeningSchema | 5 | 5 | 0 |
| authSessionRevocation | 4 | 4 | 0 |
| **TOTAL NEW TESTS** | **25** | **25** | **0** |

---

## Remaining Risks

1. **RB-06 (Google OAuth State)** - Not addressed in this session. The OAuth state validation exists but needs verification that application-generated state and Passport state handling are consistent.

2. **RB-07 (Login Lockout)** - Not addressed. Account-wide lockout can reveal account existence and allow DoS. Needs progressive mechanism keyed on IP + normalized email.

3. **Partial Refunds test failure** - Pre-existing issue in `tests/partialRefunds.test.js` (test 2 fails) unrelated to these changes.

4. **Refund Reconcile test failure** - Pre-existing issue in `tests/refundReconcile.test.js` (test 1 fails) unrelated to these changes.

---

## Things Deliberately NOT Changed

- No new features added
- No microservices, Kafka, Kubernetes, sharding, or event buses introduced
- No redesign of architecture
- No changes to money calculation logic
- No changes to Paystack authenticity verification
- No changes to idempotency mechanisms (only strengthened them)

---

## Ready for Next Security-Review Stage?

**YES** - The current tree has fixes for RB-01, RB-02, RB-03, RB-04, and RB-10 with comprehensive regression test coverage. All new tests pass and existing related tests continue to pass. The pre-existing test failures in partialRefunds and refundReconcile are unrelated to these changes.

The next model can independently review and attack these changes.

---
---

# REMEDIATION REPORT — fix/global-production-integration (2026-10-10)

**Task:** resolve the three remaining issues from the independent integrated verification
(`INTEGRATED_VERIFICATION_REPORT.md`, verdict: CONDITIONAL PASS, 652/655 tests).
**Preceding content of this file (RB-01…RB-10 remediation summary) is preserved verbatim above.**

| Meta | Value |
|---|---|
| Project | Kente Market |
| Branch | `fix/global-production-integration` — **confirmed = actual branch** |
| Reported baseline | `2df4428` — **confirmed = actual HEAD** (`2df4428 integrate: unify global-production checkout+shipping+payments (fail-closed)`) |
| Commits made / pushed | **none** (`git diff --cached` empty, HEAD unchanged, nothing pushed) |
| Database used | **disposable local MySQL only** (see §6) |

---

## 1. Exact files changed by this remediation

| File (exact path) | Kind of change | Reason |
|---|---|---|
| `backend/Services/escrowService.js` | 3 targeted edits (all confined to the payment-side-effects block + one JSDoc line) | FIX 1 |
| `backend/tests/paymentLifecycleRecovery.test.js` | 4 new regression tests + JSDoc typing of existing fixtures + fixture null-guard | FIX 1 regression coverage |
| `backend/tests/paymentHardeningSchema.test.js` | fixture only: one extra `INSERT IGNORE INTO wallet_transactions` in `setupClawbackScenario` + comment | FIX 2 |
| `backend/package.json` | 1 line: `"password:reset:test": "node scripts/password-reset-flow.js"` | FIX 3 |
| `backend/test-password-reset.js` → `backend/scripts/password-reset-flow.js` | **moved** (git sees delete + new file); only the 2 relative import paths and the header comment changed — body byte-for-byte otherwise identical | FIX 3 |
| `REMEDIATION_REPORT.md` | appended this section + 2-line pointer under the existing H1 | deliverable |

**Deliberately NOT touched by this remediation** (already modified by the three workstreams before this session; verified against the `git status` captured before the first edit):
`backend/Services/reservationService.js`, `backend/Services/shippingService.js`,
`backend/controllers/internationalCheckoutController.js`, `backend/controllers/orderController.js`,
`backend/migrateExchangeRates.js`, `backend/migrateShippingCarriersRates.js`,
`backend/routes/paymentRoutes.js`, `backend/tests/internationalCheckoutUnified.test.js`,
`branding_house.sql`, `docs/international-checkout-contract.md`, `backend/migratePaymentProcessingState.js`,
`backend/tests/escrowCancellationRefund.test.js`, `backend/tests/internationalFxThreshold.test.js`,
`backend/tests/helpers/intlMissingTableProbe.mjs`.
No financial, escrow, webhook, refund or international-checkout logic outside §2 was altered.

### 1a. Precise edits inside `backend/Services/escrowService.js`

1. **`checkPaymentSideEffects` rewritten** (helpers `NON_COUPON_SIDE_EFFECTS`, `REQUIRED_SIDE_EFFECTS`, `orderHasCoupon` added):
   - selects `paymentSideEffects, couponId`;
   - `couponConsumed` is required **only when the order carries a coupon**;
   - `escrowHeld`, `stockDecremented`, `financialEventRecorded`, `platformRevenueTracked` remain required for **every** order;
   - unknown order id ⇒ `{complete:false, missing:<full set>}` (fail closed);
   - `paymentSideEffects` NULL / scalar / malformed ⇒ `{complete:false, missing:<required set>}` (fail closed);
   - coupon field `null` / `undefined` / `0` / `''` / `'null'` / `'undefined'` / `'false'` ⇒ coupon-free; **any other value (including malformed text) is treated as a coupon**, so `couponConsumed` stays mandatory (fail closed).
2. **`recoverIncompletePaidOrders` WHERE clause**: the `couponConsumed IS NULL/false` disjunct now only applies when `couponId IS NOT NULL AND couponId <> 0`. Without this, a fully-recovered *coupon-free* order is re-selected by every recovery scan forever and counted as “recovered” although nothing is left to do. Recovery step 3 (`if (!…couponConsumed && order.couponId) consumeCouponForOrder(...)`) and every other recovery step are unchanged — recovery guarantees were **not** weakened.
3. **`OrderLine` JSDoc**: `@property {number | string | null} [vendorId]` (allows `null`, which is how platform-owned lines are represented everywhere in the code). JSDoc only, zero runtime effect.

---

## 2. Root cause of each failure and the fix

### FIX 1 — `paymentLifecycleRecovery.test.js` → `recoverIncompletePaidOrders is idempotent`
*Observed at session start:* `AssertionError: Expected values to be strictly equal: false !== true` at `tests/paymentLifecycleRecovery.test.js:385` (17 tests, 16 pass, 1 fail).

**Root cause (product-diagnostic defect):** `checkPaymentSideEffects` hard-coded
`['escrowHeld','stockDecremented','couponConsumed','financialEventRecorded','platformRevenueTracked']`
for every order, but neither the webhook path nor `recoverIncompletePaidOrders` ever writes
`couponConsumed` when `order.couponId` is absent. Every paid order without a coupon therefore stayed
`complete:false` forever, even after recovery had finished all of its real work — producing false
“incomplete payment processing” reports and unbounded re-selection in the recovery query.

**Fix:** coupon-conditional requirement (§1a.1) + coupon-conditional recovery selection (§1a.2).
Orders with a coupon still must show a *successful, real* consumption; the four non-coupon effects are
untouched; unknown/malformed state still fails closed; no assertion was loosened —
`assert.equal(check.complete, true)` and `assert.deepEqual(check.missing, [])` remain.

**New/changed regression tests (4 added, 0 weakened):**
| Test | Covers |
|---|---|
| `no-coupon order completes without couponConsumed` | coupon-free order: `couponConsumed` never in `missing`; untouched order still `complete:false` (other effects still reported); complete only after the 4 real effects |
| `coupon order still requires couponConsumed` | coupon order with all 4 non-coupon effects ⇒ `missing === ['couponConsumed']`; after a **real** `consumeCouponForOrder` + marker ⇒ complete |
| `no-coupon sentinels (couponId = 0) and unknown orders are handled safely` | `couponId = 0` ⇒ coupon-free; **unknown order id ⇒ `complete:false`, `missing` non-empty** (fail closed) |
| `recoverIncompletePaidOrders consumes the coupon for coupon orders` | recovery really settles the slot (`couponUseState` 1→2) and sets `couponConsumed:true`, then stays complete on a second pass |

### FIX 2 — `paymentHardeningSchema.test.js` → `voidEscrowForOrder clawed back the credited advance`
*Observed at session start:* `AssertionError: wallet must be debited by the clawback — 90 !== 0` (5 tests, 4 pass, 1 fail).

**Root cause (fixture-setup defect, production code correct):** `setupClawbackScenario` credited
`vendor_wallets` by direct SQL but never wrote the matching `wallet_transactions` row with
`type='credit' AND allocationId=<id>`. `clawbackAvailableAllocation` (escrowService.js) deliberately
refuses to debit a wallet it cannot prove was credited — it returned `'voided-uncredited'`, so the
balance stayed at 90 and the clawback ledger/financial-event rows were (correctly) not written.

**Fix:** the fixture now also inserts the credit ledger row
(`INSERT IGNORE INTO wallet_transactions (vendorId, type, amount, allocationId, note, status) VALUES (?, 'credit', 90.00, ?, …,'succeeded')`)
— deterministic, self-contained, `RUN_ID`-scoped data, inserted only into the disposable DB, cleaned up by the existing `after()` hook. **Every original assertion is unchanged** (allocation `failed` + reason, wallet `0`, exactly one clawback row, exactly one `escrow.clawback` journal row, second run moves no money).

### FIX 3 — `test-password-reset.js` discovered as a test
*Observed at session start:* `not ok 1 - test-password-reset.js` from a bare `node --test`.

**Root cause:** the file is a **standalone manual utility** (calls `testPasswordReset()` at module
scope, needs a pre-registered user, `process.exit(1)` when none exists) that happens to sit in the
`backend/` root. Node's default test-file pattern includes `**/test-*.js`, so a bare `node --test`
picked it up. CI itself (`npm test --prefix backend` → `node --test "tests/**/*.test.js"`) never did.

**Fix (move, behaviour preserved):**
- moved to **`backend/scripts/password-reset-flow.js`** — `backend/scripts/` is the project's
  scripts directory for backend-side utilities (a repo-root `scripts/` cannot host it: `dotenv`,
  `bcryptjs` and `nodemailer` live only in `backend/node_modules`, so moving it out of `backend/`
  would break the utility);
- the file name no longer matches any Node test pattern (`test-*`, `*-test`, `*.test.*`,
  `**/test/**`), so the runner no longer discovers it — proven both by a controlled experiment and
  by the full-suite output below;
- only the two relative imports (`./models/…` → `../models/…`, `./utils/…` → `../utils/…`) and the
  header comment changed; behaviour is untouched;
- `backend/package.json` script `password:reset:test` re-pointed to the new path.

**No CI job or workflow depends on the old path.** `.github/workflows/ci.yml` runs only
`npm test --prefix backend`, `npm run db:setup --prefix backend`, lint/typecheck/build — grep for
`test-password-reset` across `.github/`, `docs/`, `README.md`, `*.yml` and `*.sh` matches nothing
except this report. `README.md` documents the command as `npm run password:reset:test --prefix backend`,
whose name is unchanged, so no documentation command broke.

**Discovery evidence (controlled experiment):** in a scratch directory a bare `node --test` executed
`scripts/test-password-reset.js` (`ok 1 - scripts/test-password-reset.js`) but never touched
`scripts/password-reset-flow.js` (only `ok 1 - ok`, `# tests 1`). In the real full runs the string
`password-reset-flow` appears **0 times** in the output.

---

## 3. Commands executed and observed results

All commands run from the repo unless stated; **every** DB-touching command carried
`DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD= DB_NAME=branding_house DB_SSL=0`.

### 3.1 Baseline reproduction (before any edit)
| Command | Exit | Result |
|---|---|---|
| `node --test tests/paymentLifecycleRecovery.test.js` | 1 | 17 tests, **16 pass, 1 fail** — `recoverIncompletePaidOrders is idempotent: false !== true` |
| `node --test tests/paymentHardeningSchema.test.js` | 1 | 5 tests, **4 pass, 1 fail** — `wallet must be debited by the clawback: 90 !== 0` |
| bare `node --test` (per verification report) | 1 | 655 tests, **652 pass, 3 fail** incl. `not ok 1 - test-password-reset.js` |

### 3.2 Individual affected tests (after remediation)
| Command | Exit | Tests | Duration |
|---|---|---|---|
| `node --test tests/paymentLifecycleRecovery.test.js` | **0** | **21 / 21 pass, 0 fail** | 8.64 s |
| `node --test tests/paymentHardeningSchema.test.js` | **0** | **5 / 5 pass, 0 fail** | 2.41 s |
| `npm run password:reset:test --prefix backend` (path check) | 1 (by design) | utility runs from `scripts/`, prints `User not found. Please register first.` and exits 1 — identical documented behaviour; no user exists in the disposable DB, so **no email was sent** | <1 s |

### 3.3 Focused suites — payment / escrow / refund (16 files)
`paymentLifecycleRecovery, paymentHardeningSchema, paymentCurrencyContract, paystackReferenceGuard,
partialRefunds, escrowLogic, escrowCancellationRefund, settlement, refundDoubleSpend, refundGuard,
refundReconcile, refundRestore, rb01-checkout-rollback, rb02-escrow-retry, rb03-payment-paid-flip,
rb04-inventory-double-restore`

→ **exit 0 — 154 tests, 154 pass, 0 fail, 0 skipped, 33 suites, 31.41 s** (identical 154/154 on the earlier run: 12.54 s).

### 3.4 Focused suites — shipping / FX (6 files)
`vendorShipping, internationalCheckout, internationalCheckoutUnified, internationalFxThreshold, tracking, money`

→ **exit 0 — 102 tests, 102 pass, 0 fail, 0 skipped, 22 suites, 79.10 s** (identical 102/102 earlier run: 47.68 s).

### 3.5 Complete backend suite (disposable MySQL) — final, after all edits
| Command | Exit | Tests | Suites | Fail | Skipped | Duration |
|---|---|---|---|---|---|---|
| `node --test` (verification-report command, bare) | **0** | **658** | 139 | **0** | 0 | 163.66 s |
| `npm test` (= CI invocation `node --test --test-concurrency=4 "tests/**/*.test.js"`) | **0** | **658** | 139 | **0** | 0 | 167.33 s |

`grep -c "^not ok"` = **0** for both; `password-reset-flow` occurrences in output = **0**.

### 3.6 Lint / typecheck / syntax
| Check | Exit | Result |
|---|---|---|
| `npm run lint` (whole repo, as CI runs it) | **0** | 0 errors, 13 pre-existing warnings (all `@typescript-eslint/no-explicit-any` in `src/**` frontend files) |
| `npx eslint` on the 4 changed JS files | **0** | 0 problems |
| `npm run typecheck` (root `tsc --noEmit`, as CI runs it) | **0** | clean |
| `npm run typecheck --prefix backend` | 2 | **3 errors, all pre-existing and out of scope** — see §5 |
| `node --check` on `escrowService.js`, both changed test files, `scripts/password-reset-flow.js` | **0** | syntax OK |
| `JSON.parse` of `backend/package.json` | 0 | valid |

---

## 4. Test totals before and after

| | Before (verification report + reproduced at session start) | After (final runs) |
|---|---|---|
| Test files discovered | 139 suites **+ 1 non-test script** | 139 suites, **non-test script no longer discovered** |
| Total tests | **655** | **658** |
| Passed | **652** | **658** |
| Failed | **3** | **0** |
| Skipped | 0 | 0 |
| `paymentLifecycleRecovery.test.js` | 17 / 16 pass / **1 fail** | **21 / 21 pass** (+4 regression tests) |
| `paymentHardeningSchema.test.js` | 5 / 4 pass / **1 fail** | **5 / 5 pass** |
| `test-password-reset.js` | counted as 1 failing “test” | removed from discovery (utility preserved at `backend/scripts/password-reset-flow.js`) |
| Total duration | ~158 s | 161–167 s across runs |

Arithmetic check: 655 − 1 (non-test script no longer discovered) + 4 (new regression tests) = **658** ✔

---

## 5. Remaining failures and evidence-based classification

| Item | Status | Classification / evidence |
|---|---|---|
| **Required tests** (payment, escrow, refund, shipping, FX, full suite) | **0 failures** | §3.3–3.5, exit 0 on both runner invocations |
| `npm run typecheck --prefix backend` exits **2** with **3** errors: `Services/shippingService.js:382,397` (`staleRate` missing from a declared return type) and `migratePaymentProcessingState.js:11` (`mysql.createConnection` typing) | remaining | **Pre-existing / out of scope.** Both files are workstream files that this remediation never edited (they were already `modified`/untracked in the `git status` captured **before** the first edit, and the errors are in code this task did not write). Classified as workstream-introduced type debt in shipping/FX and the payment-state migration — i.e. exactly the “unrelated international checkout / migration logic” this task is told not to touch. Fixing them would require editing files outside the three reported issues. |
| Backend typecheck error count trend | improved | 61 errors immediately after the regression tests were added → **3** after JSDoc-typing the fixtures in the test file this task had to extend (`state` bag, `createTestOrder`/`round2` param types, `cols` cast, `OrderLine.vendorId` JSDoc, fixture null-guard). All of these are comments/guards with **zero runtime change**; no assertion was altered. |
| Workstream risks listed in `INTEGRATED_VERIFICATION_REPORT.md` §6 (3-way race coverage, FX staleness policy, monitoring prerequisites) | unchanged | Out of scope — no new audit performed, no feature work. |

No test was skipped, deleted, or loosened to obtain these results: every previously failing assertion
(`complete === true`, `wallet.available_balance === 0`, exactly-one clawback/journal rows) is still
present and now passes against real code/fixture corrections.

---

## 6. Database confirmation (which database was used)

* **Type:** local disposable MySQL (Ubuntu package), datadir `/tmp/mysql_test`, **host `127.0.0.1`, port `3307`**, user `root` (no password), `DB_SSL=0`.
* **Proof from inside the app's own pool:** `SELECT @@port, DATABASE()` via `backend/config/db.js` with the same env overrides returned `{"p":3307,"d":"branding_house"}`.
* **TiDB Cloud was never used:** `backend/.env` still points at `gateway01.eu-central-1.prod.aws.tidbcloud.com:4000`, but `dotenv` never overrides variables that are already set, and every command in §3 exported the local overrides explicitly. No credentials from `.env` were sent anywhere.
* **No migrations were executed by this remediation** (schema was already provisioned by the workstreams); no data was written outside the disposable instance; test fixtures are created and cleaned up by each suite's own `before`/`after` hooks.
* **No Paystack or other network calls:** no payment API was contacted; no real financial transaction was created; nothing was pushed, committed or deployed.

---

## 7. Final diff review

* `git status` file set is identical to the pre-edit snapshot **plus** this task's own artefacts
  (`backend/scripts/`, moved utility, `paymentHardeningSchema.test.js`, appended report).
* `git diff --stat` changes to `escrowService.js` attributable to this task are confined to the
  payment-side-effects block (§1a); `package.json` diff = 1 line beyond the workstream's
  `db:migrate` chain line; `paymentHardeningSchema.test.js` diff = +12/−1 (fixture only).
* **No changes** to `paymentRoutes.js`, `orderController.js`, `internationalCheckoutController.js`,
  `shippingService.js`, `reservationService.js`, `branding_house.sql`, `docs/*` were made by this
  remediation — escrow release/void/clawback, webhook/verify/refund, stock, coupon, FX and shipping
  logic are untouched except for the two diagnostic lines described in §1a.
* Git state: **nothing staged, nothing committed, nothing pushed.** `HEAD = 2df4428`, branch
  `fix/global-production-integration`, remote `origin` untouched.

---

## 8. FINAL VERDICT: **PASS**

**Why PASS (not conditional):** all three conditions of the preceding CONDITIONAL PASS are resolved
and verified —
1. `checkPaymentSideEffects` no longer reports coupon-free orders as incomplete, while coupon orders
   still require real consumption and unknown/malformed state still fails closed (4 new regression
   tests, existing assertions intact);
2. `paymentHardeningSchema.test.js` passes on disposable MySQL with its **original** assertions and a
   correct fixture;
3. the standalone password-reset utility was moved to `backend/scripts/password-reset-flow.js`,
   works from its new location, is referenced by the updated npm script, and is **no longer
   discovered by the test runner** (no CI job referenced the old path).

**Evidence:** complete backend suite **658/658 pass, 0 fail, exit 0** on disposable MySQL for both
the bare `node --test` and the CI `npm test` invocation; focused payment/escrow/refund
**154/154** and shipping/FX **102/102**; lint exit 0; root typecheck exit 0; syntax checks exit 0.

**Disclosed, out of scope (not a condition on this remediation):** `npm run typecheck --prefix backend`
still exits 2 because of 3 pre-existing type errors in two workstream files this task never touched
(`shippingService.js`, `migratePaymentProcessingState.js`) — classified in §5 with evidence.

**Not done, per instructions:** no commit, no push, no deployment, no Paystack contact, no migration,
no interaction with the shared TiDB `branding_house` database.
---

# PAYMENT-REFERENCE / PAYSTACK AUDIT + LATE-CHARGE REMEDIATION (2026-10-10, session 3)

Scope: audit of payment-reference handling and the Paystack integration (compiled module
`paymentRef-Dfw50SUp.js` → source `src/utils/paymentRef.ts` and callers), followed by the
smallest complete fix for the gaps that survived the previous remediation rounds.

## Verified findings fixed in this round

1. **F-1 (High) — captured funds silently dropped on terminal orders.** A `charge.success`
   webhook for an order that had been cancelled (or refunded via the return path) matched 0 rows
   in the paid-flip `UPDATE`, fell into the "order not yet created, retry" loop, answered `500`
   to every Paystack redelivery, and never issued a refund. `recoverStuckPendingOrders` skipped
   the same case with a bare `continue`. The customer's money was captured with no refund, no
   journal entry, and no reconciliation record beyond an ever-retried webhook row.
   **Fix:** new `backend/Services/paymentReconciliationService.js` — `reconcileTerminalOrderCharge`
   pushes a REAL Paystack refund through the shared `orders.refundReference` CAS claim (same claim
   used by `cancelOrder` and both return-refund paths), flips `paymentStatus → 'refunded'`, and
   journals `refund` under the shared full-refund dedupe key `refund:${orderId}`. Wired into the
   webhook `charge.success` handler (terminal-order branch; refund failure → `500` + durable
   `failed` state so redelivery retries), the `verify-paystack` fallback, and
   `recoverStuckPendingOrders` (flip-miss on a terminal order now reconciles instead of skipping).
   Orders are NEVER resurrected.

2. **F-2 (Medium) — verify-paystack PII disclosure / missing ownership on paid orders.**
   The ownership check ran only on the *unpaid* branch, so any authenticated user could POST a
   reference whose order was already `paid` (or was not yet bound) and read the payer's Paystack
   customer block (email/name/phone) in the response.
   **Fix:** ownership (owner or admin) is now enforced whenever an order is bound to the
   reference; an unbound reference returns only `{reference, orderMarkedPaid:false}`.

3. **F-3 (Medium) — refunded orders could be flipped back to `paid` by repeated verification.**
   All three flip guards used `paymentStatus != 'paid'`, which admits `'refunded'`. A refunded
   order whose `orderStatus` had not been moved to a terminal value (the return path flips only
   `paymentStatus`) could be resurrected by a duplicate `verify-paystack` call or webhook
   redelivery. **Fix:** every flip is now `paymentStatus IN ('pending','failed')`
   (webhook, verify fallback; the recovery job already required `'pending'`).

4. **F-4 (Low) — `charge.failed` events were only stdout.** They are now receipted durably in
   `webhook_events` (`INSERT IGNORE`, `processed`, idempotent) for ops/reconciliation visibility.
   Order state is intentionally unchanged (the customer may retry with a fresh charge).

5. **F-5 (Low) — browser storage.** `pendingPaymentRef:draft` was a single shared bucket for
   unrelated checkout flows, entries never expired, and the payload format had no timestamp.
   **Fix:** the draft bucket is now flow-scoped (`order` vs `custom`), entries are stored as
   `{reference, savedAt}` with a 24 h TTL (stale entries are removed, never replayed), legacy
   plain-string entries from a running tab remain readable. `sessionStorage` stays UI-recovery
   state only — the backend verifies every reference against Paystack and the webhook remains the
   financial authority, so cleared storage cannot lose a payment (backend recovery is unchanged).

## Files changed (this round)

- `backend/Services/paymentReconciliationService.js` (new)
- `backend/routes/paymentRoutes.js` (verify ownership/PII/terminal branch; webhook terminal branch
  + flip narrowing + `charge.failed` receipt)
- `backend/Services/escrowService.js` (`recoverStuckPendingOrders` reconciles terminal-order
  flip-misses; import)
- `backend/tests/paymentLateCharge.test.js` (new — 11 tests, real HTTP + HMAC + stubbed axios)
- `src/utils/paymentRef.ts` (scoped keys, TTL, JSON envelope)
- `src/utils/__tests__/paymentRef.test.ts` (7 tests: scoping, TTL expiry, legacy format, corrupt)
- `src/Pages/CustomRequest/CustomRequestCheckout.tsx` (uses the `custom` scope)
- `REMEDIATION_REPORT.md` (this section)

No migrations: no schema change. All new state reuses existing columns
(`orders.refundReference`, `webhook_events`, `financial_events.dedupeKey`).

## Test evidence (this round)

- `paymentLateCharge.test.js`: **11/11 pass** (webhook reconciliation, duplicate delivery,
  invalid HMAC, amount mismatch, refund-failure retry, verify ownership/PII, refunded-order
  non-resurrection, verify-path reconciliation, recovery-job reconciliation, flip-guard truth
  table).
- Payment-focused backend set (22 files, `--test-concurrency=1`): all pass except the
  **pre-existing environmental** `refundReconcile.test.js` "admin alerted" case — the alert fan-out
  notifies `role='admin' LIMIT 5`, and the shared dev database now contains 20 leaked test-admin
  users from earlier runs, so a freshly created admin is outside the fan-out. Not caused by this
  change (reproduced by probe; the alert branch runs and the notification is created for the
  oldest 5 admins).
- Frontend: `vitest src/utils/__tests__ src/Pages` **35/35 pass**; root `tsc --noEmit` exit 0.

## Known limitations / ops notes

- Client-side Paystack **Inline** remains the charge-init mechanism (references are minted by the
  browser/Paystack Inline, then proven server-side by Paystack verification with exact amount +
  currency + ownership, and by the signed webhook). Moving reference generation server-side would
  require switching to Paystack's server-side `transaction/initialize` (redirect) flow — an
  architectural change deliberately NOT taken here.
- An orphaned successful charge whose reference is never bound to an order is durably recorded in
  `webhook_events` (`failed`, "Order was not found after retry window") and remains a manual
  reconciliation item; Paystack redelivery retries while order creation may still be in flight.
- If a process crashes between a late-charge refund acceptance and its bookkeeping, the
  `refundReference` claim stays set; `reconcileRefundedButPaid` (15-min job) already detects and
  alerts on that shape.
- Webhook refund-retry currently depends on Paystack redelivery after a `500`; there is no
  independent re-drive job for `charge.success` rows stuck `failed` — a known gap, bounded by
  Paystack's redelivery window.
