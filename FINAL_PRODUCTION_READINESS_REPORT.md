# Final Production Readiness Report — Kente Market

Mission: `backend/docs/release-plan.md`. Date: 2026-10-11; continuation and re-verification 2026-10-12 (see §8). Branch
`fix/global-production-integration` @ `2df4428` (unchanged). **Nothing was committed,
pushed, deployed, or run against production or any shared database. No Paystack request
was made.** All database work used a disposable MySQL 8.4.11 started by this session
(own datadir, `127.0.0.1:33099`), through a wrapper that shadows every key in
`backend/.env` and refuses non-loopback hosts.

## 1. Verdict: **GO FOR STAGING VALIDATION**

Every local engineering gate passes, including a fresh install and an upgrade path. The
release is **not** production-approved. That needs the staging runbook to pass on TiDB with
Paystack test mode, and decisions D-1…D-4 below to be made. The baseline had two critical
defects: the backend could not boot, and custom-order payments charged customers without
creating orders. Both are fixed and regression-tested. Several of the previous reports'
"PASS" claims were not reproducible on a fresh database; see §3.

## 2. Gates — before vs after

| Gate | Baseline (start) | Final |
|---|---|---|
| Backend tests, fresh install (`db:setup` → `npm test`) | **726: 703 pass, 3 fail, 20 cancelled** (exit 1) | **765/765 pass** (exit 0, 2026-10-12) |
| Backend tests, upgraded DB (×3 consecutive + final) | — | **740/740** every run; 748/748 after SEC-4; **765/765** after the 2026-10-12 continuation |
| Backend tests, no database (CI skip path) | 6 fail (would turn CI red) | exit 0 — 425 pass, 111 skipped, 0 fail |
| Backend typecheck | exit 2 — 3 errors (with `// @ts-check` deleted from a test to hide 27 more) | **exit 0 — 0 errors**, `// @ts-check` restored |
| Lint | exit 1 — 17 errors (incl. a real `no-undef`) | **exit 0 — 0 errors** (13 pre-existing `no-explicit-any` warnings) |
| Frontend typecheck / vitest / build | pass / 75/75 / pass | pass / 75/75 / pass |
| All backend modules import (boot) | **FAIL** — `customRequestController.js` link error | 147/147 modules; new test guards it |
| `db:setup` fresh install | exit 0 but 3 statements silently failed | exit 0; only harmless M-4 noise |
| Dependency audit | — | runtime 0 vulns both workspaces; CI ratchet passes |
| Secret scan (gitleaks, full history) | — | no leaks; working-tree hits only in git-ignored `backend/.env` |

Commands (from `backend/`, with the disposable-DB wrapper): `npm run db:setup`,
`npm run db:migrate`, `npm test`, `npm run typecheck`; from the root: `npm run lint`,
`npx tsc --noEmit -p tsconfig.json`, `npm run test:frontend`, `npm run build`.

## 3. Contradictions with previous reports

- `REMEDIATION_REPORT.md` "658/658, PASS": not reproducible on a fresh DB. Two alert tests
  passed only because admin users already existed in the database, and the F-2/F-3 escrow
  suite never ran (it was hard-wired to `:3307` as root).
- `FINAL_PRE_PUSH_AUDIT.md` B-4 recommended wiring `recoverIncompletePaidOrders` as it
  was. Doing that would have re-run stock, coupon and revenue effects on **every
  historical paid order**, because no production path ever recorded the markers it read.
  The job is now redesigned (C-3) before being wired.
- `INTEGRATED_VERIFICATION_REPORT.md` "no production deployment blockers": contradicted by
  C-0 and C-1.

## 4. Defects fixed (all with regression tests run on the disposable DB)

| ID | Sev. | Defect | Fix | Test |
|---|---|---|---|---|
| C-0 | Critical | Backend could not boot: `customRequestController.js` imported names `escrowService.js` does not export | Import from defining modules | `moduleGraph.test.js` (mutation-checked) |
| C-1 | Critical | Custom-order checkout `ReferenceError` after Paystack verification → charged, no order | Function-scope vars | `customRequestCheckoutHandler.test.js` — 4 tests through the real handler (mutation-checked) |
| C-2 | High | Custom orders stored `{}` instead of the customer's delivery address (regression vs HEAD) | Restored | same suite |
| C-3 | High | Paid-order side effects never tracked; recovery would mass-mutate history; a crash after the paid flip lost stock/coupon/revenue forever; four divergent copies of the side effects (stuck recovery skipped journal and revenue; no-reference admin orders shared dedupe key `charge.collected:undefined`) | One shared `applyPaidOrderSideEffects`; every paid flip opts the order in (`paymentSideEffects = {}`); per-effect markers; stock idempotent via the `stock_moves` sale ledger | `paidSideEffects.test.js` — 8 tests incl. crash mid-decrement, untracked history untouched, webhook redelivery (2 mutation checks) |
| B-4 | High | Recovery unbounded, included cancelled orders, not scheduled; stuck-pending scan re-verified every pending order ever (unbounded Paystack calls) | Bounded batches, 10-min grace, 5-attempt cap + admin alert, terminal orders excluded, wired under the distributed lock; stuck-pending limited to 1h–7d, 100/run | same |
| B-3 | Medium | Platform revenue charged the whole order discount to platform lines on mixed orders | Whole-order denominator | B-3 reconciliation test (mutation-checked) |
| SEC-2 | Medium | Admin mark-paid CAS could resurrect a refunded order | CAS excludes `refunded` | `adminMarkPaidRace.test.js` (mutation-checked) |
| SEC-1 | Medium | Buyer could overwrite vendor's completion date / production note | Denylist | `orderOwnerFields.test.js` (mutation-checked) |
| R-5 | Medium | Failed/unknown refund on return approval reported as success | `refundOutcome` + message; admin UI warns | `returnRefundOutcome.test.js` |
| A-1 | Medium | Admin alerts to an arbitrary 5 admins (no ORDER BY); none at all → alert silently dropped | Deterministic order; shared `notifyAdmins` logs loudly when nobody can be notified | `paymentRecovery`, `refundReconcile` (stressed with 6 pre-existing admins) |
| S-1 | High (safety) | `npm test` wrote to the hosted TiDB DB from `.env` | Test DB guard | refusal verified |
| S-2 | High (safety) | `npm run db:setup` could `DROP DATABASE` on the hosted DB | Loopback-only unless explicit opt-in | refusal verified |
| M-1/2/3 | Medium | Migrations failed silently (2 × DDL clause order, 1 × JSON index) | Fixed | fresh + idempotent re-run |
| B-1 | High (CI) | Backend typecheck red; `// @ts-check` removed to hide errors | Types fixed, directive restored | typecheck 0 |
| T-1/T-2/T-3 | Medium (CI) | Escrow suite pinned to :3307; alert tests depended on pre-existing admins; custom-checkout suite never skipped without a DB; one assertion vacuous (`assert.fail` inside a swallowing `catch`) | Fixed | suites pass with and without DB |
| SEC-4 | Low | Deactivated staff / inactive store answered 401 (SPA logs the user out as "session expired") instead of 403 with the reason | Staff branch keeps its decided status, like the owner branch | `staffAuthStatus.test.js` (mutation-checked) |
| L-1 | Low | Lint errors | Fixed | lint 0 errors |
| SEC-7 | Medium | Error handler (unreviewed previous-model change) passed an unhandled provider error's **upstream** status to the browser — a Paystack 401 logged the customer out | Status only from http-errors instances | `tryOnUploadSecurity.test.js` +4 (mutation-checked) |
| SEC-8 | Low-Med | Response cache stored error bodies and replayed them as 200 for the TTL | Cache 2xx only | `cacheMiddleware.test.js` (mutation-checked) |
| SEC-9 | Low | `password:reset:test` script issued a live reset token for a hard-coded real address against the `.env` database and printed part of it | Address required as argument; token never printed | manual script |
| TIDB-1 | Medium | STORED generated column added via ALTER — unsupported on TiDB | VIRTUAL (identical values, nothing reads it) | `migrationPortability.test.js` (mutation-checked) + fresh/upgrade runs |
| M-5 | Low | Two migration `down()` functions used MariaDB-only syntax | Portable existence checks | down/up cycles on the disposable DB |
| T-4 | Medium (coverage) | No test proved concurrent withdrawals cannot overspend | Added | `withdrawalConcurrency.test.js` (mutation-checked) |

Accounting equations as implemented (unchanged business model): for each paid order,
`totalAmount = Σ(line price×qty) + shipping + tax − discount`; the discount is apportioned
pro rata over **all** lines; vendor allocation `amount = vendor lines × (1 − discount/gross)`,
`platformFee = amount × rate`, `payoutAmount = amount − platformFee`; platform revenue
`amount = platform lines × (1 − discount/gross)`. Commission rates come from the existing
commission engine; no rate was changed.

## 5. Decisions required (not invented)

| ID | Decision | Why it matters |
|---|---|---|
| D-1 | Commission engine's **category** tier is unreachable (product rows are loaded without `category`) | Enabling it changes vendor payouts |
| D-2 | Custom requests without `baseProductId` create **no** escrow allocation (vendor not paid through escrow) | Confirm whether a base product is mandatory |
| D-3 | Lanes with no configured carrier rate are priced from a hard-coded `FALLBACK_RATES` table (e.g. US 18, GB 12 in display currency) | Approve these prices or require fail-closed for international lanes |
| D-4 | `migrateExchangeRates.js` seeds approximate FX rates when the table is empty | Operator must enter real rates before international checkout is enabled |
| SEC-3 | Staff `view_customers` permission can quote prices | Permission model |
| R-6/R-7 | Return approval voids escrow before refunding; one refund claim per order lifetime | Multi-vendor return policy |
| R-8 | **Fixed locally 2026-10-12** (payout lifecycle redesign, §9). Remaining decisions: who may book a `reconciliation_required` payout manually (two-person SQL today), and whether to disable Paystack transfer OTP | see `PAYOUT_RECONCILIATION_RUNBOOK.md` §3F |
| SEC-11 | ~~Staff `view_earnings` permission authorises withdrawals~~ **Fixed 2026-10-12 (§11):** `request_payouts`, owner-grant-only | vendors must be told before deploy |
| DEC-PAY-1 | Manual booking of a `reconciliation_required` payout without matching provider evidence: single admin following the runbook, or a mandatory second-admin approval? (only one `admin` role exists, so dual control is procedural today) | money moves without provider confirmation |
| FV-9 | Partial refunds exclude a share of tax/shipping (unchanged) | refund policy |
| OPS-1 | `TRUST_PROXY` must match the Vercel → Render hop count | Wrong value = shared rate-limit bucket for all customers, or spoofable IPs; measure on staging |

## 6. Files

**Changed by this mission** (beyond the previous models' uncommitted work, which was
preserved): `backend/Services/escrowService.js`, `backend/routes/paymentRoutes.js`,
`backend/controllers/orderController.js`, `backend/controllers/customRequestController.js`,
`backend/controllers/returnController.js`, `backend/Services/paymentReconciliationService.js`,
`backend/Services/shippingService.js` (JSDoc), `backend/middleware/authMiddleware.js` (SEC-4), `backend/utils/cleanupJobs.js`,
`backend/utils/schedulerJob.js`, `backend/setupDB.js`, `backend/migrateInternationalAddresses.js`,
`backend/migratePaymentProcessingState.js`, `backend/package.json` (test scripts only),
`backend/.env.example`, `src/slices/returnsApiSlice.ts`, and on 2026-10-12 `backend/middleware/errorMiddleware.js`, `backend/middleware/cacheMiddleware.js`, `backend/migrateInternationalAddresses.js`, `backend/migrateInternationalOrders.js`, `backend/scripts/password-reset-flow.js`, `backend/tests/tryOnUploadSecurity.test.js`,
`src/Pages/adminDashboardPages/Returns/ReturnsPage.tsx`; tests:
`customRequestCheckout`, `escrowCancellationRefund`, `internationalCheckoutUnified`,
`paymentCurrencyContract`, `paymentLifecycleRecovery`, `paymentRecovery`, `refundReconcile`.

**New**: `backend/utils/adminAlerts.js`, `backend/tests/helpers/testDbGuard.mjs`,
`backend/tests/{moduleGraph,customRequestCheckoutHandler,paidSideEffects,returnRefundOutcome,orderOwnerFields,adminMarkPaidRace,staffAuthStatus,migrationPortability,withdrawalConcurrency,cacheMiddleware}.test.js`,
and the six deliverable documents.

**Commit hygiene (B-2, human action):** the release commit must include all untracked
files, notably `backend/Services/paymentReconciliationService.js`,
`backend/utils/refundClaim.js`, `backend/utils/tryOnImage.js`, `backend/utils/adminAlerts.js`,
`backend/migratePaymentProcessingState.js`, `backend/migrateCustomRequestOrderIdUnique.js`,
`backend/scripts/`, `src/ai-tryon/utils/` and the new tests. Without them, imports and
`db:migrate` break. `backend/docs/release-plan.md` is the mission brief; whether to commit
it is the owner's call.

## 7. Residual risks and limits of this validation

- **TiDB not tested.** The one known incompatibility (STORED generated column) was fixed
  locally (TIDB-1); everything else in `DATABASE_MIGRATION_REVIEW.md` §3 still needs staging.
- **Paystack behaviour is mocked.** Signed webhooks, refunds, transfers and verification
  were exercised against stubs. That proves our handling, not the provider integration.
- **Security review was targeted**, not exhaustive (`SECURITY_FINDINGS.md` §5).
- Recovery residual window: if a process dies between a stock UPDATE and its `stock_moves`
  insert, *and* that ledger insert had also failed, recovery could take that product's
  stock twice. This needs two independent failures; it is documented, not eliminated.
- Migrations swallow statement errors and exit 0; operators must read the output.
- The scheduler lock fails open if its table is missing (`migrateOps.js` is a gate).
- During this mission I proved the `setupDB.js` refusal by running it once with the real
  `.env` (TiDB host). The guard exits before any connection is opened, and nothing was
  contacted. A fake remote host would have been the safer way to prove it.

## 8. Continuation session (2026-10-12)

Started by distrusting the previous session's claims. On a **new** disposable MySQL 8.4.11
(own datadir, `127.0.0.1:33111`, every `backend/.env` key shadowed, loopback-only), the
previous results reproduced exactly: fresh install 748/748, DB-less exit 0, typecheck 0/0,
lint 0 errors, vitest 75/75, build OK. So the earlier "green" claims were accurate. Their
coverage was not complete, though: the previous models' uncommitted try-on/upload rewrite and
`errorMiddleware` change were never reviewed by any report.

Done in this session (details in the tracker, rows SEC-7…SEC-10, TIDB-1, M-5, T-4, R-8, OPS-1):
3 defects fixed with mutation-checked regression tests (SEC-7, SEC-8, TIDB-1), 2 tooling
defects fixed (SEC-9, M-5), 1 missing financial test added (T-4, concurrent withdrawals), and
2 new items that need a decision or staging (R-8, OPS-1). 17 tests were added (748 → 765).
The verdict is unchanged: **GO FOR STAGING VALIDATION, not production-approved.**

Remaining work that cannot be completed safely from this machine:
1. Staging runbook on TiDB with Paystack test mode (TiDB compatibility, provider behaviour, OPS-1 hop count).
2. Owner decisions D-1…D-4, SEC-3, SEC-11, R-6/R-7 and the R-8 manual-booking policy.
3. The human release commit must include every untracked file (§6, B-2).
4. Line-by-line review of OAuth callbacks and XSS sinks (`SECURITY_FINDINGS.md` §5; customer-side object ownership was swept in this session and holds), and a staging penetration test.

## 9. Independent final verification (2026-10-12)

Scope: an independent pass that did not trust any earlier "pass". It focused on defects that survive
passing unit tests (races, stale reads, inputs the fixtures never produce). Method: a new disposable
MySQL 8.4.11 (`127.0.0.1:33123`, every `backend/.env` key shadowed, loopback-only, dotenv
`injected env (0)` on every run), with Paystack stubbed throughout. **Nothing was committed, pushed,
deployed or run against TiDB/production, and no Paystack request was made.**

**Baseline reproduced:** fresh install 765/765, matching §8.

### 9.1 Verified fixes (each reproduced first, then fixed; tests in `backend/tests/finalVerificationRaces.test.js`)

| ID | Sev. | Defect (reproduction) | Fix |
|---|---|---|---|
| FV-1 | **High** | Webhook flipped `WHERE paymentReference = ?` after a validation SELECT that had found no order. An order bound in between was paid at any amount: **a 1 GHS charge marked a 1000 GHS order paid**. The same window let a cancelled order be refunded and journaled at its total without validation. | Flip only the validated row at the validated total; an unvalidated attempt waits for the next one. Verify fallback also pinned to the validated total. Second guard mutation-checked. |
| FV-2 | **High** | `cancelOrder` wrote back the payment status it had read. A payment confirmed mid-cancel ended **cancelled / pending, customer charged, no refund**, escrow voided. | Write conditional on that status; lost race → 409, nothing cancelled. |
| FV-3 | Medium | Partial vendor refund required the **gross** line value; on a discounted order it refunded 200 for lines paid at 160. Pre-existing on `main`. | Same pro-rata discount factor as escrow allocation. |
| FV-4 | Medium | Unmatched-charge reconciler read oldest-first `LIMIT 25` over a population that never shrinks. 25 reported receipts starved every newer one forever. | Unreported receipts first. |
| FV-5 | Medium | No timeout on any Paystack call; a hung connection held requests and scheduled money jobs indefinitely. | 15 s everywhere; timeouts land in the existing "unknown outcome" handling. Mutation-checked. |
| FV-11 | **High** | Stock was reserved before coupon validation and never returned when the coupon was refused; **one bogus-coupon request took 3 of 5 units permanently**, so any customer could drain any product. Pre-existing on `main`. | Reservation rolled back on both refusals. |
| FV-12 | Medium | Stock helpers held a pooled connection while taking another: 24 concurrent stock ops stalled 24 s on 12 s timeouts (also the root of the §7 double-take residual). Pre-existing. | Statements run on the pool. |

### 9.2 Remaining defects / decisions (not fixed)

- **FV-6, FV-7:** two recovery jobs can be starved by rows that never resolve (stale refund claims ≥ 25;
  stuck-pending ≥ 100), and FV-6 re-alerts every 15 min. Both fixes need a schema marker.
- **FV-8:** `platform_revenue` is never reversed on refund. Nothing reads it today.
- **FV-9:** partial refunds exclude the tax/shipping share. This is a policy decision.
- **FV-13:** the webhook still holds a DB connection while running paid side effects. Pool-size (10) concurrent paid flips could still stall. Fix by restructuring the retry loop or raising `DB_POOL_SIZE`.
- **FV-10:** `routes/paymentRoutes.js` was converted CRLF→LF by an earlier session. Review it with
  `git diff --ignore-cr-at-eol`.
- **FV-2 residual:** if the refund was already issued and the order shipped mid-cancel, the admin now gets a 409.
  Reconciliation flips the order to refunded and voids escrow, but the goods have shipped, so a human must follow up.
- All §5 decisions and §7 residual risks still stand.

### 9.3 Gates after this pass

| Gate | Result |
|---|---|
| Backend tests, fresh install (disposable DB) | **774/774** (765 + 9 new) |
| Backend tests, no DB (CI skip path) | exit 0 — 426 pass, 111 skipped |
| Backend typecheck / lint | 0 errors / 0 errors (13 pre-existing warnings) |
| Frontend typecheck / vitest | 0 errors / 75/75 |

### 9.4 Not performed

- Upgrade-path migration run: no migration changed.
- Frontend build: no frontend file changed.
- gitleaks / npm audit: no dependency change.
- TiDB behaviour, real Paystack behaviour, and the line-by-line OAuth/XSS review (§7, `SECURITY_FINDINGS.md` §5).
- FV-1 and FV-2 were reproduced deterministically by forcing the interleaving. Real-world timing
  windows are milliseconds wide, but FV-1 is attacker-steerable (the attacker chooses when to bind the reference).

Commit hygiene (B-2): the new untracked `backend/tests/finalVerificationRaces.test.js` must be included in the release commit.

**Re-verification after the concurrent payout-lifecycle session (2026-10-12, 13:00):** all FV fixes confirmed present in code; payout redesign reviewed (lock order, single claim per attempt, evidence check, reversal credit only when debited, admin actions verify-only + audited, vendor list scoped) — no defect found. Gates on a disposable MySQL 8.4.11: upgrade path (`db:migrate` ×2 on the existing DB, idempotent, payout columns present) **800/800**; fresh install into a new database **800/800**; DB-less exit 0 (426 pass, 111 skipped); backend + frontend typecheck 0 errors; lint 0 errors (13 pre-existing warnings); vitest 75/75; frontend build OK; `npm audit --omit=dev` 0/0 both workspaces; gitleaks history clean (working-tree hits only in git-ignored `backend/.env`). dotenv injected 0 keys on every run.

**Verdict unchanged: GO FOR STAGING VALIDATION — not production-approved.** Two high-severity
payment defects were open in the release candidate until this pass. Staging should specifically
exercise webhook-before-reference-bind and cancel-during-payment.

## 10. Payout lifecycle redesign (R-8, 2026-10-12)

**Verified diagnosis.** The original report was correct, and the problem was wider. A failed
or reversed partial payout restored its funds only if the allocation was still in the state
the claim had left it in. Three sequences broke that, and each made settlement throw and
retry forever with no alert:
1. The remainder was withdrawn later (allocation `releasing`).
2. That later payout succeeded (allocation `released`).
3. The order was refunded while the partial was in flight (allocation `failed`).

The review also found a withdrawal-loop bug that over-reserved after timeouts (W-1),
stale-read claims (W-2), webhooks settled without an amount/currency check (W-3), a
reconciler that could starve and never alerted (W-4), loose amount parsing with no
idempotency (W-5), and confirmed successes that could get stuck (W-6).

**What changed.** Design: `PAYOUT_LIFECYCLE_DESIGN.md`. Operations:
`PAYOUT_RECONCILIATION_RUNBOOK.md`.
- Every writer of an allocation's money now locks the allocation row first.
- Restores no longer depend on the allocation's state; the allocation state is recomputed
  after each settlement instead.
- An explicit `reconciliation_required` state with deduplicated admin alerts replaces
  "throw forever".
- Provider-evidence checks on settlement.
- A rotating, bounded reconciler that only ever *verifies*.
- A `vendor_withdrawals` request record with per-vendor idempotency keys.
- An admin API limited to verify-and-apply-what-Paystack-confirms, plus audited notes. There
  is no force-paid / retry button.

**Files changed:**
- backend: `Services/transferSettlementService.js`, `Services/transferReconciliationService.js`,
  `Services/escrowService.js` (`payoutAllocation`), `Services/walletService.js` (in-transaction
  clawback, typed insufficient-balance error), `Services/paystackservices.js` (initiate error
  context), `controllers/vendorController.js`, `routes/vendorRoutes.js`, `routes/paymentRoutes.js`,
  `server.js`, `package.json` (migration chain)
- new backend files: `migratePayoutLifecycle.js`, `controllers/adminPayoutController.js`,
  `routes/adminPayoutRoutes.js`, `tests/payoutLifecycle.test.js`
- frontend: `src/Pages/Vendor/VendorPayouts.tsx`
- documents: `PAYOUT_LIFECYCLE_DESIGN.md`, `PAYOUT_RECONCILIATION_RUNBOOK.md`, and updates to the
  six standing deliverables

**Commands and results** (from `backend/`, disposable MySQL 8.4.11 on `127.0.0.1:33111`, every
`.env` key shadowed):

| Step | Command | Result |
|---|---|---|
| Baseline, payout suites before editing | `node --test tests/{settlement,escrowCancellationRefund,withdrawalConcurrency,rb02-escrow-retry,redteam-final,paymentHardeningSchema,rb03-payment-paid-flip}.test.js` | 59/59 |
| Migration 30 twice | `node migratePayoutLifecycle.js` ×2 | exit 0 both; second run "already exists" throughout |
| New suite | `node --test tests/payoutLifecycle.test.js` | 26/26 (first run 22/25: 2 real code defects found and fixed — OTP alert reason mismatch caused double alerts; `[5]` accepted as an amount — plus 1 test bug) |
| Mutation checks | 7 re-introduced defects | all caught (the claim-guard mutation was initially missed → test 8c added) |
| Repetition | 5 payout/escrow suites ×5 runs | 60/60 every run |
| Full suite, upgraded DB | `npm run db:migrate && npm test` | **800/800** |
| Full suite, fresh install | `DB_NAME=rc_r8 npm run db:setup && npm test` | **800/800** |
| No database | `npm test` (DB unreachable) | exit 0 — 426 pass, 111 skipped |
| Missing schema | suite against a DB without migration 30 | fails loudly (exit 1), does not skip |
| Typecheck / lint / vitest / build | `npm run typecheck`, `npx tsc --noEmit`, `npm run lint`, `npm run test:frontend`, `npm run build` | 0 / 0 errors / 0 errors (13 pre-existing warnings) / 75/75 / OK |

After validation, the host stopped the disposable MySQL server for low memory. It was not
restarted; no validation was pending.

**Limitations and blockers before production:**
1. **Paystack behaviour is simulated.** The verify statuses, the "not found" semantics, the
   webhook `amount`/`currency` fields and OTP behaviour must be confirmed in test mode
   (staging E18–E22).
2. **TiDB is unverified** for the ENUM append and the `FOR UPDATE` locking pattern (staging E23).
3. Manually resolving `reconciliation_required` is a two-person SQL procedure. An owner
   decision is needed before building any booking UI.
4. The wallet-consistency alert may fire for historical data created before the redesign.
   The first production run needs a one-off review (runbook §4).
5. There is no admin UI yet: the backend API, alerts and runbook exist. The minimal UI still
   needed is a list of `/api/admin/payouts/unresolved` with a "Verify with Paystack" button
   and a note field.
6. Refund after a **completed** payout still leaves the platform out of pocket (pre-existing
   escrow policy R-6; unchanged).

**Assessment:** the payout redesign is **ready for staging validation**. It is not ready for
production until items 1–2 pass on staging with Paystack test mode and the owner records the
decision in item 3.

## 11. Admin payout UI, permissions, open payment findings, integration review (2026-10-12)

### 11.1 What was done

| Phase | Result |
|---|---|
| 1 — Admin payout interface | Admin → **Payouts** (`/admin?section=payouts`, now the link in every payout alert). It shows: unresolved list (amount, currency, vendor + id, withdrawal request, state, age, reason, latest Paystack status and check time); detail (provider evidence, last error, review reason, wallet consistency banner); **Verify with Paystack**; investigation notes; append-only action history; money journal. Outcome tone comes from the server, so an unknown outcome is never shown as success. No force-paid or retry-transfer control. Server-side admin enforcement verified over HTTP (401 anonymous, 403 vendor). |
| 2 — Permissions and policy | `request_payouts` is required to withdraw (`view_earnings` is read-only), and only the owner can grant it (SEC-11). Policy for `reconciliation_required`: admin re-verify with acknowledgement + justification note, through the normal evidence checks (mismatches stay parked; "not found" never releases) — design §7.1. Manual booking without provider evidence remains a documented procedure (decision DEC-PAY-1). |
| 3 — Open payment findings | **FV-6** and **FV-7**: durable `reconciliation_checks` state, due-only + never-checked-first selection, back-off, one alert per reason per day, admin review list (`/api/admin/ops/reconciliation-reviews`). FV-7 mismatched paid charges are now review items. **FV-8**: refund reversal row + journal at the three refund flips, plus an hourly backfill. **FV-13**: webhook side effects run after its connection is released (reproduced first: 12 s DB timeouts with a 3-connection pool). **FV-9 unchanged** (policy decision). |
| 4 — Integration review | Two new defects fixed. **INT-1:** returned money from an in-flight payout on a refunded order (full or per-vendor) became withdrawable; it is now clawed back. **INT-2:** credit-recovery job starved by ordinary balances; now selects only uncredited allocations. Reviewed with no change needed: escrow release ↔ claim (allocation lock order), return approval ↔ in-flight partial (10c), duplicate/early webhooks (5, 6), crash recovery (4, 7), admin retry of failed allocations (never initiates transfers), scheduler wiring (jobs called with no arguments → defaults), migrations (31 additive). |

### 11.2 Files changed in this phase

Backend:
- modified: `controllers/adminPayoutController.js`, `controllers/orderController.js`,
  `controllers/returnController.js`, `controllers/staffController.js`,
  `controllers/vendorController.js` (doc comment), `routes/adminOpsRoutes.js`,
  `routes/paymentRoutes.js`, `routes/vendorRoutes.js`, `Services/escrowService.js`,
  `Services/paymentReconciliationService.js`, `Services/transferReconciliationService.js`,
  `Services/transferSettlementService.js`, `utils/cleanupJobs.js` (CRLF kept), `package.json`
  (migration chain)
- new: `migrateReconciliationChecks.js`, `utils/reconciliationChecks.js`
- tests new: `payoutAdminPolicy`, `recoveryFairness`, `webhookPoolOccupancy`
- tests extended: `payoutLifecycle` (10e/10f/10g)
- tests adjusted (K-4): `paymentLifecycleRecovery`, `paymentCurrencyContract`,
  `paystackReferenceGuard`

Frontend:
- new: `src/Pages/adminDashboardPages/Payouts/PayoutsPage.tsx` + `__tests__/PayoutsPage.test.tsx`,
  `src/slices/adminPayoutsApiSlice.ts`
- modified: `src/AdminDashboard/AdminDashboard.tsx`, `src/slices/apiSlice.ts` and
  `src/constant.ts` (mixed/CRLF endings preserved byte-for-byte), `src/Pages/Vendor/VendorStaff.tsx`

Docs: the eight deliverables.

**Release hygiene:** do not commit every untracked file blindly. Besides the files above
(which the code needs), the tree holds historical reports, `backend/docs/release-plan.md`
(the mission brief) and ignored artefacts (`brag-output*`, `google*.html`, `backend/uploads`).
Choose deliberately.

### 11.3 Exact commands and results

All backend runs from `backend/` through the env-shadowing wrapper against a disposable
MySQL 8.4.11 (`127.0.0.1:33111`, own datadir, 64 MB buffer pool because host memory was low).

| Command | Result |
|---|---|
| `node --test tests/payoutAdminPolicy.test.js` | 9/9 (route, grant and ack mutations caught; a gap in the grant test found by mutation and closed) |
| `node --test tests/webhookPoolOccupancy.test.js` (fixed vs pre-FV-13 code) | pass / **fail with `DB execute timed out after 12000ms`** |
| `node --test tests/recoveryFairness.test.js` | 9/9 ×4 runs; 5 mutations caught |
| `node --test tests/payoutLifecycle.test.js` | 29/29; INT-1 and INT-2 mutations caught |
| `npx vitest run src/Pages/adminDashboardPages/Payouts` | 4/4 |
| 10 concurrency-sensitive files, `--test-concurrency=4`, ×3 | 113/113 each |
| `npm run db:migrate && npm test` (upgraded DB) | first run **820/822** (V-09b, P-GP-6 → investigated, K-4); then **822/822** |
| `DB_NAME=rc_p5 npm run db:setup && npm test` (fresh install) | exit 0 (M-4 noise only); **822/822** |
| `npm test` with no database | exit 0 — 426 pass, 111 skipped |
| `npm run typecheck` / `npx tsc --noEmit -p tsconfig.json` | 0 / 0 errors |
| `npm run lint` | 0 errors (after removing an unused test helper), 13 pre-existing warnings |
| `npm run test:frontend` | 79/79 (10 files) |
| `npm run build` | OK |
| `gitleaks detect --no-git` | findings only in git-ignored `backend/.env` |

### 11.4 Required report items

1. **Files changed:** §11.2.
2. **Commands and results:** §11.3.
3. **Remaining failures / blockers:** no local test failures. Blockers before production:
   staging on TiDB + Paystack test mode (items 5–6), the decisions in item 4, and the
   historical wallet review in item 7.
4. **Permission decisions still requiring approval:**
   - DEC-PAY-1: dual control for manual payout bookings;
   - SEC-3: the `view_customers` permission authorises custom-request quoting;
   - whether staff holding `request_payouts` today need any additional limit (amount cap /
     owner notification); none was invented;
   - R-6 / R-7 / FV-9 refund-policy items (unchanged).
5. **TiDB validation still required:**
   - migrations 26–31 (ENUM append in 30, VIRTUAL column in 26, new tables 30–31);
   - `SELECT … FOR UPDATE` lock order (allocation → attempt) in pessimistic mode;
   - the LEFT JOIN / `ORDER BY (expr)` plans of the FV-6/FV-7 selections;
   - the `NOT EXISTS` probe in `reconcileAvailableAllocations`;
   - JSON functions used by paid-side-effect tracking.
6. **Paystack test-mode scenarios still required:** staging E1–E32, in particular:
   - E18 / E31: a failing transfer after a later payout or a refund;
   - E21: OTP;
   - E22: verify-based settlement;
   - E24 / E25: the admin re-verify;
   - E28: the webhook burst.

   Also confirm Paystack's real transfer statuses and the "not found" semantics of
   `transfer/verify`, which the code relies on (design §5).
7. **Historical wallet reconciliation still required:**
   - run `PAYOUT_RECONCILIATION_RUNBOOK.md` §4 on production data (read-only) before
     enabling payouts; legacy pre-redesign data may show differences, which must be
     explained, not auto-corrected;
   - review the FV-8 backfill's effect on `platform_revenue`;
   - expect the first runs of FV-6/FV-7 to populate the review list from history.
8. **Ready for staging validation?** **Yes.** **Not production-approved:** provider
   behaviour, TiDB compatibility, the decisions in item 4 and the staging penetration test
   remain open.

## 12. Local security, bug fixing and commission completion (2026-10-12, session `566deb7e`)

### 12.1 Outcome

- Commission engine: 7 defects fixed (COM-1…COM-7), including two previously blocked as decisions (D-1 category
  tier, D-2 custom orders without a base product) that turned out to be plain bugs. Admin UI could not create
  any non-global rule before this session.
- Security: SEC-12 (OAuth linking without `email_verified`) fixed; OAuth flow, XSS sinks and rate-limit
  coverage reviewed with no further defect.
- Business model gaps (not code defects): no referral/ambassador system; 10 % charged vs 12 % advertised;
  shipping/VAT/Paystack-fee ownership unconfirmed. See `COMMISSION_SYSTEM_COMPLETION_REPORT.md` §6.

### 12.2 Gates

| Gate | Before (this session) | After |
|---|---|---|
| Backend suite, disposable DB | 822/822 | **850/850** |
| `db:migrate` re-run on migrated DB | — | exit 0, no failed statements |
| Backend typecheck / frontend typecheck | — | 0 / 0 |
| Lint | — | 0 errors, 13 pre-existing warnings |
| Vitest | 79/79 (prior session) | **81/81** |
| Frontend build | — | OK |
| `npm audit --omit=dev` (both) | — | 0 / 0 |
| gitleaks | — | history clean; working tree only ignored `backend/.env` |

### 12.3 Verdict

Unchanged: **GO FOR STAGING VALIDATION** (test-mode Paystack). Not production-approved: the commission business
decisions, OPS-1 `TRUST_PROXY` measurement, TiDB migration confirmation (E23, E32) and staging scenarios
E1–E41 are outstanding, and no live penetration test has been run.

## 13. Referral programme and coupon funding (2026-10-12, session `566deb7e`, continued)

Built to the owner's approved rules (`REFERRAL_SYSTEM_DESIGN.md` §1, answers verbatim in §9):
attribution (first link, bound at signup, anti-self-referral), platform-funded commission capped at the
platform commission left after admin coupons, availability at escrow release, refund reversal with debt
offset, Paystack withdrawals settled only from provider evidence, whole-order purchases with earnings
(final). Coupon funding changed per the owner: admin coupons → platform, seller coupons → seller.

New/changed files: see `LOCAL_SECURITY_AND_BUG_TRACKER.md` (CPN-1, REF-1…REF-6). New migration:
`backend/migrateReferrals.js` (additive). The programme ships **off**.

Gates: fresh install + backend **881/881**; upgrade-path `db:migrate` exit 0; typecheck 0/0; lint 0 errors; vitest 87/87;
build OK; 8 referral mutation checks caught.

Verdict unchanged: GO FOR STAGING VALIDATION only. Before production: confirm design §6 defaults, legal
terms for referrals (§8), Paystack test-mode staging runs E42–E56, TiDB run of the new migration.

## 14. Remaining local gates and staging preparation (2026-10-12, session `fe49cfc1`)

Nothing committed, pushed or deployed; hosted TiDB not contacted; no Paystack request made (outbound HTTP blocked
in live runs, provider mocked in tests). Details: `LOCAL_SYSTEM_TEST_REPORT.md`,
`DATABASE_AND_FINANCIAL_INTEGRITY_REPORT.md`, `SYSTEM_INVENTORY.md`, `SECURITY_FINDINGS.md` §7.

### 14.1 Gates (final code, executed)

| Gate | Result |
|---|---|
| Backend suite (disposable MySQL 8.4.11) | **896/896**, 0 skipped |
| Backend / frontend typecheck | 0 / 0 |
| ESLint | 0 errors, 13 pre-existing warnings |
| Vitest | 89/89 (15 files) |
| `vite build` | OK |
| Fresh install + second `db:migrate` | exit 0 / exit 0, schema identical |
| Live black-box (journeys A–K + probes) | 67/67 |
| npm audit (CI ratchet both workspaces; `--omit=dev`) | pass; runtime 0/0; 3 accepted dev-only highs |
| gitleaks (history + working tree) | 0 / 0 |

### 14.2 Fixed in this pass (regression tests fail on the old code)
VAL-3/VAL-4 test coverage added; **REF-ASYNC** (`refund.failed` now journaled + alerted, duplicates ignored);
**REF-RELEASED** (refund after vendor payout flagged in the admin review list + one alert). Earlier in the
session: VAL-1 (purpose tokens as sessions), VAL-2 (withdrawal deadlock), VAL-3, VAL-4, VAL-5.

### 14.3 Still open
STORE-1 (profile pictures on local disk), CFG-1 (`FRONTEND_URL` must be a single origin), DOC-1 (`.env.example`
gaps), MIG-2 (log-and-continue migrations), SEC-3, SEC-5, SEC-6, SEC-10 (low), OPS-1 (`TRUST_PROXY` measurement).

### 14.4 Decisions awaiting the owner
FV-9 (tax/shipping in partial refunds), R-6 (vendor debit ordering; refunds after payout), R-7 (multiple refunds per
order), REF-ASYNC follow-up (re-open/re-queue on provider refund failure), Paystack fees in the ledger, DEC-PAY-1,
SEC-3, plus the earlier D-1…D-4 and referral §6/§8 items.

### 14.5 Verdict
- **Local validation: complete** for everything that can be validated without TiDB and real Paystack test mode.
- **Staging deployment: may begin** under `STAGING_VALIDATION_RUNBOOK.md` §0 and §9, on a dedicated staging TiDB
  and Paystack test keys, with `FRONTEND_URL` set to the single staging origin and the release commit containing
  every untracked file. Not production-approved: TiDB compatibility is **UNVERIFIED**, `TRUST_PROXY` is unmeasured,
  and the decisions in §14.4 are open.

## 15. Staging preparation (2026-10-13, session `fe49cfc1`)

Done locally (nothing committed, pushed or deployed; no TiDB, no Paystack):
- Fixed CFG-1 (`FRONTEND_URL` single reader + boot validation), STORE-1 (profile pictures via storage backend),
  PIC-1 (profile delete/replace never worked — found by the new test), DOC-1 (`.env.example` complete), CI-1
  (CI now runs the migration-failure test and fails on any skipped suite).
- Added `npm run preflight` and `npm run smoke` (backend) for the deploy itself; corrected the runbook's
  `OAUTH_CALLBACK_URL` instruction; wrote the ordered launch procedure (`STAGING_VALIDATION_RUNBOOK.md` §10).
- Verified the **release set**: a clean copy of exactly the committable files installs fresh and passes 913/913,
  typecheck, lint, vitest 89/89, build, secret scan.

**Verdict: ready to start staging** at `STAGING_VALIDATION_RUNBOOK.md` §10 step 1 (release commit + CI green).
Production remains blocked on: TiDB verification, measured `TRUST_PROXY`, staging scenarios, owner decisions
(FV-9, R-6, R-7, refund-failure follow-up, fees, DEC-PAY-1, SEC-3, D-1…D-4, referral defaults).

## 16. Deployed to main (test mode) — 2026-10-13

Owner decision: the whole system is in testing mode, so `main` takes the release.
1. Encrypted, verified backup of the development DB `branding_house` (`~/.kente-backups/kente-branding_house-20261013-192311.sql.gz.aes`, passphrase in the `PASSPHRASE-premigration-…txt` beside it, both mode 600).
2. `npm run db:migrate` on `branding_house`: exit 0; 60/60 tables and every migration-managed column present. Known drift not covered by any migration (unused by code): `campaigns.createdBy`, `campaign_products.created_at`, `campaign_vendors.created_at`, some secondary indexes and `vendors.uq_vendors_slug`.
3. `main` fast-forwarded `4007630 → b9984d0` and pushed. CI on main: success. Vercel: success. Render: new backend live (boot checks passed, `/health/ready` db ok).
4. `npm run smoke -- --web=https://kente-market.vercel.app --api=https://kente-api.onrender.com`: **13/13 PASS**. Live search is case-insensitive (`kente`/`Kente`/`KENTE` → same results).

Still to do: set `DB_SSL_CA` on Render (TIDB-TLS), measure `TRUST_PROXY`, decide TIDB-CHECK, then the authorized penetration test with test accounts.
