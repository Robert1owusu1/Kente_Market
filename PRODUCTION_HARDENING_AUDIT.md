# Production Hardening Audit

Audit date: 2026-09-16. Scope: React/Vite frontend, Express/MySQL backend,
schema/migrations, payments, deployment, background jobs and CI. This is a
code audit (Phase 0). Every "Implemented" claim below was verified by reading
the current source; it does not assert that the schema migrations, backups,
Paystack dashboard settings, or infrastructure have been applied in the
production environment.

## Legend

Each row: **Severity** | **Finding** | **Files** | **Status**

Status values:
- **Implemented (verified)** — behaviour is present in code and guarded by the
  DB where required.
- **Needs migration** — code assumes a schema change that has not been applied
  to the database yet.
- **Not implemented** — gap remains.

**Status summary (2026-09-17):** 20 findings — 17 **Implemented (verified)**,
1 **Implemented** (`.env.example` template), 1 **Scripted** (encrypted
backups/restore — still operator-run + quarterly drill), 1 **Accepted
limitation** (escrow void policy). 0 open, 0 needs-migration, 0
not-implemented. Operator-owned: scheduling/off-site sync of backups, secret
management, Paystack live validation of payouts (release gate 3), quarterly
RESTORE_DRILL (procedure in `DISASTER_RECOVERY.md`).

## Findings

| Severity | Finding | Files | Status |
|---|---|---|---|
| CRITICAL | Payout could be initiated concurrently before allocation ownership was persisted. | `escrowService.js`, `vendorController.js` | **Implemented (verified):** `payout_attempts` outbox row is committed with a locally-generated unique `reference` *before* the Paystack call; the allocation claim is conditional (`WHERE id=? AND status='available' AND payoutAmount>=?`) so concurrent withdrawals can never double-send funds. |
| CRITICAL | Wallet debit could create a success ledger row after a conditional balance update that affected zero rows. | `walletService.js` | **Implemented (verified):** `debitVendorBalance` checks `debit.affectedRows !== 1` (sufficient balance guard), rolls back, and checks for a prior withdrawal row for the same reference with `FOR UPDATE`. |
| CRITICAL | Escrow wallet credits and allocation creation relied on application-level checks. | `walletService.js`, `escrowService.js`, migrations | **Implemented (verified):** `uq_escrow_order_vendor_type (orderId, vendorId, allocationType)` and `uq_wallet_credit_allocation (vendorId, allocationId, type)` make both idempotent at the DB layer. Constraints confirmed present on the live DB (2026-09-16). |
| CRITICAL | Webhook receipt previously equalled completion for `charge.success`. | `paymentRoutes.js`, migrations | **Implemented (verified):** durable `received/processing/processed/failed` state with conditional claim; failures are re-claimable on Paystack redelivery. |
| CRITICAL | `transfer.success`, `transfer.failed`, `transfer.reversed` still treat *insertion* of the webhook row as completion (`INSERT IGNORE` + `insertId===0` gates). If processing throws after insert on first delivery, every redelivery is permanently ignored — the payout attempt stays `processing`, the wallet is never debited and the allocation is stuck `releasing`. | `paymentRoutes.js` | **Implemented (verified):** all three transfer events now claim a durable webhook row, then settle through `transferSettlementService` (status-guarded within a transaction). A failure rethrows so Paystack redelivers and the event is re-claimed. |
| CRITICAL | `transfer.reversed` does not undo the wallet debit made at `transfer.success` (vendor loses the money twice), does not mark the `payout_attempt` `reversed`, has no immutable reversal journal entry, and locates affected orders via a fragile `updated_at >= NOW()-5s` window that can miss or mis-attribute orders. | `paymentRoutes.js`, `walletService.js`, schema | **Implemented (verified):** `settleTransferReversed` traces the `payout_attempt` by reference, restores the allocation, writes an idempotent `reversal` wallet credit (only when the wallet was actually debited) and a `payout.reversed` journal entry — all atomic. Integration-tested in `backend/tests/settlement.test.js`. |
| HIGH | `wallet_transactions` is a partial ledger, not an immutable double-entry journal; no audit trail for commissions, refunds, reversals or webhook settlement. | schema, wallet/escrow/payment services | **Implemented (verified):** append-only `financial_events` journal (dedupeKey unique). `escrow.release`, `wallet.withdrawal`, `wallet.reversal`, `payout.claimed`, `payout.succeeded` / `payout.failed` / `payout.reversed` and `charge.collected` are recorded. |
| HIGH | Withdrawals initiated while the transfer outcome is unknown (client timeout) are left `processing` forever; no job queries Paystack to reconcile, so money can be lost or duplicated. | `escrowService.js`, `cleanupJobs.js` | **Implemented (verified):** `reconcileStuckTransfers` scheduler job (boot + every 30m) verifies `processing` attempts against Paystack and settles them through the same idempotent service; `reclaimStaleProcessingWebhooks` resets stale `processing` webhook rows. |
| HIGH | `retryFailedAllocations` (admin retry of failed payouts) sets the DB row to `pending` but calls `releaseAllocation`, which only transitions `held -> available`. The retry therefore never actually re-releases the allocation. | `escrowService.js` | **Implemented (verified):** the DB row is now set to `held` (guarded `WHERE status='failed'`) before `releaseAllocation` runs. |
| HIGH | API accepted any `*.vercel.app` origin with credentials. | `securityMiddleware.js` | **Implemented (verified):** explicit env allow-list; localhost only outside production. |
| HIGH | User uploads use ephemeral local disk and only client-supplied MIME/extension checks — no magic-byte validation, no re-encode/dimension limit, files lost on redeploy (Render wipes disk). | upload middleware/routes | **Implemented (verified):** uploads stage into OS temp, then `imageValidator.js` sniffs PNG/JPEG/GIF/WebP magic bytes + header-derived pixel dimensions (max `8192`px, rejects decompression bombs/corrupt/zero-size repos) before persisting through the `storageService` adapter. Local adapter under `backend/uploads` (always present); non-`local` `STORAGE_BACKEND` fails loudly — no silent fallback to insecure disk. S3-compatible switch documented in `.deploy/UPLOADS_OBJECT_STORAGE.md`. Unit-tested in `backend/tests/uploadValidation.test.js`. |
| HIGH | Financial schedulers run inside every API process with no distributed lock; multiple replicas double-run jobs and there is no alerting on job failure. | `cleanupJobs.js` | **Implemented (verified):** every job runs through `runScheduledJob` with a MySQL `scheduler_locks` distributed lock (atomic claim + heartbeat, one replica executes), records last-run status/affected/duration to `scheduler_job_status`, and emits a throttled (once/24h/job) admin email + `admin_audit_log` entry on failure. Admin view: `GET /api/admin/ops/scheduler-jobs`. Verified against the live DB; lock acquire/release + concurrency-skip exercised. |
| HIGH | No demonstrated automated encrypted off-site DB backups or restore drill. | `.deploy/backup-db.sh`, `.deploy/restore-db.sh`, `DISASTER_RECOVERY.md` | **Scripted (infra still operator-run):** `.deploy/backup-db.sh` takes an encrypted logical backup (`mysqldump` → gzip → GPG or AES-256-CBC) with server-aware flags (plain MySQL keeps `--single-transaction`; TiDB drops it because mysqldump's SAVEPOINT aborts the dump), optional uploads archive, plaintext SHA-256 sidecar, retention prune, and an immediate decrypt→gunzip-to-EOF integrity check that deletes and fails loudly on a partial dump. `.deploy/restore-db.sh` lists/verifies/restores with an interactive `RESTORE` confirmation. Drill proven 2026-09-16 against the live cluster: full restore into an isolated `bh_restore_drill` DB — 44/44 tables, 0 row-count mismatches vs live, scratch DB dropped. Off-site transfer and scheduled execution remain operator work. |
| MEDIUM | Admin is a single broad role; no append-only audit log of admin financial actions. | auth/admin routes/schema | **Implemented (verified):** append-only `admin_audit_log` (actor, action, JSON before/after, ip/user-agent) written by `auditLog.js` as best-effort (never fails the admin action). Wired into the money-touching admin paths: order cancel/markPaid/escrow-payout retry, coupon CRUD, promotion CRUD, commission CRUD, settings/update, product moderation. View: `GET /api/admin/ops/audit-log`. |
| MEDIUM | Service worker caches every same-origin `GET /api/*` response network-first, including personalized/authenticated payloads (orders, wallet, profile). After an account switch on the same browser the cached payload of the previous user can be served offline. | `public/sw.js` | **Implemented (verified):** SW only caches an explicit public allow-list (products, storefront, promotions, public reviews, certificate verify); all other `/api/*` GETs pass straight to the network, never cached or served from cache. |
| MEDIUM | `backend/.env.example` is empty; operators have no safe template, risking misconfigured secrets. | `backend/.env.example` | **Implemented:** documented placeholders for every `process.env` read (incl. `STORAGE_BACKEND`), plus production checklist. |
| MEDIUM | OAuth account linking is safe (unverified-account adoption rotates the password), but no concurrent-login invalidation on password reset / profile changes. | `usersModel.js`, `authRoutes.js`, `userController.js`, auth middleware | **Implemented (verified):** `users.tokenVersion` is embedded as JWT claim `tv`; password (`resetPassword`) and email (`User.update`) changes — and unverified-account OAuth adoption — bump it, so every pre-change token is rejected by `protect`/`optionalAuth` (staff tokens are exempt). Integration-tested in `backend/tests/authSessionRevocation.test.js`. |
| MEDIUM | `verify-paystack` fallback and `recoverStuckPendingOrders` both guard the `pending -> paid` flip, so stock/escrow/coupon side effects run exactly once. | `paymentRoutes.js`, `escrowService.js` | **Implemented (verified).** |
| LOW | Frontend production bundle has a large initial JS chunk. | Vite frontend | **Implemented (verified):** the React core (react/react-dom/react-redux/react-router + redux closure) is split into a cacheable `react-core` leaf chunk (≈317 kB / 104 kB gzip). It is the ONLY manual chunk: its dependency graph is self-contained (build check: zero imports to other chunks), so it cannot re-create the React 19.2 `React.Activity` initialization cycle of the previous hand-rolled split. Everything else keeps Rollup's automatic layout; build is warning-free. |
| LOW | `voidEscrowForOrder` only voids `pending`/`held` allocations; released-to-wallet funds have no clawback path on full refund. Flagged as a known limitation, not a bug — requires a policy decision. | `escrowService.js` | **Accepted limitation.** |

## Transfer webhook claim pattern (target design)

All three transfer events must mirror the `charge.success` flow:

1. `INSERT IGNORE INTO webhook_events (...)` — durable receipt.
2. Conditional claim: `UPDATE webhook_events SET processing_status='processing', attempts=attempts+1 WHERE event=? AND reference=? AND processing_status IN ('received','failed')`. `affectedRows===1` owns processing; any other outcome is a duplicate (`processed`) or in-flight (`processing`) and returns `200`.
3. On success mark `processed`; on throw mark `failed` (redelivery reclaims it) and return `500`.

## Reconciliation design

`payout_attempts` rows that remain `processing` past the provider SLA (e.g. 30 min)
are queried against Paystack (`/transfer/verify/:reference`) by the scheduler:
- success  -> settle exactly like `transfer.success` (idempotent via claim guards).
- failed   -> settle like `transfer.failed` (refund allocation).
- reversed -> handle like `transfer.reversed`.

Every settlement writes an immutable `financial_events` row.

## Release gates

1. Run `npm run db:migrate --prefix backend` (and the new hardening migration)
   against a staged copy and verify the new constraints before production.
2. Set explicit `FRONTEND_URL`, `TRUST_PROXY`, `SESSION_SECRET`, `JWT_SECRET`,
   production cookie secrets and Paystack live webhook endpoint. Do not allow
   preview domains in production.
3. Keep real-money payouts disabled until the CRITICAL transfer-webhook claim,
   transfer reversal, ledger, reconciliation and integration-test items above
   are closed and exercised against Paystack test mode.