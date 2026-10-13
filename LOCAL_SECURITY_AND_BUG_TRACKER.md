# Kente Market — Local Security & Bug Tracker

Mission: local security/bug assessment, commission completion, deployment readiness (2026-10-12, session `566deb7e`).
Prior history lives in `PRODUCTION_READINESS_TRACKER.md` and `SECURITY_FINDINGS.md` (preserved, not rewritten).
Nothing here was committed, pushed, deployed or run against TiDB / live Paystack.

## Environment

- Branch `fix/global-production-integration` @ `2df4428`; ~57 tracked files modified + ~50 untracked paths, all
  pre-existing uncommitted work from earlier sessions (preserved).
- Disposable MySQL 8.4.11 at `127.0.0.1:33155` (datadir `/tmp/claude-1000/km5`), wrapper
  `<scratchpad>/dbwrap.sh` shadows every key from `backend/.env` + `.env.example`; dotenv reports `injected env (0)`.
- Host memory is very tight (other apps use most of 3.4 GB; swap was 100 % full). Two tool sessions were
  killed mid-run; mysqld started with `--innodb-buffer-pool-size=32M`, tests run with `--test-concurrency=2`.

## Baseline (before any edit in this mission)

| Gate | Result |
|---|---|
| Fresh install `db:setup` (disposable DB `km_rc`) | exit 0, no failed statements |
| Backend suite (82 files, concurrency 2) | **822/822 pass**, 0 fail |

## Findings

Status: `OPEN` · `FIXED (verified)` · `FIXED (pending test run)` · `VERIFIED OK` · `DECISION` (business) · `ENV` (needs staging)

| ID | Sev | Finding | Files | Status |
|---|---|---|---|---|
| COM-1 | High (business) | Admin Commissions UI sends `target`, API reads `targetId` → every category/vendor/product rule created from the dashboard is rejected (400); list shows `r.target` (always "—") | `CommissionsPage.tsx`, `commissionController.js` | FIXED (verified) — UI sends/shows `targetId`, 4-dp rate input; `CommissionsPage.test.tsx` (mutation-verified) |
| COM-2 | Medium | Category tier unreachable: product `category` never selected, so category rules never apply (was D-1) | `escrowService.createEscrowAllocations`, `customRequestController` | FIXED (verified) — `commissionEngine.test.js` (mutation-verified) |
| COM-3 | Medium | Rate resolved once per vendor from the vendor's *first* product: a product rule leaked to all that vendor's lines, or was ignored for later lines | same | FIXED (verified) — per-line rates, line-weighted fee; mutation-verified |
| COM-4 | Medium | Custom request with no base product created **no** escrow allocation → weaver never paid for a paid order (was D-2) | `customRequestController.checkoutRequest` | FIXED (verified) — `customRequestCheckoutHandler.test.js` COM-4 (mutation-verified) |
| COM-5 | Medium | Release recomputed the fee from the stored rate (4 dp) instead of the fee frozen at order time | `escrowService.releaseAllocation`, `reconcileAvailableAllocations`, custom advance release | FIXED (verified) — `allocationFees()`; mutation-verified |
| COM-6 | Low–Med | Admin rule API: `parseFloat` accepts `"0.1abc"`; update can change scope/target unvalidated; targets never checked to exist; audit `before` holds only `{id}` | `commissionController.js` | FIXED (verified) — strict `parseRate`, target existence, pair re-validation, full before/after audit |
| COM-7 | Low (truthfulness) | Vendor settings show `vendors.platformFeeRate` (default 10 %), which the engine never reaches while the seeded global rule exists | `VendorSettings.tsx`, `vendorController.getMyVendorProfile` | FIXED — `/api/vendors/me` returns `commission.rate` resolved by the engine |
| COM-D1 | Decision | No ambassador/referral system exists in code (no tables, attribution, payouts). Advertised 12 % (8 + 4) is not implemented; live default is a 10 % global rule | — | DECISION |
| SEC-12 | Medium | Google OAuth links/adopts an existing account by email without checking the provider marked that email verified | `config/passPort.js` | FIXED (verified) — `oauthEmailVerification.test.js` (mutation-verified) |
| XSS-R | — | No `dangerouslySetInnerHTML`/`innerHTML` sinks; vendor URLs reach only img/video/iframe(YouTube-id) src; social links not rendered as anchors | `src/**` | VERIFIED OK |
| RL-R | — | Global `/api` limiter + specific limiters on auth/reset/OTP/staff/orders/coupons/uploads/try-on/webhooks; effectiveness depends on OPS-1 | `rateLimitMiddleware.js`, `server.js` | VERIFIED OK (ENV: OPS-1) |

## Commission and payout regression review (Phase 4 items)

| Item | Status |
|---|---|
| FV-6, FV-7, FV-8, FV-13 | FIXED in earlier session — re-confirmed by the passing suites (`recoveryFairness`, `webhookPoolOccupancy`) |
| FV-9 (partial refund excludes tax/shipping share) | DECISION |
| R-6 (vendor debited before refund succeeds), R-7 (one refund claim per order) | DECISION |
| SEC-3 (custom-request pricing gated by `view_customers`) | DECISION — changing it would lock out staff who quote today |
| OPS-1 (`TRUST_PROXY` hop count) | ENV — staging E41 |
| Payout lifecycle (locking, idempotency, reconciliation, admin API) | Not re-reviewed line by line this session; its 26-test suite and the concurrency suites pass in the 850/850 run |

## Files changed in this session

Code: `backend/Services/commissionService.js`, `backend/Services/escrowService.js` (createEscrowAllocations,
release fee, imports), `backend/controllers/customRequestController.js` (escrow step, advance release fee,
imports), `backend/controllers/commissionController.js`, `backend/controllers/vendorController.js`
(getMyVendorProfile + import), `backend/config/passPort.js` (CRLF preserved),
`src/Pages/adminDashboardPages/Commissions/CommissionsPage.tsx`, `src/Pages/Vendor/VendorSettings.tsx`.
Tests: new `backend/tests/commissionEngine.test.js`, `backend/tests/oauthEmailVerification.test.js`,
`src/Pages/adminDashboardPages/Commissions/__tests__/CommissionsPage.test.tsx`; edited (untracked)
`backend/tests/customRequestCheckoutHandler.test.js`.
Docs: this file, `COMMISSION_SYSTEM_COMPLETION_REPORT.md` (new); appended to `SECURITY_FINDINGS.md` §6,
`PRODUCTION_READINESS_TRACKER.md` Phase L, `FINAL_PRODUCTION_READINESS_REPORT.md` §12,
`STAGING_VALIDATION_RUNBOOK.md` §7, `PRODUCTION_DEPLOYMENT_RUNBOOK.md` §5.
`escrowService.js` and `customRequestController.js` already carried uncommitted earlier-session changes; mine are
limited to the regions named above.

## Final gates (after all edits)

Backend 850/850 (fresh install after the host reboot; dotenv `injected env (0)` ×126); `db:migrate` re-run exit 0;
typecheck backend 0 / frontend 0; lint 0 errors; vitest 81/81; build OK; new DB tests skip cleanly without a DB;
`npm audit --omit=dev` 0/0; gitleaks history clean. Mutation checks: COM-1, COM-2, COM-3, COM-4, COM-5, SEC-12 — all caught.

## Referral system + coupon funding (owner-approved rules, `REFERRAL_SYSTEM_DESIGN.md`)

| ID | Item | Files | Status |
|---|---|---|---|
| CPN-1 | Coupon funding: admin coupon funded by platform (split by platform commission, seller income protected); seller coupon funded by seller (platform fee protected); checkout caps (R7); per-order `commissionSnapshot` | `commissionService.js`, `escrowService.js`, `orderController.js`, `couponController.js`, `returnController.js` | DONE — `commissionEngine.test.js` 28/28; `couponBounds.test.js` updated to R7 (100% admin coupon now refused; exactly-at-ceiling accepted) |
| REF-1 | Schema: `migrateReferrals.js` (users ambassador columns, `orders.commissionSnapshot`, `orders.paymentInstrumentHash`, referral_commissions/wallets/ledger/withdrawals, user_devices, settings OFF) | `migrateReferrals.js`, `package.json` | DONE — idempotent re-run; fresh-install chain exit 0 |
| REF-2 | Attribution: link capture cookie (first wins), bind at signup (email + Google), device id, email-alias + same-device blocking | `referralService.js`, `deviceIdMiddleware.js`, `userController.js`, `passPort.js`, `server.js` | DONE — `referralSystem.test.js` (mutation-verified) |
| REF-3 | Earning step in paid side effects (UNIQUE orderId), review signals, promotion at escrow release, refund adjustment hooks, safety-net jobs | `referralService.js`, `escrowService.js`, `cleanupJobs.js` | DONE — `referralSystem.test.js` (mutation-verified) |
| REF-4 | Wallet: withdraw via Paystack (`kente_rtr_`), webhook dispatch, reconciler; pay whole order with earnings (final, cancel/return refused) | `referralPayoutService.js`, `transferSettlementService.js`, `orderController.js`, `returnController.js` | DONE — `referralSystem.test.js` (mutation-verified) |
| REF-5 | API: `/api/referrals/*`, `/api/admin/referrals/*` (audited, rate ≤ platform commission) | `referralController.js`, `referralRoutes.js`, `rateLimitMiddleware.js` | DONE — HTTP 401/403 + validation tests |
| REF-6 | Frontend: link capture, ambassador page, admin referrals page, pay-with-earnings, coupon cap display | `ReferralCapture.tsx`, `ReferralsPage.tsx`, `ReferralsAdminPage.tsx`, `referralsApiSlice.ts`, `checkout.tsx`, `App.tsx`, `Navbar.tsx`, `AdminDashboard.tsx`, `apiSlice.ts`, `constant.ts` | DONE — 3 vitest files (6 tests); checkout earnings button covered by typecheck/lint only |
| REF-7 | Sellers as referrers (owner rule R1a): already supported by the engine; added seller dashboard section "Refer Customers" (store + home links with code) | `VendorReferrals.tsx`, `VendorDashboard.tsx` | DONE — backend test "seller as ambassador" (25/25 referral suite), `VendorReferrals.test.tsx` 2/2, vitest 89/89, lint 0 errors, build OK |

### Gates after the referral work (disposable MySQL 8.4.11, dotenv `injected env (0)` on every run)

| Gate | Result |
|---|---|
| Fresh install (`db:setup` into new DB `km_ref`, chain includes `migrateReferrals.js`) | exit 0 (only the documented M-4 early-index notices) |
| Backend suite on that fresh install | **881/881** (850 + 28 commission rewrite delta + 24 referral + coupon R7 tests) |
| Upgrade path (`db:migrate` full chain re-run on the older DB) | exit 0, idempotent |
| Backend / frontend typecheck | 0 / 0 |
| Lint | 0 errors (13 pre-existing warnings) |
| Vitest | **87/87** (14 files) |
| Frontend build | OK |
| Mutation checks (referral) | 8/8 caught |
| `npm audit` / gitleaks | not re-run — no dependency or secret-handling change since the earlier clean run |

## Resume point

Referral programme implemented and tested locally (programme ships OFF). Next steps need the owner: confirm design §6 defaults and §8 decisions, legal terms, then staging E42–E56 in Paystack test mode.

---

## Final local validation + authorized pen test (2026-10-12, session `fe49cfc1`)

Disposable MySQL 8.4.11 `127.0.0.1:33177` (datadir `/tmp/claude-1000/kmv`), every `backend/.env` key shadowed
(dotenv `injected env (0)`), API on `127.0.0.1:5055` with all outbound HTTP forced through a dead proxy
(Paystack/SMTP unreachable by construction; Paystack webhooks simulated with HMAC over the local placeholder secret).

| ID | Sev | Finding | Files | Status |
|---|---|---|---|---|
| VAL-1 | Medium | Token confusion: `protect` / `optionalAuth` / `vendorOrStaff` accepted any JWT with `{id, tv}`; the OAuth `oauth_exchange` token (10 min, meant single-use via jti) worked directly as a session cookie (live probe: `GET /api/users/profile` → 200) | `middleware/authMiddleware.js` | FIXED (verified) — purpose-bound tokens rejected; live probe → 401; `tests/purposeTokenSession.test.js` 3/3 (mutation: 0/3 with fix removed) |
| VAL-2 | Low (availability) | Concurrent referral withdrawals (or pay-with-earnings) on one wallet deadlocked: `INSERT IGNORE` on the existing wallet row inside the txn took an S lock the `FOR UPDATE` had to upgrade → 3/5 parallel requests HTTP 500. No double reservation | `Services/referralPayoutService.js` | FIXED (verified) — wallet row created before the txn; live 5× parallel → `[202,400,400,400,400]`; new test in `referralSystem.test.js` (mutation: 6× `ER_LOCK_DEADLOCK`) |
| VAL-3 | Low (migration truthfulness) | `migrateInternationalAddresses.js` / `migrateInternationalOrders.js` turned any non-duplicate `ALTER` error into a warning, printed ✅ and exited 0 | both files | FIXED (verified) — unexpected errors now fail the script (forced failure → exit 1; normal re-run → exit 0) |
| VAL-4 | Low (schema drift) | M-4: `migrateMarketplace.js` indexed `financial_events` / `scheduler_job_status` before they exist → fresh install skipped them, a 2nd run added duplicates of `uq_fe_dedupe`, `idx_fe_order`, PK(jobName) | `migrateMarketplace.js` | FIXED (verified) — redundant entries removed; fresh install vs re-migrate `mysqldump --no-data` identical |
| VAL-5 | Low | Owner `PUT /api/orders/:id` with only forbidden fields → 500 ("No valid fields to update") | `orderController.js`, `models/orderModel.js` | FIXED (verified) — 400; `orderOwnerFields.test.js` new case; source guard in `couponMaxUses.test.js` follows the moved whitelist |

Black-box journeys/probes (`scratchpad/blackbox.mjs`, synthetic users): **64/64** after fixes — server-side totals (client price/total/discount ignored), stock reserve 5→3 and no double decrement, over-stock refused, unapproved product not purchasable, bad signature / underpaid / `charge.failed` / provider-unreachable verify never mark paid, 4 concurrent + 1 replayed `charge.success` → one paid flip, one escrow allocation, one referral commission, no duplicate journal rows; abandoned order → no commission; referral capture + bind; horizontal IDOR (orders, products, vendor orders, pay-order) and 17 vertical admin/vendor endpoints denied; mass assignment (order money/status, profile role/referral fields) refused; CSRF required; wrong-key and `alg=none` JWTs rejected; logout revokes; login throttled after 5 failures; forgot-password uniform; SQLi-shaped params safe; referral withdrawal: single reservation, ambiguous provider keeps funds reserved, mismatched/unsigned `transfer.success` never pays; paid-order cancel with refund failure keeps escrow held. Also: CORS no ACAO for foreign origin, `/uploads` traversal 404, `/metrics` hidden, DB outage → readiness 503 then self-recovers.

Gates after all edits: backend **887/887**; backend/frontend tsc 0/0; eslint 0 errors (13 warnings); vitest 89/89; `vite build` OK.

Not verified locally: TiDB compatibility (no TiDB available — needs staging), live Paystack test-mode flows, `npm audit`/gitleaks (not re-run; no dependency change). Open business decisions unchanged: FV-9, R-6, R-7, SEC-3; OPS-1 is ENV.

---

## Remaining local gates + staging preparation (2026-10-12, session `fe49cfc1`, second pass)

State verified first: branch `fix/global-production-integration` @ `2df4428`, 144 changed/untracked paths
(all preserved), the five fixes from the first pass present. Same disposable MySQL (`127.0.0.1:33177`) and
env-shadowing wrapper (24/24 `.env` keys shadowed, re-checked).

| ID | Sev | Finding | Files | Status |
|---|---|---|---|---|
| VAL-3 test | — | Regression test for migration failure exit (was command-only) | `tests/migrationFailureExit.test.js` | DONE — 4/4; fails when the old warn-and-continue is restored |
| VAL-4 test | — | Regression test for index ordering (was dump-diff only) | `tests/migrationPortability.test.js` | DONE — fails when the removed entries are re-added |
| REF-ASYNC | Medium | `refund.failed` / `refund.*` webhooks ignored; provider-failed refunds invisible | `routes/paymentRoutes.js` | FIXED (verified) — `tests/refundLifecycle.test.js` 1–2 (mutation-verified); live G2–G4 |
| REF-RELEASED | Low–Med | Refund after vendor payout (`released`) silent platform loss | `Services/escrowService.js`, `routes/adminOpsRoutes.js` | FIXED (verified, visibility only) — one `reconciliation_checks` row per order (`job=refundAfterRelease`), listed by `GET /api/admin/ops/reconciliation-reviews?job=refundAfterRelease`; `refundLifecycle.test.js` 3 (mutation-verified: helper and job registration) |
| REF-13b | — | Coverage: refund after referral commission withdrawn → wallet debt once, blocks withdrawal, offset later | `tests/referralSystem.test.js` | VERIFIED OK (behaviour already correct) |
| STORE-1 | Low | Profile pictures bypass `storageService` (lost on ephemeral disk) | `routes/profileRoutes.js` | OPEN |
| DOC-1 | Low | `.env.example` missing variables; prod runbook wrongly said S3 not implemented | `backend/.env.example`, runbook | OPEN (`.env.example`); runbook CORRECTED |
| CFG-1 | Low | `FRONTEND_URL` comma list (CORS) is also used as a single URL base → multiple origins break reset/OAuth/referral links | `securityMiddleware.js`, `authRoutes.js`, `emailService.js` | OPEN (runbooks: one origin) |
| MIG-2 | Low | Other migrations log-and-continue on some errors | various `migrate*.js` | OPEN (runbook rule) |
| MIG-3 | Info | DBs upgraded under the old `migrateMarketplace.js` keep 3 redundant indexes | — | DOCUMENTED |

Gates (final code): backend **896/896** (0 skipped); backend/frontend tsc 0/0; eslint 0 errors (13 warnings);
vitest 89/89; `vite build` OK; fresh install + re-migrate identical; live black-box **67/67**; npm audit gates pass
(runtime 0/0); gitleaks history + working tree 0 findings.

Reports: `LOCAL_SYSTEM_TEST_REPORT.md`, `DATABASE_AND_FINANCIAL_INTEGRITY_REPORT.md`, `SYSTEM_INVENTORY.md` (new);
`SECURITY_FINDINGS.md` §7, `STAGING_VALIDATION_RUNBOOK.md` §9, `PRODUCTION_DEPLOYMENT_RUNBOOK.md` §6,
`FINAL_PRODUCTION_READINESS_REPORT.md` §14 (appended).

---

## Staging preparation (2026-10-13, session `fe49cfc1`)

| ID | Sev | Finding | Files | Status |
|---|---|---|---|---|
| CFG-1 | Low | `FRONTEND_URL` read raw in 9 places | `config/frontendOrigins.js` (new), `server.js`, `securityMiddleware.js`, `csrfMiddleware.js`, `emailService.js`, `orderEmailService.js`, `cleanupJobs.js`, `paystackservices.js`, `referralController.js`, `authRoutes.js`, `setupFirstAdmin.js` | FIXED (verified) — `frontendOrigins.test.js` |
| STORE-1 | Low | Profile pictures bypassed `storageService` | `routes/profileRoutes.js`, `Services/storageService.js` | FIXED (verified) — `profileUploadStorage.test.js` |
| PIC-1 | Low | Profile delete always 400; old pictures never removed (`profile_picture` vs `profilePicture`) | `routes/profileRoutes.js` | FIXED (verified) |
| DOC-1 | Low | `.env.example` gaps | `backend/.env.example` | FIXED |
| CI-1 | Low | Suite-level skips invisible in CI; migration-failure test skipped in CI | `.github/workflows/ci.yml`, `scripts/ci-grant-scratch-db.mjs` | FIXED (rehearsed locally; first real run pending) |
| OPS-T | — | Preflight + smoke tooling | `scripts/staging-preflight.mjs`, `scripts/staging-smoke.mjs`, `package.json` | DONE — `stagingPreflight.test.js` 6/6; smoke 13/13 on local prod-mode stack |
| DOC-R | — | Runbook §9.2 told operators to set `OAUTH_CALLBACK_URL` to the full callback path (code appends it) | `STAGING_VALIDATION_RUNBOOK.md` | CORRECTED |

Release-set verification: a clean copy of exactly the files a commit would contain (tracked + 87 untracked, no
`.env`, no uploads) → fresh `db:setup` exit 0, backend **913/913** (0 `# SKIP`), tsc 0/0, eslint 0 errors,
vitest 89/89, build OK, gitleaks 0 (after deriving test fixture secrets at runtime). CI DB-less rehearsal: 0 fail.

---

## CI run on PR (2026-10-13) — MySQL job cancelled at 30 min; root causes and fixes

| ID | Finding | Fix | Evidence |
|---|---|---|---|
| CI-2 | `internationalFxThreshold.test.js` (never in CI before) leaked a MySQL connection when `DROP DATABASE` was refused for the unprivileged CI user → the test process never exited → job hit its 30-min timeout | connection closed in `finally` | CI-identical local run (no `.env`, CI env only, `ci` user, `npm test` concurrency 4, the workflow's own step script under `bash -eo pipefail`): hang reproduced (>10 min, idle `ci` connection), gone after the fix (~2 min) |
| CI-3 | Same suite's scratch DB `finaud_fresh_mig` outside the CI grant (5 failures behind the hang) | scratch schemas renamed to `km_scratch_*`; one grant covers both suites | same run: suite passes as `ci` |
| CI-4 | `payoutLifecycle` test 4 creates a trigger; MySQL 8.4 binary logging requires SUPER for that (`ER_BINLOG_CREATE_ROUTINE_NEED_SUPER`) | `scripts/ci-prepare-test-db.mjs` (renamed from `ci-grant-scratch-db.mjs`) also sets `log_bin_trust_function_creators=1` on the disposable service | passes as `ci` |
| CI-5 | My first skip-guard version could mask a test failure when the shell is not `-e` | explicit `status` capture; exits with the suite's status after the skip check | step script tested: pass→0, fail→1, skip→1 under both `bash -eo pipefail` and plain bash |
| CI-6 (known flake, open) | node:test runner "Unable to deserialize cloned data" on `verification-fixes.test.js` in 1 of 5 CI-identical runs at concurrency 4 (file passes alone 3/3; runner IPC, not test logic) | none — re-run the job if seen; consider `--test-concurrency=2` if it recurs | 4 of 5 full runs 913/913 |

Final CI-identical result: 913/913, exit 0, 0 `# SKIP` (3 consecutive runs after the fixes, plus the workflow-script run).

---

## TiDB verification on the hosted development cluster (2026-10-13)

Owner confirmed the `.env` database is development/test. Read-only inspection of `branding_house`; full suite in an
isolated `km_scratch_tidb_rc1` schema on the same TiDB v8.5.3-serverless server (dropped after each run). Details:
`DATABASE_AND_FINANCIAL_INTEGRITY_REPORT.md` §7.

| ID | Sev | Finding | Files | Status |
|---|---|---|---|---|
| DB-PING | Medium | Keep-alive ping destroyed busy connections → 500 "DB ping failed" on slow statements | `config/db.js` | FIXED (verified) — `dbPingBusyConnection.test.js`; TiDB pass |
| TIDB-COLL | Medium | Case-sensitive LIKE on TiDB (`utf8mb4_bin`) broke search | `productModel.js`, `usersModel.js`, `vendorModel.js`, `orderModel.js`, `referralController.js` | FIXED (verified on TiDB) — `caseInsensitiveSearch.test.js` |
| NOTIF-1 | Low–Med | `custom`/`buyback` notifications never stored (ENUM) | `migrateNotificationTypes.js` (new, in `db:migrate`) | FIXED (verified) — `notificationTypes.test.js` |
| TIDB-CHECK | Low | CHECK constraints not enforced on TiDB by default | — | OPEN — decision (enable `tidb_enable_check_constraint` on prod) |
| TIDB-TLS | Low | Dev `.env` uses unverified TLS | config | OPEN — set `DB_SSL_CA` (public CA bundle works) |
| T-PORT | — | Money suites refused remote DBs; MySQL-only test techniques; FX suite without TLS; TiDB `SHOW CREATE` spacing | tests + `tests/helpers/disposableDb.mjs` | FIXED |

Results: TiDB fresh install + re-migrate exit 0; full suite 915/921 (remaining 5+1 explained and fixed/recorded), FX
40/40 after fixes; local MySQL 921/921.
