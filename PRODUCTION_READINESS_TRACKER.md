# Kente Market — Production Readiness Tracker

Working document for the release-candidate mission in `backend/docs/release-plan.md`.
Historical reports (`FINAL_PRE_PUSH_AUDIT.md`, `INTEGRATED_VERIFICATION_REPORT.md`,
`REMEDIATION_REPORT.md`, `FINAL_REDTEAM_REPORT.md`, `REDTEAM_VERIFICATION_REPORT.md`,
`SECURITY_AUDIT_REPORT.md`, `PRODUCTION_HARDENING_AUDIT.md`, `security/KENTE_MARKET_SECURITY_REPORT.md`)
are preserved unchanged and used as evidence only. Claims in them were re-verified
against the current tree; contradictions are noted per task.

Status values: `OPEN` · `IN PROGRESS` · `FIXED (verified)` · `VERIFIED OK` (no defect) ·
`BLOCKED` (needs external action/decision) · `DOCUMENTED` (risk accepted / decision recorded).

---

## Phase A — Repository state (verified 2026-10-11)

| Item | Value |
|---|---|
| Repo root | `/home/roberto/Documents/project/ecom_new` |
| Branch / HEAD | `fix/global-production-integration` @ `2df4428` (matches historical reference) |
| Staged | nothing |
| Working tree | 34 tracked files modified/deleted (+3932/−1291), 20 untracked paths (new services, migrations, tests, reports) — all previous-model work, **uncommitted** |
| Preservation | Snapshot of all uncommitted work taken before any edit: tracked diff + untracked tarball in the session scratchpad. No reset/stash/checkout performed. |
| Frontend | React 19 + Vite 7 + TypeScript 5.9, Redux Toolkit, Tailwind 4, Vitest 5 (jsdom) |
| Backend | Node 22, Express 5 (ESM), mysql2 (MySQL 8 / TiDB Cloud), node:test, `tsc --noEmit` over `// @ts-check` JS |
| Payments | Paystack (GHS charging only), internal escrow ledger + vendor wallets + Paystack transfers |
| Deploy | Frontend: Vercel (`vercel.json` rewrites `/api` → Render `kente-api.onrender.com`). Backend: Render (+ `.deploy/` ARM VM docs, backup scripts). CI: `.github/workflows/ci.yml` (gitleaks, tsc ×2, eslint, DB-less tests, vitest, audit ratchet, build, MySQL 8.4 full suite) |

### Safety finding S-0 (environment) — **release-relevant**
`backend/.env` targets a **TiDB Cloud** host (`branding_house`, :4000, TLS) and holds live-looking
credentials (Paystack secret, Redis, Sentry, Google OAuth, mail, Replicate). Every DB-backed test
suite reads `config/db.js` → dotenv → that host. **Running `npm test` in `backend/` on this machine
without overrides would write test fixtures to the shared/production database.** (Also reported as
S-1 in `FINAL_PRE_PUSH_AUDIT.md`; still unfixed at start.) Secret values were not read into reports.

All validation in this mission ran against a **positively identified disposable MySQL 8.4.11**
started by this session (own datadir in the session scratchpad, `127.0.0.1:33099`), through a
wrapper that shadows **every** key in `backend/.env` with a CI placeholder and refuses
non-loopback hosts. The app's own pool reported `@@port=33099` and dotenv reported
`injected env (0) from .env`.

---

## Phase B — Baseline (before any edit in this mission)

| Gate | Command | Result |
|---|---|---|
| Fresh schema + full `db:migrate` chain | `npm run db:setup --prefix backend` (disposable DB) | exit 0, **but 3 statements failed and were swallowed** (see M-1, M-2, M-3) |
| Backend tests | `npm test --prefix backend` (disposable DB) | **exit 1 — 726 tests: 703 pass, 3 fail, 20 cancelled** |
| Backend typecheck | `npm run typecheck --prefix backend` | **exit 2 — 3 errors** (`staleRate` ×2 in `shippingService.js`, `mysql.createConnection` in `migratePaymentProcessingState.js`) |
| Frontend typecheck | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| Lint | `npm run lint` | **exit 1 — 17 errors, 13 warnings** (incl. one real `no-undef`, see C-1) |
| Frontend tests | `npm run test:frontend` | exit 0 — 75/75 (9 files) |
| Frontend build | `npm run build` | exit 0 |

Baseline failures, classified:
- `escrowCancellationRefund.test.js` (20 cancelled + hook failure): suite hard-codes `127.0.0.1:3307` as `root`; cannot run in CI (3306) nor in CI's DB-less skip path → **CI red**. Test-harness defect (T-1).
- `paymentRecovery.test.js` tests 4 and 10: operator-alert assertions fail on a fresh DB because `notifyAdmins` silently delivers nothing when no admin exists, and selects an arbitrary 5 admins (`LIMIT 5`, no `ORDER BY`). Historical "intermittent `refundReconcile` alert" report is the same root cause. Product defect (A-1) + test-fixture dependency on pre-existing shared-DB admins (T-2).
- Historical claims "658/658 pass" and "PASS" verdict in `REMEDIATION_REPORT.md` are **not reproducible on a fresh database**; they depended on pre-existing admin rows / a :3307 scratch server.

---

## Task inventory — final dispositions (Phases C–H complete)

Evidence for every "FIXED" row: the named test passes on the disposable DB (fresh install
and upgraded DB, 740/740 overall); rows marked *mut* were also shown to FAIL when the fix
is reverted (mutation check), then the fix was restored byte-for-byte.

| ID | Finding | Files | Risk | Fix | Test / evidence | Disposition |
|---|---|---|---|---|---|---|
| C-0 | Backend cannot boot: controller imports names `escrowService.js` doesn't export (ESM link error) | `controllers/customRequestController.js` | **Critical** | Import from defining modules | `moduleGraph.test.js` *mut*; 147/147 modules import | FIXED (verified) |
| C-1 | Custom checkout `ReferenceError` after Paystack verification → charged, no order | same | **Critical** | Function-scope vars | `customRequestCheckoutHandler.test.js` *mut* | FIXED (verified) |
| C-2 | Custom order stored `{}` instead of delivery address (regression vs HEAD) | same | High | Restored | same suite | FIXED (verified) |
| C-3 | Paid-order side effects never recorded; recovery would re-run effects on all history; crash after paid flip lost effects; 4 divergent copies | `escrowService.js`, `paymentRoutes.js`, `orderController.js` | High | Shared `applyPaidOrderSideEffects`, opt-in tracking at flip, per-effect markers, ledger-based stock idempotency | `paidSideEffects.test.js` (8) *mut ×2* | FIXED (verified) |
| B-4 | Recovery unbounded/unscheduled/included terminal orders; stuck-pending scan unbounded | `escrowService.js`, `cleanupJobs.js` | High | Bounded batches, grace, attempt cap + alert, scheduled under lock; stuck-pending 1h–7d, 100/run | `paidSideEffects.test.js` | FIXED (verified) |
| B-3 | Platform revenue discount denominator | `escrowService.trackPlatformRevenue` | Medium | Whole-order gross | B-3 reconciliation test *mut* | FIXED (verified) |
| B-1 | Backend typecheck red | `shippingService.js`, `migratePaymentProcessingState.js` | High (CI) | JSDoc type; documented cast | typecheck 0 errors | FIXED (verified) |
| B-1b | `// @ts-check` removed to hide errors | `internationalCheckoutUnified.test.js` | Medium | Restored + fixture types | typecheck 0 | FIXED (verified) |
| B-2 | Untracked files referenced by package.json/imports | repo | High at commit | Human commit must include them (report §6) | n/a | BLOCKED (human commit) |
| A-1 | Nondeterministic / silently dropped admin alerts | 6 files, `utils/adminAlerts.js` | Medium | ORDER BY id; loud log when no recipient | `paymentRecovery`, `refundReconcile` stressed with 6 extra admins ×3 runs | FIXED (verified) |
| T-1 | Escrow suite pinned to :3307/root | `escrowCancellationRefund.test.js` | Medium (CI) | Configured loopback DB, skip w/o DB | 20/20 with DB; skips w/o DB | FIXED (verified) |
| T-2 | Alert tests relied on pre-existing admins | `paymentRecovery.test.js`, `refundReconcile.test.js` | Low | Own fixture; assert per-order alert | pass ×3 | FIXED (verified) |
| T-3 | Custom checkout suite set `dbAvailable` too late (CI DB-less red); vacuous `assert.fail` in catch | `customRequestCheckout.test.js` | Medium (CI) | Probe at load; re-throw AssertionError, assert ER_DUP_ENTRY | DB-less run exit 0; 6/6 with DB | FIXED (verified) |
| S-1 | `npm test` reached hosted TiDB via `.env` | `package.json`, `tests/helpers/testDbGuard.mjs` | **High** | Loopback-only guard | refusal verified | FIXED (verified) |
| S-2 | `npm run db:setup` could DROP the hosted DB; schema always loaded into `branding_house` | `setupDB.js` | **High** | Loopback-only unless opt-in; DB_NAME honoured | refusal verified; fresh install into `rc_fresh` | FIXED (verified) |
| SEC-1 | Buyer could overwrite vendor completion date / production note | `orderController.updateOrder` | Medium | Denylist | `orderOwnerFields.test.js` *mut* | FIXED (verified) |
| SEC-2 | Admin mark-paid could resurrect refunded order | `orderController.updateOrderToPaid` | Medium | CAS excludes refunded | `adminMarkPaidRace.test.js` *mut* | FIXED (verified) |
| R-5 | Failed/unknown return refund reported as success | `returnController.js`, Returns UI | Medium | `refundOutcome` + UI warning | `returnRefundOutcome.test.js` | FIXED (verified) |
| M-1/M-2 | `addressLine3`/`province` DDL syntax (swallowed) | `migrateInternationalAddresses.js` | Medium | Clause order | fresh + idempotent re-run | FIXED (verified) |
| M-3 | JSON-column index (swallowed) | `migratePaymentProcessingState.js` | Low | Removed (bounded scan uses paymentStatus index) | `SHOW INDEX` | FIXED (verified) |
| M-4 | Early index adds on not-yet-created tables (fresh install noise) | `migrateMarketplace.js` | Low | none — equivalent indexes exist | `information_schema` | DOCUMENTED |
| L-1 | Lint errors | various | Low | Cleaned | lint 0 errors | FIXED (verified) |
| D-1 | Commission category tier unreachable | `createEscrowAllocations` | Medium | — | — | BLOCKED (business decision) |
| D-2 | Custom requests w/o base product → no escrow allocation | same | Medium | — | — | BLOCKED (business decision) |
| D-3 | Hard-coded fallback shipping prices when a lane has no rate | `shippingService.js` | Medium | — | staging E12 | BLOCKED (business decision) |
| D-4 | Migration seeds approximate FX rates | `migrateExchangeRates.js` | High for intl launch | — | prod gate | BLOCKED (operator action) |
| TIDB-1 | STORED generated column via ALTER unsupported on TiDB | `migrateInternationalAddresses.js` | Medium | Column made VIRTUAL (no app code reads it; values identical; instant on MySQL) | `migrationPortability.test.js` *mut*; fresh + upgrade + up/up/down/up on disposable DB (2026-10-12) | FIXED locally — TiDB confirmation still a staging step |
| SEC-4 | Staff auth turned deactivated-staff / inactive-store 403s into 401 (SPA "session expired") | `middleware/authMiddleware.js` | Low | Keep decided status; generic 401 only for driver errors; `next()` outside `try` | `staffAuthStatus.test.js` *mut* (2026-10-12) | FIXED |
| SEC-3, SEC-5, SEC-6, R-6, R-7 | See `SECURITY_FINDINGS.md` §2 | | Low–Medium | — | — | DOCUMENTED |
| SEC-7 | `errorHandeler` trusted any `err.status`: an unhandled AxiosError carries the **upstream** status, so a Paystack/Replicate 401 reached the SPA as 401 (forced logout), 404/400 as the customer's fault (uncommitted previous-model change, never reviewed) | `middleware/errorMiddleware.js` | Medium | Honour `status` only on http-errors instances (`expose` boolean) | `tryOnUploadSecurity.test.js` +4 *mut*; real `express.json` 413/400 still pass through | FIXED (verified 2026-10-12) |
| SEC-8 | Response cache stored error bodies; a hit replays with 200, so one transient 500/404 on a cached GET (product, category…) was served as a 200 for the TTL | `middleware/cacheMiddleware.js` | Low–Medium | Cache 2xx only | `cacheMiddleware.test.js` (5) *mut* | FIXED (verified 2026-10-12) |
| SEC-9 | `npm run password:reset:test` (manual script) wrote a live reset token for a hard-coded real address via whatever DB `.env` names, emailed it, and printed 20 chars of the token | `scripts/password-reset-flow.js` | Low | Target email is a required argument; token never printed | manual script — syntax check only | FIXED |
| M-5 | `down()` of `migrateInternationalAddresses.js` / `migrateInternationalOrders.js` used `DROP … IF EXISTS` (invalid on MySQL 8) and dropped the column before its index | both | Low | information_schema-guarded drops, index first | down/up/down/up on disposable DB; `migrationPortability.test.js` *mut* | FIXED (verified 2026-10-12) |
| T-4 | No test for concurrent withdrawals against one balance (release plan §3C) | — | Medium (coverage) | `withdrawalConcurrency.test.js`: 8×full, 10×partial, multi-allocation, over-balance — Σclaimed+Σremaining conserved, one transfer per claim | 4 tests *mut* (claim guard weakened → 3 fail) | FIXED (verified 2026-10-12) |
| R-8 | **FIXED 2026-10-12 (see W-rows below).** Partial payout that **fails/reverses after** a later full payout took the allocation's remainder cannot settle: `settleTransferFailed/Reversed` restore partials only `WHERE status='available'`, throw, roll back → attempt stays `processing`, webhook 500s forever, no admin alert. Money is not lost but is stuck. Pre-existing (unchanged since `main`) | `Services/transferSettlementService.js`, `escrowService.payoutAllocation` | Medium | Payout lifecycle redesign (`PAYOUT_LIFECYCLE_DESIGN.md`) | `payoutLifecycle.test.js` 10a–10d *mut* | FIXED (verified locally) |
| R-8a | Diagnosis widened: also stuck when the later payout already **succeeded** (allocation `released`), and when the order is **refunded while a partial is in flight** (allocation `failed` by clawback) | `transferSettlementService.js` | Medium | State-independent restore + recompute; voided allocation → in-transaction clawback | 10b, 10c *mut* | FIXED (verified locally) |
| W-1 | Withdrawal loop over-reservation: a timed-out initiate (`paid:false` though reserved) was not deducted, so the next allocation was reserved for the full amount again (request 100 → 200 reserved/sent) | `vendorController.withdrawVendorBalance` | Medium | Pending reservations count toward the request | 8b *mut* | FIXED (verified locally) |
| W-2 | Concurrent claims decided "full" from a stale read → allocation left `available` at 0 forever | `escrowService.payoutAllocation` | Low | Claim under `SELECT … FOR UPDATE`, full computed from the locked row | 8, 8c *mut* | FIXED (verified locally) |
| W-3 | Transfer webhooks settled by reference only (no amount/currency check) | `paymentRoutes.js`, settlement | Medium | Evidence compared; mismatch → `reconciliation_required` + alert | 22 *mut* | FIXED (verified locally) |
| W-4 | Reconciler scanned the 25 **oldest** attempts → a stuck backlog starved newer ones; non-final provider states (`otp`, …) ignored forever; no alerts; a 404 after an acknowledged initiate released funds | `transferReconciliationService.js` | Medium | Rotation by `lastCheckedAt`, deduplicated alerts, 404-after-ack → review | 11/23, 13, 16b, 7b *mut* | FIXED (verified locally) |
| W-5 | Amount parsing accepted `"50abc"`, `[5]`, `1e3`; currency unchecked; no idempotency for double-clicks | `vendorController.js`, `VendorPayouts.tsx` | Low–Medium | Strict pesewa parsing, GHS only, `vendor_withdrawals` + per-vendor request key; UI sends one key per intent | 12, 21, 22 | FIXED (verified locally) |
| W-6 | Confirmed-success settlement threw forever if the wallet was short | settlement | Medium | `reconciliation_required` (`confirmed_success_unbookable`), never failed | 9b | FIXED (verified locally) |
| SEC-11 | **FIXED 2026-10-12** — `request_payouts` (owner-grant-only) required for withdrawals; `view_earnings` read-only. Original: staff permission `view_earnings` authorised `POST /api/vendors/withdraw` | `vendorRoutes.js`, `staffController.js`, `VendorStaff.tsx` | Low | — | `payoutAdminPolicy.test.js` *mut* | FIXED (verified) |
| OPS-1 | Proxy chain is browser → Vercel rewrite → Render proxy → Node; `TRUST_PROXY` unset/wrong makes every customer share one rate-limit bucket (self-DoS) or lets direct callers spoof IPs | `server.js` | Medium (ops) | — | staging runbook §2 | BLOCKED (staging verification) |
| SEC-10 | CSRF layer 2 passes when no CSRF cookie is present; unreachable today (every session cookie is issued with a CSRF cookie of ≥ equal lifetime) | `middleware/csrfMiddleware.js` | Low | — | code review | DOCUMENTED (hardening) |

## Phase log

- **A — Inventory**: done (this file).
- **B — Baseline**: done (above).
- **C — Implementation**: done (rows above).
- **D — Regression tests**: 6 new test files + 7 corrected; 7 mutation checks.
- **E — Integration**: webhook → shared effects → recovery; return approval → refund outcome; admin mark-paid vs refund race; escrow cancellation/release/withdrawal suite (first real run).
- **F — Full validation**: fresh install 740/740 (748/748 after SEC-4 on 2026-10-12, fresh and upgraded); upgraded DB 740/740 ×4; DB-less exit 0; typecheck 0/0; lint 0 errors; vitest 75/75; build OK; audit + gitleaks clean.
- **G — Final review**: own diff isolated against the rebuilt baseline snapshot; one accidental CRLF→LF conversion of `utils/cleanupJobs.js` found and reverted (file now differs only by 4 intended changes).
- **H — Handover**: `FINAL_PRODUCTION_READINESS_REPORT.md`, `STAGING_VALIDATION_RUNBOOK.md`, `PRODUCTION_DEPLOYMENT_RUNBOOK.md`, `DATABASE_MIGRATION_REVIEW.md`, `SECURITY_FINDINGS.md`.

- **I — Continuation (2026-10-12, separate session)**: every claim above re-verified from scratch on a new
  disposable MySQL 8.4.11 (own datadir, `127.0.0.1:33111`, same env-shadowing wrapper):
  fresh install 748/748, DB-less exit 0, typecheck 0/0, lint 0 errors, vitest 75/75, build OK — the
  previous session's results reproduce. Then reviewed what no earlier report covered (the previous
  models' uncommitted try-on/upload rewrite, `errorMiddleware`, `paystackservices`, `reservationService`,
  international checkout controller, frontend payment-ref callers, password reset, CSRF, proxy trust,
  review/upload ownership, every customer-side `:id` route's ownership check, response cache, withdrawal concurrency). Fixed SEC-7, SEC-8, SEC-9, TIDB-1,
  M-5; added T-4; documented R-8, OPS-1, SEC-10. Reviewed with no defect: `utils/tryOnImage.js`,
  `tryOnController.js` (inline-only model image, server-resolved garment, fail-closed host allow-list,
  prediction ownership), refund-claim builder, partial-refund `listRefunds`, reservation escrow void,
  `SHIPPING_TABLES_MISSING`/`SHIPPING_FX_UNAVAILABLE` paths, `pendingPaymentRef:{order|custom}:<id>`
  callers, reset-token hashing/expiry/session revocation, review ownership + moderation, upload delete
  ownership. Final gates: fresh install **765/765**, upgraded DB **765/765**, DB-less exit 0 (425 pass,
  111 skipped), typecheck 0/0, lint 0 errors (13 pre-existing warnings), vitest 75/75, build OK,
  `npm audit --omit=dev` 0/0, gitleaks history clean (working-tree hits only in ignored `backend/.env`).
  One self-inflicted CRLF→LF conversion (`scripts/password-reset-flow.js`) found in the diff review and
  reverted.

- **J-FV — Independent final verification (2026-10-12, separate session; ran in parallel with the payout session below, which also used the letter J)**: did not rely on any earlier
  "pass". Rebuilt a new disposable MySQL 8.4.11 (own datadir, `127.0.0.1:33123`, every `backend/.env`
  key shadowed, loopback-only, dotenv `injected env (0)` on every run). Baseline reproduced:
  fresh install **765/765**. Then traced charge → webhook/verify → paid flip → side effects →
  refund/cancel/return → reconcilers, looking for interleavings and inputs the existing fixtures never
  produce. Five defects were **reproduced first** (the new tests failed on the unfixed code), fixed,
  and mutation-checked. Rows below.

### Phase J-FV findings

| ID | Finding | Files | Risk | Fix | Test / evidence | Disposition |
|---|---|---|---|---|---|---|
| FV-1 | **Webhook paid-flip without amount validation.** The amount/currency check ran in a SELECT; the flip was `UPDATE … WHERE paymentReference = ?`. When the SELECT found no order (the normal case: the storefront PUTs the reference onto the order *after* the charge), validation was skipped, and an order bound between the two statements was flipped to paid at any amount. Reproduced: a 1 GHS charge paid a 1000 GHS order. In the same window the terminal-order branch could refund + journal a charge at the order total without validation. | `routes/paymentRoutes.js` | **High** (financial) | Flip only the validated row (`id`, reference, validated `totalAmount`); an attempt with no validated row only waits for the next attempt (which re-validates). Verify fallback flip also pinned to the validated total. | `finalVerificationRaces.test.js` FV-1 ×3 (failed before fix; second guard mutation-checked) | FIXED (verified) |
| FV-2 | **Admin cancel overwrote a just-confirmed payment.** `cancelOrder` read the order (unpaid → no refund), then wrote `paymentStatus = <value read>` guarded only on `orderStatus`. A webhook paying the order in between ended as `cancelled`/`pending`: customer charged, no refund, escrow voided, coupon slot burnt. (Recovery would only notice via the stuck-pending scan, inside its 7-day window.) | `controllers/orderController.js` | **High** (financial) | Status write also conditional on the `paymentStatus` decided on; a lost race re-reads and answers 409 (nothing cancelled; retry refunds via the paid branch). If the refund had already been issued, the journal + claim hand the order to `reconcileRefundedButPaid`. | FV-2 (failed before fix) | FIXED (verified) |
| FV-3 | **Partial (per-vendor) refund over-refunded discounted orders.** Required amount = vendor's **gross** lines, while escrow apportions the order discount pro rata. Reproduced: 200 refunded for lines the customer paid 160 for. Pre-existing (same code on `main`). API-only (admin UI does not call it). | `controllers/returnController.js` | Medium (financial) | Required amount = gross lines × (1 − discount / order gross), the factor `createEscrowAllocations` uses. Unchanged for undiscounted orders. | FV-3 (failed before fix); `partialRefunds.test.js` still passes | FIXED (verified) |
| FV-4 | **Unmatched-charge reconciler starvation.** Reported receipts never leave its population and it read oldest-first `LIMIT 25`: once 25 existed, every newer unmatched charge (and every "order appeared later" hand-off) was never examined again. | `Services/paymentReconciliationService.js` | Medium (ops / money visibility) | Unreported receipts first, then re-checks | FV-4 (failed before fix) | FIXED (verified) |
| FV-5 | **No timeout on any Paystack call** (axios default: none). A hung provider connection held checkout/verify/refund requests and scheduled money jobs (and their distributed lock) indefinitely. | `Services/paystackservices.js`, `routes/paymentRoutes.js`, `Services/escrowService.js` | Medium (availability) | 15 s on every call (same bound transfer reconciliation already used). A timeout is a no-response error, which refund/transfer paths already treat as UNKNOWN (claim kept, reconciled). | FV-5 (no DB; mutation-checked) | FIXED (verified) |
| FV-11 | **Coupon-rejected checkout kept reserved stock forever.** `addOrderItems` reserves (deducts) stock, then validates/reserves the coupon; both coupon refusals returned without rollback, and no order row exists for the expiry sweeper. Reproduced: one request with a bogus code took 3 of 5 units permanently — any customer could drain any product to zero. Pre-existing (same on `main`). | `controllers/orderController.js` | **High** (inventory integrity / availability) | Roll the reservation back on both refusals | FV-11 (failed before fix) | FIXED (verified) |
| FV-12 | **Pool-exhaustion stall in stock helpers.** `restoreStockForOrder`/`decrementStockForOrder` held a pooled connection while `recordStockMove` took another from the same pool (default 10). ≥ 10 concurrent callers each held one and waited for one more → 12 s timeouts (24 s for 24 trivial ops; 500s in the 20-way coupon checkout test once FV-11 added restores). Inside the webhook this is 3 connections per paid flip; a timed-out marker write plus a lost `sale` row is how recovery could take stock twice (§7 residual). Pre-existing. | `controllers/orderController.js` | Medium (availability; stock integrity under load) | Run the (non-transactional) statements on the pool | FV-12 (failed before fix) | FIXED (verified) |
| FV-13 | **FIXED 2026-10-12** — side effects run after the attempt connection is released; reproduced first (3-conn pool, 6 deliveries → 12 s DB timeouts on old code)<br>*Original finding:* Webhook still holds its own connection while running paid side effects (depth 2): ≥ pool-size concurrent paid flips can still stall (was: DOCUMENTED) | `routes/paymentRoutes.js` | Low–Medium | see K-rows | `webhookPoolOccupancy.test.js` | FIXED (verified) |
| FV-6 | **FIXED 2026-10-12** — durable `reconciliation_checks`, fair due-only selection, 6 h re-check, one alert per reason, admin review list<br>*Original finding:* `reconcileStaleRefundClaims` re-selects rows that need manual review (`LIMIT 25`, no ordering) and re-sends the admin alert every 15 min; ≥ 25 such rows starve the rest (was: DOCUMENTED) | `paymentReconciliationService.js` | Low–Medium | migration 31 | `recoveryFairness.test.js` *mut* | FIXED (verified) |
| FV-7 | **FIXED 2026-10-12** — never-checked first, back-off 30 min→12 h, mismatched paid charge → durable review + alert<br>*Original finding:* `recoverStuckPendingOrders` re-verifies every non-success pending order with a reference every 30 min for 7 days, oldest first, 100/run; > 100 such orders starve newer genuinely-paid ones until they age out (was: DOCUMENTED) | `escrowService.js` | Low–Medium | migration 31 | `recoveryFairness.test.js` *mut* | FIXED (verified) |
| FV-8 | **FIXED 2026-10-12** — negated `refund` row per fully refunded order + journal; hooks in cancel / full return / `reconcileRefundedButPaid`; hourly bounded backfill (also covers late-charge path and history)<br>*Original finding:* `platform_revenue` is never reversed on cancel/refund/return (nothing reads the table today, so no report is wrong yet) (was: DOCUMENTED) | `escrowService.js`, `orderController.js`, `returnController.js`, `cleanupJobs.js` | Low | no DDL | `recoveryFairness.test.js` *mut* | FIXED (verified) |
| FV-9 | Partial refunds return the vendor's discounted line value only — no share of tax/shipping | `returnController.js` | Low (policy) | — business decision | code review | DOCUMENTED |
| FV-10 | `routes/paymentRoutes.js` is CRLF at HEAD but LF in the working tree (converted by an earlier session, before this one) — the raw diff is ~1,260 lines; `git diff --ignore-cr-at-eol` shows the real 376 | repo hygiene | Low | — owner's call at commit time | `git diff --stat` | DOCUMENTED |

Phase J-FV gates (disposable DB): fresh install **772/772** (765 + 7 new) after FV-1…5; see the final gate line below for the run after FV-11/12; DB-less exit 0 (426 pass,
111 skipped); backend typecheck 0 errors; lint 0 errors (13 pre-existing warnings); frontend
typecheck 0, vitest 75/75. Not re-run: upgrade-path migration (no migration changed), frontend
build (no frontend change), gitleaks/audit (no dependency change).

Final gate line (after FV-11/FV-12, disposable DB): fresh-install suite **774/774**; DB-less exit 0 (426 pass, 111 skipped); backend typecheck 0 errors; lint 0 errors (13 pre-existing warnings).

- **J — Payout lifecycle redesign (R-8, 2026-10-12)**: design `PAYOUT_LIFECYCLE_DESIGN.md`, runbook
  `PAYOUT_RECONCILIATION_RUNBOOK.md`, migration 30 `migratePayoutLifecycle.js`, admin API
  `/api/admin/payouts` (verify-only + notes, audited), vendor `GET /api/vendors/withdrawals`.
  Payout suites before editing: 59/59. New `payoutLifecycle.test.js`: 26 tests; 7 mutation checks all
  caught (one test gap found by mutation and closed: 8c). Concurrency-sensitive suites ×5 consecutive:
  60/60 each. Full suite upgraded DB **800/800**, fresh install **800/800**, DB-less exit 0 (426 pass,
  111 skipped), typecheck 0/0, lint 0 errors, vitest 75/75, build OK. The disposable MySQL was then
  stopped by the host for low memory (after all validation had completed; not restarted).

**Re-verification after the concurrent payout-lifecycle session (2026-10-12, 13:00):** all FV fixes confirmed present in code; payout redesign reviewed (lock order, single claim per attempt, evidence check, reversal credit only when debited, admin actions verify-only + audited, vendor list scoped) — no defect found. Gates on a disposable MySQL 8.4.11: upgrade path (`db:migrate` ×2 on the existing DB, idempotent, payout columns present) **800/800**; fresh install into a new database **800/800**; DB-less exit 0 (426 pass, 111 skipped); backend + frontend typecheck 0 errors; lint 0 errors (13 pre-existing warnings); vitest 75/75; frontend build OK; `npm audit --omit=dev` 0/0 both workspaces; gitleaks history clean (working-tree hits only in git-ignored `backend/.env`). dotenv injected 0 keys on every run.


### Phase K — admin payout UI, permissions, open payment findings, integration review (2026-10-12)

| ID | Finding / task | Files | Risk | Fix | Test / evidence | Disposition |
|---|---|---|---|---|---|---|
| K-1 | No admin interface for unresolved payouts (backend API only); alert links pointed at a non-existent `/admin/payouts` route | `PayoutsPage.tsx`, `adminPayoutsApiSlice.ts`, `AdminDashboard.tsx` (`?section=`), alert links | Medium (ops) | Admin → Payouts: list (amount, currency, vendor, state, age, reason, latest Paystack status), detail, Verify with Paystack, notes, action history, journal; no force/retry control; outcome severity from server | `PayoutsPage.test.tsx` (4) | DONE |
| K-2 | Policy for `reconciliation_required` undefined | `adminPayoutController.js`, settlement/reconciler (`fromReview`) | Medium | Admin-only re-verify with `acknowledge` + justification note; same evidence checks; "not found" never releases a parked payout; append-only history | `payoutAdminPolicy.test.js` (ack gate mutation-verified) | DONE — dual control = owner decision DEC-PAY-1 |
| K-3 | Admin note overwrote the previous one; no per-attempt history | same | Low | History from `admin_audit_log` (every note and action kept) | `payoutAdminPolicy.test.js` | FIXED (verified) |
| INT-1 | Refund leaves an in-flight payout alone; if it then failed, the money was restored as **withdrawable**, including after a per-vendor partial refund on a still-paid order | `transferSettlementService.js` | Medium (financial) | Claw back returned money when the customer was refunded for that vendor's lines | `payoutLifecycle.test.js` 10e/10f *mut* | FIXED (verified) |
| INT-2 | `reconcileAvailableAllocations` scanned the 200 oldest `available` allocations (mostly ordinary balances) → crash-stranded credits behind them never recovered | `escrowService.js` | Medium (wallet) | Select only allocations missing a credit | `payoutLifecycle.test.js` 10g *mut* | FIXED (verified) |
| K-4 | Three existing tests pinned implementation details changed on purpose: F-4 and P-GP-6 pinned the old webhook call text; V-09b assumed every run re-verifies every pending order (the FV-7 starvation behaviour) | `paymentLifecycleRecovery`, `paymentCurrencyContract`, `paystackReferenceGuard` tests | — | Patterns updated to the new identifier (same guarantee); V-09b control makes its fixture due before asserting the exact URL query | each investigated, not re-run until green | DONE |
| K-5 | Defence in depth noted: removing the `fromReview` 404 guard is still safe (settlement refuses parked attempts without `fromReview`), so that mutation is not caught by a test — by design | reconciler | — | — | mutation run | DOCUMENTED |

- **K gates (disposable MySQL 8.4.11, low-memory config, `127.0.0.1:33111`):** upgraded DB
  `npm run db:migrate && npm test` **822/822**; fresh install `DB_NAME=rc_p5 npm run db:setup && npm test`
  **822/822**; first full run had 2 failures (V-09b, P-GP-6), investigated as K-4 and fixed before the
  green runs. Concurrency-sensitive set (10 files) ×3 in parallel: 113/113 each. DB-less exit 0 (426 pass,
  111 skipped); backend + frontend typecheck 0; lint 0 errors (13 pre-existing warnings; 2 errors from an
  unused helper in a new test fixed); vitest **79/79** (10 files); build OK; gitleaks working tree: only
  ignored `backend/.env`. The session restarted once mid-validation; every gate was re-run afterwards.

**Verdict: GO FOR STAGING VALIDATION** — not production-approved.

### Phase L — local security, commission completion (2026-10-12, session `566deb7e`)

Detail: `LOCAL_SECURITY_AND_BUG_TRACKER.md`, `COMMISSION_SYSTEM_COMPLETION_REPORT.md`.

| ID | Finding | Disposition |
|---|---|---|
| D-1 → COM-2 | Category commission tier unreachable | FIXED (verified, mutation) |
| D-2 → COM-4 | Custom request without base product never escrowed | FIXED (verified, mutation) |
| COM-1 | Admin UI posted `target` (API needs `targetId`) — non-global rules could not be created | FIXED (verified, mutation) |
| COM-3 | One rate per vendor from its first product | FIXED (verified, mutation) |
| COM-5 | Release recomputed fee from stored rate | FIXED (verified, mutation) |
| COM-6 | Admin rule validation/audit gaps | FIXED (verified) |
| COM-7 | Vendor settings showed a rate the engine does not apply | FIXED |
| SEC-12 | OAuth linking ignored `email_verified` | FIXED (verified, mutation) |
| COM-D1…D8 | 12 % vs 10 %, referral programme absent, shipping/VAT/Paystack-fee ownership, FV-9, refunds after payout | DECISION (commission report §6) |

Gates (disposable MySQL 8.4.11 `127.0.0.1:33155`, dotenv `injected env (0)` on every run): baseline before edits
822/822; after: backend **850/850**, `db:migrate` re-run exit 0, backend + frontend typecheck 0, lint 0 errors
(13 pre-existing warnings), vitest **81/81**, build OK, DB-less run of the new files exit 0, `npm audit --omit=dev` 0/0,
gitleaks history clean. Not re-run: a separate fresh-install-then-suite pass after the edits (no DDL changed; the
850/850 run was on a DB freshly installed after the host reboot).

### Phase M — AI Virtual Try-On completion (2026-10-14)

Scope: AI try-on only (no checkout, payment, commission, inventory or vendor changes). Status:
**CODE-COMPLETE, PROVIDER-SETUP-PENDING** — not production-ready. Details: `AI_TRYON_ARCHITECTURE.md`,
`AI_TRYON_PROVIDER_SETUP.md`, `AI_TRYON_OPERATIONS.md`, `AI_TRYON_TEST_REPORT.md`.

| ID | Finding | Disposition |
|---|---|---|
| TRY-1 | Try-on page offered a static demo catalog (`SAMPLE_PRODUCTS`) whose ids were resolved against the REAL product table — customers saw one garment and the AI received another | FIXED (gallery and Decorate Mode removed; product fixed from the product page; tested A/B) |
| TRY-2 | Try-on garment lookup skipped the suspended-vendor visibility guard | FIXED (verified, DB mutation) |
| TRY-3 | Jobs tracked in an in-memory map (lost on restart, single instance) | FIXED (`ai_tryon_jobs` + `sweepTryOnJobs`; migration `migrateTryOnJobs.js`, additive) |
| TRY-4 | Browser received the provider's output URL directly | FIXED (private stored copy, owner-only endpoint) |
| TRY-5 | No duplicate-submit protection or processing consent | FIXED (idempotency key; consent recorded) |
| TRY-6 | Provider logic hard-wired in the controller | FIXED (adapter registry + Replicate adapter) |
| TRY-7 | IDM-VTON licence is CC BY-NC-SA (non-commercial) | OPEN — production gate `AI_TRYON_PROVIDER_TERMS_ACCEPTED`; owner decision |
| TRY-8 | IDM-VTON input schema/categories not verified against the live model | OPEN — operator step (setup §4.2) |
| TRY-9 | Result images on local, ephemeral disk | OPEN — persistent disk or shared private storage before scaling |
| TRY-10 | Privacy policy does not cover AI photo processing | OPEN — legal text |
| TRY-11 | Testimonial (`Testimonials.tsx`) praises an AI "preview in your home" feature that no longer exists | OPEN — content decision, not edited |
| TRY-12 | Provider-poll backoff started at 10 s (SQL `SET` order), delaying results | FIXED (verified, DB mutation) |
| CART-1 | Server cart sync stores `item.image` but items carry `img` — thumbnails vanish when the cart is reloaded from the server (pre-existing, found in the try-on browser walkthrough) | FIXED (verified) in Phase N — `cartRoutes.js` reads `image ?? img`; `cartSanitize.test.js` (BUG_FIX_TRACKER B-06) |

Gates (disposable MySQL 8.4.11 `127.0.0.1:33717`, `injected env (0)`): fresh `db:setup` then backend **995/995**,
migration re-run exit 0; try-on suites with DB 129/129, without DB 119 pass + 10 DB tests skipped; browser walkthrough (mock provider) passed; vitest **135/135**;
frontend + backend typecheck 0; lint 0 errors (13 pre-existing warnings); build OK; bundle free of provider key names.
No paid AI call, no shared/staging/production DB contact.

### Phase N — UI/UX, mobile responsiveness, accessibility (2026-10-14/15)

Scope and evidence: `FULL_PROJECT_AUDIT.md`, `BUG_FIX_TRACKER.md`, `UI_UX_IMPROVEMENT_REPORT.md`,
`MOBILE_RESPONSIVENESS_REPORT.md`, `ACCESSIBILITY_REPORT.md`, `FINAL_VALIDATION_REPORT.md`.
No authentication, authorisation, payment, refund, payout, commission or tenant-isolation code changed.

- 17 functional bugs fixed (B-01…B-17; no P0/P1 found), incl. CART-1 above, sold-out products addable from
  grids, product page unreachable from grids on touch screens, fabricated product details/rankings, a
  dark-mode flash on every load, and 5 small-phone layout overflows.
- axe-core violations on 39 routes × 2 viewports: 727 → ≈5 nodes (critical 30 → 0).
- Open: R-1 (contrast follow-up / dark mode not crawled), R-2 (27 modals, shared accessible Modal needed),
  R-3 (/products hero density), R-4 (gallery UI absent), R-5; decisions D-1 (reject yard-less order lines?),
  D-2 (grid Add to Cart picks first yard length), D-3 (testimonial/social content).

Gates (disposable MySQL 8.4.11 `127.0.0.1:33717`, `injected env (0)`): backend **999/999** (0 skipped),
vitest **151/151**, frontend + backend typecheck 0, lint 0 errors (11 pre-existing warnings), build OK,
browser crawl 351 pages × 3 full runs + 2 targeted runs, 0 console errors / failed API calls.
