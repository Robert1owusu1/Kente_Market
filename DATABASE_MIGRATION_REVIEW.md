# Database Migration Review — fix/global-production-integration

Scope: every migration added on this branch relative to `main`, plus the two migration
defects fixed in this mission. Validated **only** on a disposable MySQL 8.4.11 started by
this session (`127.0.0.1:33099`, own datadir). **Nothing was run against TiDB Cloud or any
shared database.** TiDB compatibility is therefore *unverified* and is a staging gate.

## 1. Chain and ordering

`npm run db:migrate` (backend/package.json) runs 29 scripts in order. `main` has 22; the 7
new ones run last, in this order:

| # | Script | Change | Locks / rewrites | Safe with existing rows | Downtime |
|---|---|---|---|---|---|
| 23 | `migrateExchangeRates.js` | `CREATE TABLE IF NOT EXISTS exchange_rates`; **seeds approximate rates when the table is empty** | new table only | yes | no |
| 24 | `migrateShippingCarriersRates.js` | `CREATE TABLE shipping_carriers`, `shipping_rates`; seed rows (`INSERT IGNORE`) | new tables | yes | no |
| 25 | `migrateVendorShippingDestinations.js` | `CREATE TABLE vendor_shipping_destinations`; backfills **GH** for every approved vendor (`INSERT … SELECT … WHERE NOT EXISTS`) | new table | yes (idempotent, NULL-safe) | no |
| 26 | `migrateInternationalAddresses.js` | `user_addresses` + `addressLine3`, `province`, `countryCode` (**VIRTUAL generated** since 2026-10-12; was STORED), index `idx_addresses_country` | nullable ADD COLUMNs + VIRTUAL column are instant on MySQL 8; the index build reads the table | yes — no application code reads these three columns today | no; see §3 |
| 27 | `migrateInternationalOrders.js` | adds currency/international columns to `orders`, `escrow_allocations`, `financial_events`; index `idx_orders_currency` | ALTER on large tables | yes (nullable/defaulted) | MySQL 8 instant/inplace for nullable ADD COLUMN; verify on TiDB |
| 28 | `migratePaymentProcessingState.js` | `orders.paymentSideEffects JSON NULL`; `platform_revenue.grossAmount`, `.discountAmount`; backfill `grossAmount = amount, discountAmount = 0` where NULL | ALTER `orders`; UPDATE of `platform_revenue` (small) | yes — **existing orders stay NULL = untracked, never touched by recovery** | no |
| 30 | `migratePayoutLifecycle.js` (new, 2026-10-12, R-8) | `payout_attempts.status` enum gains `reconciliation_required` (appended); 14 nullable/defaulted columns (`currency`, `amountMinor`, `withdrawalId`, `initiatedAt`, `initiateHttpStatus`, `providerStatus`, `checkCount`, `lastCheckedAt`, `reviewReason`, `alertedReason`, `alertedAt`, `resolutionNote`, `resolvedBy`, `resolvedAt`); indexes `idx_payout_lifecycle (status, lastCheckedAt)`, `idx_payout_withdrawal (withdrawalId)`; new table `vendor_withdrawals` (unique `(vendorId, requestKey)`) | appending an ENUM member and adding nullable columns are metadata-only on MySQL 8 (verify on TiDB); index builds read `payout_attempts` (small table) | yes — existing attempts keep their status and get defaults (`currency='GHS'`, `checkCount=0`, NULLs). Legacy attempts have `amountMinor` NULL; code falls back to `amount×100` | no. **Fails loudly (exit 1)** on any error, unlike most older scripts |
| 31 | `migrateReconciliationChecks.js` (new, 2026-10-12, FV-6/FV-7) | new table `reconciliation_checks` (PK `(job, entityId)`, indexes `(job, state, lastCheckedAt)`, `(job, nextCheckAt)`) | new table only | yes — no existing table touched | no. Fails loudly. Until it runs, both jobs fall back to their legacy scans (warning logged) |
| 29 | `migrateCustomRequestOrderIdUnique.js` | `UNIQUE KEY uq_custom_requests_orderId (orderId)` after a duplicate check (refuses and reports duplicates) | index build on `custom_requests` | yes if no duplicates; **fails safe** otherwise | no |

Ordering requirement: deploy order is **backup → migrations → backend → frontend**. The new
backend code writes `orders.paymentSideEffects` on every paid flip, so migration 28 **must**
run before the new backend serves traffic (otherwise every paid flip fails with
`ER_BAD_FIELD_ERROR`). Migrations are additive, so the *old* backend keeps working after
they run (safe to migrate first).

## 2. Defects found and fixed in this mission

| ID | Script | Defect | Fix | Evidence |
|---|---|---|---|---|
| M-1 | `migrateInternationalAddresses.js` | `ADD COLUMN addressLine3 … AFTER addressLine2 COMMENT '…'` — `COMMENT` after `AFTER` is a syntax error; the error was caught and logged, the script exited 0, the column never existed | Clause order `COMMENT … AFTER …` | fresh + re-run: "Added", then "already exists" |
| M-2 | same | same defect for `province` | same | same |
| M-3 | `migratePaymentProcessingState.js` | `ADD INDEX (paymentStatus, paymentSideEffects)` — MySQL cannot index a JSON column; always failed (swallowed) | Removed; recovery scan is bounded by `LIMIT` and filters on the existing `idx_orders_paymentStatus` | `SHOW INDEX` |
| M-4 | `migrateMarketplace.js` (pre-existing) | adds `idx_financial_dedupe`, `idx_financial_order`, `idx_scheduler_job_name` before the tables exist on a fresh install (logged "Could not add…") | **Not changed** — equivalent indexes (`uq_fe_dedupe`, `idx_fe_order`, PK on `jobName`) are created by the later migration; cosmetic noise only | `information_schema.STATISTICS` on fresh DB |
| TIDB-1 | `migrateInternationalAddresses.js` | `countryCode` was added as a **STORED** generated column via `ALTER TABLE`, which TiDB does not support (the statement would fail and be swallowed on production) | Changed to VIRTUAL — same expression, same values, indexable on MySQL and TiDB; no table rewrite on MySQL. Databases that already have the STORED column keep it (the migration reports "already exists"); that is harmless | fresh install shows `VIRTUAL GENERATED`; values GH/GB/NULL verified; `tests/migrationPortability.test.js` forbids STORED generated columns in migrations (mutation-verified) |
| M-5 | `migrateInternationalAddresses.js`, `migrateInternationalOrders.js` | `down()` used `DROP COLUMN/INDEX IF EXISTS` (MariaDB syntax, rejected by MySQL 8) and dropped `countryCode` before its index | Existence checked in `information_schema`; index dropped first. All dropped columns were introduced on this branch (none exist on `main`) | up → up → down → down → up on scratch copies of the real tables in the disposable DB; guard test forbids the MariaDB forms |
| S-2 | `setupDB.js` (`npm run db:setup`) | Runs `DROP DATABASE IF EXISTS $DB_NAME` guarded only by `NODE_ENV=production`; the developer `.env` points at TiDB with `NODE_ENV` empty → `db:setup` on a dev machine would drop the hosted DB. Also always loaded the schema into `branding_house` regardless of `DB_NAME` | Refuses unless `DB_HOST` is loopback (or `ALLOW_DESTRUCTIVE_DB=1`); validates `DB_NAME`; loads schema into `DB_NAME` | refusal verified; fresh install into `rc_fresh` |

**Swallowed-error pattern (residual risk).** Most migrations wrap each statement in
`try/catch → console.warn` and exit 0. A failed statement does **not** fail the deploy.
After running migrations in staging/production, operators must grep the output for
`Could not` / `Error` and run the verification queries below. Changing every migration to
fail hard was not done (broad behavioural change to tooling the deploy depends on).

## 3. TiDB compatibility (UNVERIFIED — staging gate)

| Concern | Where | Risk |
|---|---|---|
| Generated column on an existing table | migration 26 (`user_addresses.countryCode`) | **Resolved locally (2026-10-12):** now VIRTUAL, which TiDB supports via `ALTER TABLE` (STORED is not). Staging must still confirm "Added user_addresses.countryCode" and "Added idx_addresses_country" in the migrate log. Nothing in the application reads the column, so a failure would only cost the index. |
| JSON functions in hot paths | `JSON_SET`, `JSON_EXTRACT`, `JSON_OBJECT`, `COALESCE(JSON,…)` in `applyPaidOrderSideEffects` / `recoverIncompletePaidOrders` | Supported by TiDB; behaviour of JSON-vs-integer comparison (`recoveryAttempts < 5`) must be confirmed on staging. |
| `DROP COLUMN/INDEX IF EXISTS` in `down()` | `migrateInternationalAddresses.js`, `migrateInternationalOrders.js` | **Fixed (M-5):** replaced with `information_schema` checks, valid on MySQL 8 and TiDB. Verified on MySQL only. |
| `INSERT IGNORE` + unique keys, `ON DUPLICATE KEY UPDATE` | ledger, revenue, wallets | Supported. |

## 4. Verification queries (run after migrating)

```sql
-- new columns present
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME='orders' AND COLUMN_NAME='paymentSideEffects')
     OR (TABLE_NAME='platform_revenue' AND COLUMN_NAME IN ('grossAmount','discountAmount'))
     OR (TABLE_NAME='user_addresses' AND COLUMN_NAME IN ('addressLine3','province','countryCode')));
-- expect 6 rows

-- uniqueness that the code relies on
SELECT INDEX_NAME FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN ('uq_custom_requests_orderId','uq_fe_dedupe','uq_orders_paymentReference');

-- existing paid orders must be untracked (recovery never touches them)
SELECT COUNT(*) FROM orders WHERE paymentStatus='paid' AND paymentSideEffects IS NOT NULL
  AND created_at < '<deploy timestamp>';   -- expect 0

-- FX table must hold OPERATOR rates, not the seed (see D-4)
SELECT baseCurrency, targetCurrency, rate, source, effectiveDate FROM exchange_rates ORDER BY baseCurrency;

-- payout lifecycle (migration 30)
SELECT COLUMN_TYPE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='payout_attempts' AND COLUMN_NAME='status';  -- includes 'reconciliation_required'
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='payout_attempts'
   AND COLUMN_NAME IN ('currency','amountMinor','withdrawalId','initiatedAt','initiateHttpStatus','providerStatus','checkCount',
                       'lastCheckedAt','reviewReason','alertedReason','alertedAt','resolutionNote','resolvedBy','resolvedAt'); -- expect 14
SELECT INDEX_NAME FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN ('idx_payout_lifecycle','idx_payout_withdrawal','uq_vendor_withdrawal_request');
-- attempts already in flight at deploy time (they are reconciled by the new code; note the count)
SELECT status, COUNT(*) FROM payout_attempts GROUP BY status;

-- every approved vendor can ship domestically
SELECT COUNT(*) FROM vendors v WHERE v.status='approved'
  AND NOT EXISTS (SELECT 1 FROM vendor_shipping_destinations d WHERE d.vendorId=v.userId AND d.countryCode='GH');  -- expect 0
```

## 5. Backup, rollback, forward recovery

- **Before**: encrypted backup (`npm run db:backup --prefix backend`, `.deploy/backup-db.sh`) and a TiDB Cloud point-in-time snapshot; record the timestamp.
- **Rollback of code** is safe without rolling back schema: all changes are additive; the old backend ignores the new columns/tables.
- **Schema rollback** is not recommended (drops data written since). If unavoidable: `ALTER TABLE orders DROP COLUMN paymentSideEffects` etc. — only after the old backend is serving, and only from a reviewed script. The `down()` functions of migrations 26 and 27 now run on MySQL 8 (M-5) and drop **international currency/address data** written since deploy — never run them on production without a backup and an explicit owner decision.
- **Forward recovery** for a statement that failed silently: re-run the single migration script (all are idempotent) after fixing the cause; verify with §4.

## 6. Test evidence

| Run | Command (disposable DB) | Result |
|---|---|---|
| Fresh install | `DB_NAME=rc_fresh npm run db:setup` | exit 0; only M-4 noise |
| Fresh install suite | `DB_NAME=rc_fresh npm test` | **740/740**, exit 0 (748/748 after SEC-4, 2026-10-12) |
| Upgrade path (DB migrated by the baseline chain, then fixed scripts re-run) | `npm run db:migrate` then `npm test` ×3 | exit 0; **740/740** each run (748/748 after SEC-4) |
| Idempotency | migrations 26 and 28 run twice | second run reports "already exists", no change |
| **Continuation 2026-10-12** — new disposable MySQL 8.4.11 on `127.0.0.1:33111` | baseline fresh install, then after TIDB-1/M-5 and the other fixes: `npm run db:migrate` on the upgraded DB + `npm test`; `DB_NAME=rc_fresh npm run db:setup` + `npm test` | baseline 748/748; final **765/765** on both; only M-4 noise in setup output; `countryCode` = `VIRTUAL GENERATED` on fresh install |
| Rollback scripts (M-5) | `node migrateInternationalAddresses.js down|up`, `node migrateInternationalOrders.js down|up` on scratch copies (`rc_mig`) | up/up/down/down/up all exit 0; columns + index removed and re-added |

## 7. Migration 30 — payout lifecycle (R-8, 2026-10-12)

- **Why:** the redesigned settlement needs a terminal-for-automation state
  (`reconciliation_required`), provider evidence (`amountMinor`, `currency`, `initiatedAt`,
  `initiateHttpStatus`, `providerStatus`), rotation and alert dedupe (`lastCheckedAt`,
  `checkCount`, `alertedReason/At`), operator notes, and a stable withdrawal identity with
  an idempotency key (`vendor_withdrawals`). See `PAYOUT_LIFECYCLE_DESIGN.md`.
- **Ordering:** must run **before** the new backend serves traffic. The new claim inserts
  `amountMinor/currency/withdrawalId`, and the reconciler orders by `lastCheckedAt`. If the
  old backend runs against the migrated schema, that's fine: all additions are
  nullable/defaulted, and the old code never writes the new enum value.
- **Existing rows:** in-flight `processing` attempts created by the old code have
  `initiatedAt` NULL. If Paystack later says "not found", they are released after the 60-min
  grace exactly as before. If Paystack has them, they settle normally. That's the old
  behaviour, now with alerts.
- **Rollback:** code rollback is safe while no attempt is `reconciliation_required` (the old
  code would not understand it). Check `SELECT COUNT(*) FROM payout_attempts WHERE
  status='reconciliation_required'` before rolling back code. Schema rollback is not
  recommended (`vendor_withdrawals` is audit history).
- **TiDB:** appending an ENUM member via `MODIFY COLUMN` and `SELECT … FOR UPDATE` (pessimistic
  mode) are expected to be supported, but this is **unverified** and a staging gate.
- **Evidence (disposable MySQL 8.4.11 only):** run twice on the upgraded DB (second run:
  everything "already exists", exit 0). Fresh install (`DB_NAME=rc_r8 npm run db:setup`)
  exit 0. A reachable DB without the schema makes `payoutLifecycle.test.js` fail loudly
  rather than skip.

## 8. Migration 31 — reconciliation_checks (FV-6/FV-7, 2026-10-12) and FV-8 data writes

- **Why:** durable per-order state for the stale-refund-claim and stuck-pending jobs:
  rotation/back-off (`lastCheckedAt`, `nextCheckAt`, `checkCount`), a queryable review list
  (`state`, `reviewReason`, `detail`), and alert dedupe (`alertedReason`, `alertedAt`). A
  separate table avoids an `ALTER` on the large `orders` table.
- **Locks / downtime:** `CREATE TABLE IF NOT EXISTS` only. No downtime. Safe to run before
  or after the code; the code tolerates the table's absence (legacy scan + logged warning).
- **Growth:** one row per order these jobs examine (the stuck-pending window is 7 days). No
  automatic pruning yet; `resolved` rows older than 90 days can be deleted safely
  (follow-up).
- **FV-8 needs no DDL:** `platform_revenue.source` already allows `'refund'`, and
  `uq_platform_revenue_order_source (orderId, source)` makes the reversal idempotent. **Data
  effect on first production run:** the new hourly `reconcileRefundedPlatformRevenue` job
  backfills a negated `refund` row for every *historical* refunded order that has a
  `platform_product` row, at most 100 per run. Nothing reads the table today (per FV-8), so
  no report changes, but note the backfill before building revenue reports.
- **Verification:**
  ```sql
  SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reconciliation_checks'; -- 1
  SELECT job, state, COUNT(*) FROM reconciliation_checks GROUP BY job, state;
  -- refunded orders still missing a revenue reversal (should trend to 0 after deploy)
  SELECT COUNT(*) FROM platform_revenue pr JOIN orders o ON o.id = pr.orderId
   WHERE pr.source = 'platform_product' AND o.paymentStatus = 'refunded'
     AND NOT EXISTS (SELECT 1 FROM platform_revenue r WHERE r.orderId = pr.orderId AND r.source = 'refund');
  ```
- **Evidence (disposable MySQL 8.4.11 only):** run twice (idempotent). Upgrade path and fresh
  install (`DB_NAME=rc_p5 npm run db:setup`) both exit 0, followed by **822/822** tests each.
  **TiDB unverified.** Check the `LEFT JOIN … ORDER BY (rc.lastCheckedAt IS NOT NULL) ASC,
  rc.lastCheckedAt ASC` selection plans on staging.
