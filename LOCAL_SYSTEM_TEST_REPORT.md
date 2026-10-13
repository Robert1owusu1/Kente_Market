# Local System Test Report — Kente Market

Branch `fix/global-production-integration` @ `2df4428` plus uncommitted work (nothing committed, pushed or deployed).
Runs on 2026-10-12, sessions `fe49cfc1` (first pass + this pass). Every result below was executed in this session;
nothing is copied from older reports.

## Environment and isolation

| Item | Value |
|---|---|
| Database | Disposable MySQL 8.4.11, `127.0.0.1:33177`, datadir `/tmp/claude-1000/kmv`, 32 MB buffer pool. Databases: `km_val` (test suite), `km_p3` (fresh install for this pass), scratch DBs created/dropped by tests |
| Env isolation | `WRAP` = `<scratchpad>/dbwrap.sh`: exports a placeholder for **every** key in `backend/.env` (verified with `dotenv.parse`: 24 keys, 0 missing) and refuses a non-loopback `DB_HOST`. dotenv reports `injected env (0)` on every run |
| Paystack | Placeholder `sk_test_local_placeholder`. Webhooks signed locally with it. Refund/transfer/verify calls mocked in tests; in live runs all outbound HTTP was forced through a dead proxy (`HTTP(S)_PROXY=http://127.0.0.1:9`) — Paystack/SMTP unreachable by construction |
| Hosted TiDB | **Never contacted.** Not migrated. |
| Live API | `node server.js` via `WRAP`, `NODE_ENV=development`, `TRUST_PROXY=1` (so synthetic clients get distinct IPs), port 5055; stopped after use |

## Results

| # | Check | Command (from repo root unless noted) | Result |
|---|---|---|---|
| 1 | Backend suite (final) | `cd backend && DB_NAME=km_val WRAP node --import ./tests/helpers/testDbGuard.mjs --test --test-concurrency=2 "tests/**/*.test.js"` | **896/896 pass**, 0 fail, 0 skipped, 0 cancelled (exit 0) |
| 2 | Backend typecheck | `cd backend && npx tsc --noEmit -p tsconfig.json` | exit 0 |
| 3 | Frontend typecheck | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| 4 | Lint | `npx eslint .` | exit 0 — 0 errors, 13 warnings (pre-existing, unchanged) |
| 5 | Frontend tests | `npx vitest run` | **89/89 pass** (15 files) |
| 6 | Production build | `npx vite build --outDir <scratchpad>/dist-check` (repo `dist/` untouched) | exit 0, built in 24 s |
| 7 | Fresh install | `cd backend && DB_NAME=km_p3 WRAP npm run db:setup` | exit 0; 60 tables, 228 indexes, 55 FKs |
| 8 | Second migration run | `DB_NAME=km_p3 WRAP npm run db:migrate` + `mysqldump --no-data` diff | exit 0; **schema identical** |
| 9 | Forced migration failure | `tests/migrationFailureExit.test.js` (scratch DB with broken tables) | both international migrations exit non-zero, no ✅; normal re-run exits 0 (4/4) |
| 10 | Dependency scan | `npm audit --json` + `.github/scripts/audit-gate.mjs` (both workspaces); `npm audit --omit=dev` | frontend 0 advisories; backend 3 high, all dev-only, all in CI baseline; runtime 0/0 — see `SECURITY_FINDINGS.md` §7 |
| 11 | Secret scan | `gitleaks detect --source . --redact` (history, v8.24.3 = CI) and `gitleaks detect --no-git` over the 565 tracked + untracked-not-ignored files | **0 findings** / **0 findings**; `backend/.env` git-ignored and never committed |
| 12 | Live black-box journeys + probes | `BB_DB=km_p3 node <scratchpad>/blackbox.mjs` against the live API | **67/67 pass** |
| 13 | Data-safety guards | `testDbGuard` and `setupDB.js` with `DB_HOST=203.0.113.7` (TEST-NET, unroutable) | both exit 1 with the refusal message, no connection |
| 14 | DB outage | stop mysqld while API runs; `/health/ready`; restart | 503 `DEGRADED` during outage, 200 after restart, no restart of the API needed |

### Per-file regression evidence (each file run alone, same command shape as #1)

moduleGraph 3/3 · customRequestCheckoutHandler 5/5 · paidSideEffects 8/8 · finalVerificationRaces 9/9 ·
adminMarkPaidRace 1/1 · purposeTokenSession 3/3 · oauthEmailVerification 5/5 · oauthStateGate 11/11 ·
authSessionRevocation 4/4 · loginLockout 21/21 · vendorIsolation 9/9 · refundDoubleSpend 5/5 ·
withdrawalConcurrency 4/4 · payoutLifecycle 29/29 · escrowCancellationRefund 20/20 · webhookPoolOccupancy 1/1 ·
paymentLateCharge 11/11 · paymentRecovery 14/14 · paymentLifecycleRecovery 16/16 · refundReconcile 2/2 ·
partialRefunds 3/3 · returnRefundOutcome 3/3 · refundGuard 10/10 · refundRestore 4/4 · recoveryFairness 9/9 ·
rb02-escrow-retry 6/6 · refundLifecycle 3/3 · referralSystem 27/27 · migrationPortability 5/5 ·
migrationFailureExit 4/4 · orderOwnerFields 2/2 — all 0 fail, 0 skipped.

### Live journeys (black-box, synthetic accounts, `blackbox.mjs`)

| Journey | Checks | Result |
|---|---|---|
| A Registration/login/checkout | register, login, server-side totals (client price/total/discount ignored: 460.00 = 2×200 + 60 tax), CSRF required | pass |
| B Paid order | signed `charge.success` ×4 concurrent + replay → 1 paid flip, 1 escrow allocation (400/fee 40), stock 5→3 once, 1 `charge.collected`, 1 referral commission | pass |
| C Failure modes | bad signature 400; underpaid 400 (not paid); `charge.failed` not paid; verify with provider unreachable not paid | pass |
| D Vendor | create (pending moderation), edit own, cannot edit other vendor's product/order | pass |
| E/F Referral | capture cookie, bind at signup, one commission per paid order; abandoned order → none; pay-order refused without balance | pass |
| G Refund | admin cancel with refund provider unreachable → not cancelled, escrow held; signed `refund.failed` → 1 alert + 1 journal row, duplicate ignored; unsigned 400; `refund.processed` recorded, no state change | pass |
| H Withdrawal | 5 concurrent referral withdrawals → `[202,400,400,400,400]`, one reservation; provider unreachable keeps it `processing`; mismatched/unsigned `transfer.success` never pays | pass |
| I Authorization | 17 admin/vendor endpoints refuse a customer (403); vendor refused admin; IDOR on orders/products/vendor orders/pay-order refused | pass |
| J Totals | see A; over-stock refused | pass |
| K Inventory | reservation at checkout, no double decrement, over-stock refused | pass |
| Auth | wrong-key and `alg=none` JWT 401; `oauth_exchange` token as cookie 401; logout revokes; 5 failed logins → 429; forgot-password uniform | pass |
| Misc | SQLi-shaped params 200 (no leak); CORS no ACAO for foreign origin; `/uploads` traversal 404; `/metrics` hidden without token | pass |

Journeys G (full/partial refund with real provider) and L (scheduled jobs on a timer) were exercised through the
test suite with mocked provider responses (see `DATABASE_AND_FINANCIAL_INTEGRITY_REPORT.md` §3), not on a timer
against Paystack.

## Failures during this pass (all resolved, none outstanding)

| Run | What failed | Cause | Resolution |
|---|---|---|---|
| refundLifecycle first run | 1 of 3 (setup) | fixture violated `uq_escrow_order_vendor_type` | fixture uses a second vendor |
| Earlier pass, full suite | 1 of 887 (`couponMaxUses` source guard) | guard regex looked for the moved whitelist | regex follows `Order.UPDATABLE_FIELDS` |
| Earlier pass, black-box | IDOR2-4 returned 401 | test artifact: `TRUST_PROXY=0` put all clients in one rate-limit bucket | rerun with `TRUST_PROXY=1`: 403/404 |

## Not verified locally

- TiDB compatibility (no TiDB available; **unverified** until staging TiDB).
- Real Paystack test-mode behaviour (refund asynchrony, transfer OTP, webhook delivery/retry).
- Scheduled jobs on their real intervals on a hosted single replica / multi-replica lock behaviour.
- Email delivery, Google OAuth against Google, Replicate try-on, S3 storage.

## Staging preparation run (2026-10-13)

### Release set
A clean copy of exactly the files a release commit would contain (`git ls-files -co --exclude-standard`: tracked +
87 untracked, **no** `backend/.env`, no `uploads/`), with `node_modules` linked, at `<scratchpad>/release-check`:

| Check | Command (in the copy) | Result |
|---|---|---|
| Fresh install | `DB_NAME=km_rel WRAP npm run db:setup` | exit 0; dotenv injected 0 keys in every process |
| Backend suite | `DB_NAME=km_rel WRAP node --import ./tests/helpers/testDbGuard.mjs --test --test-concurrency=2 "tests/**/*.test.js"` | **913/913**, 0 fail, **0 `# SKIP` markers** |
| Typechecks | `npx tsc --noEmit -p tsconfig.json` (root, backend) | 0 / 0 |
| Lint | `npx eslint .` | 0 errors, 13 warnings |
| Vitest | `npx vitest run` | 89/89 |
| Build | `npx vite build --outDir <scratchpad>/rel-dist` | OK |
| Secret scan | `gitleaks detect --no-git --source <copy>` / history | 0 / 0 — after `stagingPreflight.test.js` fixture secrets were changed to be derived at runtime (the first scan flagged 5 synthetic literals; that file then re-ran 6/6 in the repo) |

The repo working tree equals the copy except for documentation appended afterwards.

### CI rehearsals
| Check | Result |
|---|---|
| DB-less job (`DB_HOST=` , closed port, all `.env` keys shadowed) | 575 tests: 463 pass, 0 fail, 112 skipped by design; exit 0 |
| Scratch-DB grant (`scripts/ci-grant-scratch-db.mjs` as root on the disposable MySQL) | `ci` can create/drop `km_migfail_*`; `CREATE DATABASE other_db` denied; script refuses non-loopback hosts |
| `migrationFailureExit.test.js` as `ci` | before grant: skipped (`ER_DBACCESS_DENIED_ERROR`); after: 4/4 |
| Skip guard shell logic | log with `# SKIP` → exit 1; summary-only log → exit 0 |
| Workflow YAML | parses; MySQL job steps in order: checkout, node, install, grant, db:setup, tests+guard |

### Staging tools
| Check | Result |
|---|---|
| `tests/stagingPreflight.test.js` | 6/6 — good staging config passes; live key on staging and test key on production fail; 9 dangerous settings each fail by name; TLS without CA fails unless explicitly unverified (WARN); `--db` refuses loopback; no secret value appears in any output |
| `scripts/staging-smoke.mjs` against a local **production-mode** API (`NODE_ENV=production`, port 5056, outbound blocked) behind the Vite proxy | 13/13 PASS; negative runs: wrong `--web` → 2 FAIL, exit 1; http without `--allow-http` → exit 2 |
| `tests/frontendOrigins.test.js` | 7/7 (boot refusal 4/4 fails without the guard) |
| `tests/profileUploadStorage.test.js` + `uploadGate.test.js` | 11/11 (original route fails 3/4) |
