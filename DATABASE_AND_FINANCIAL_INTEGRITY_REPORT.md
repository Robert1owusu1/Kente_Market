# Database and Financial Integrity Report — Kente Market

Local validation, 2026-10-12 (session `fe49cfc1`). Engine: **MySQL 8.4.11** (disposable). Production engine is
**TiDB Cloud — compatibility UNVERIFIED** (no TiDB available locally; see §6). Commands and isolation are as in
`LOCAL_SYSTEM_TEST_REPORT.md`. Migration-level history: `DATABASE_MIGRATION_REVIEW.md` (preserved).

## 1. Schema and migrations

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Fresh DB can be created and migrated | `db:setup` (setupDB.js loads `branding_house.sql`, then the 32-script `db:migrate` chain) into `km_p3`: exit 0 | Verified |
| 2 | Migrations run in documented order | order = `backend/package.json` `db:migrate`; `migrationPortability.test.js` checks every script exists and (new) that `migrateMarketplace` only indexes tables created earlier | Verified |
| 3 | Tables/indexes/FKs/constraints | 60 tables, 228 indexes, 55 FKs, 1 CHECK; money-critical uniques: `uq_fe_dedupe`, `uq_webhook_event_ref`, `uq_escrow_order_vendor_type`, `uq_orders_paymentReference`, `uq_orders_refundReference`, `uq_payout_attempt_reference`/`_provider_reference`, `uq_platform_revenue_order_source`, `uq_referral_commission_order`, `uq_referral_ledger_dedupe`, `uq_referral_withdrawal_ref`/`_idem`, `uq_vendor_withdrawal_request`, `uq_wallet_withdrawal_reference`, `uq_custom_requests_orderId` | Verified (MySQL) |
| 4 | Second run is safe | `db:migrate` again → `mysqldump --no-data` **identical** | Verified |
| 5 | Failed migration not reported as success | `migrationFailureExit.test.js` (fails on the old code); runtime chain is `&&` so the first non-zero exit stops it | Verified for the two international scripts. **Residual (MIG-2, Low, open):** other scripts still log-and-continue on some statement errors by design (header of `migrationPortability.test.js`); every `Could not` line in a staging/production log must be explained (runbooks require this) |
| — | Upgraded vs fresh schema | A DB upgraded under the **old** `migrateMarketplace.js` carries 3 redundant indexes (`financial_events.idx_financial_dedupe`, `.idx_financial_order`, `scheduler_job_status.idx_scheduler_job_name`) that duplicate existing ones. Harmless; production may have them | Documented (optional manual drop after review) |

## 2. Financial invariants (requirements 6–15)

| # | Invariant | Evidence (tests run in this pass unless marked) | Status |
|---|---|---|---|
| 6 | Transactions roll back on failure | `refundDoubleSpend`, `payoutLifecycle` 7 (crash after reservation), `paidSideEffects` mutation checks; DB-outage live probe | Verified |
| 7 | Concurrency cannot duplicate money records | 4 concurrent + replayed `charge.success` (live) → 1 flip/1 allocation/1 commission; `withdrawalConcurrency`, `finalVerificationRaces`, `referralSystem` (concurrent withdrawals, 10 concurrent workers) | Verified |
| 8 | Totals computed server-side | live J1 (client `price: 0.01`, `totalAmount: 0.01`, `discount: 9999` ignored); `couponBounds`, `internationalCheckoutUnified` | Verified |
| 9 | Referral only for verified paid orders | `referralSystem` 3+4+5+15 (abandoned/failed/pending/cancelled → none); live F1 | Verified |
| 10 | Duplicate payment events → no duplicate commission | `referralSystem` 7+8+9; live B1/C5 | Verified |
| 11 | Refunds reverse allocations | `escrowCancellationRefund` 1–4, `partialRefunds`, `referralSystem` 13/13b/14, `recoveryFairness` FV-8 | Verified within the rules in §4 |
| 12 | Cancelled/refunded/unpaid cannot release escrow | `escrowCancellationRefund` 6–9, `rb02-escrow-retry` | Verified |
| 13 | Withdrawals cannot reserve/pay twice | `withdrawalConcurrency`, `payoutLifecycle` 12, `referralSystem` concurrent-withdrawal test; live H1 | Verified |
| 14 | No release on timeout/ambiguous provider reply | `payoutLifecycle` 13/17, 16b; `referralSystem` 18+20; live H2 (unreachable → stays `processing`) | Verified |
| 15 | Revenue/earnings/referral/discount/tax/shipping/fees reconcile | `commissionEngine` (28), `couponBounds`, FV-8 revenue reversal; Paystack fees are **not** modelled in the ledger (charged amount = order total) | Verified for modelled items; **fees: not modelled** (see §5) |

## 3. Refund and recovery scenarios (Phase 4)

| Scenario | Behaviour (from code + test) | Test | Result |
|---|---|---|---|
| Full refund | Claim `orders.refundReference` (CAS from NULL) → Paystack refund → order `refunded`/`cancelled`; held allocations → `failed`; `available` → clawed back from wallet; revenue reversed; referral adjusted; one `refund:<orderId>` journal | `escrowCancellationRefund` 1–4, `refundDoubleSpend`, FV-8 | pass |
| Partial refund | Per-vendor only: amount must equal that vendor's lines **after discount** (FV-3); only that vendor's allocation voided/clawed back; `refundedAmount` incremented (cannot exceed total); referral reduced proportionally | `partialRefunds` 3/3, `referralSystem` 14, `payoutLifecycle` 10f | pass |
| Refund failure (definite) | Provider 4xx → claim released, order unchanged, admin told (R-5 `refundOutcome`) | `returnRefundOutcome`, `paymentRecovery` 5; live G1 (unreachable → 500, not cancelled) | pass |
| Refund failure (after acceptance, **async**) | **Was a gap (REF-ASYNC):** `refund.failed` webhook was ignored. Now journaled (`refund.failed`, direction `info`) and admins alerted once; no automatic state change | `refundLifecycle` 1–2; live G2–G4 | **fixed this pass** |
| Refund retry | Unknown outcome keeps the claim; `reconcileStaleRefundClaims` reads provider state: finalize / wait / re-issue once if provably never issued / alert | `paymentRecovery` 1a–1d, 3–6 | pass |
| Duplicate refund notification | `(event, reference)` unique receipt; duplicate → "Duplicate ignored" | `refundLifecycle` 1; live G2 | pass |
| Refund after referral commission created (pending) | Commission reduced/cancelled; wallet untouched | `referralSystem` "refund while pending" | pass |
| Refund after referral commission **paid** (available, then withdrawn) | One reversal into wallet **debt** (balance −40); completed payout not rewritten; debt blocks withdrawal; next commission offsets it | `referralSystem` 13, **13b (new)** | pass |
| Refund after seller allocation `available` | Clawed back from the vendor wallet (conditional debit); insufficient balance → `manual recovery needed` | `escrowCancellationRefund` 2, 14 | pass |
| Refund after seller allocation **released** (paid out) | Not clawed back (no rule exists — R-6). **Was silent (REF-RELEASED)**; now `reconciliation_checks` `needs_review` + one admin alert | `refundLifecycle` 3 | **fixed this pass (visibility only)** |
| Refund while payout in flight (`releasing`) | If the transfer then fails/reverses, money is clawed back, not re-opened (INT-1) | `payoutLifecycle` 10c, 10e, 10f | pass |
| Cancellation while refund in progress | Second path sees the claim → 409; concurrent cancels refund once | `escrowCancellationRefund` "concurrent duplicate cancel", `refundDoubleSpend` | pass |
| Failed recovery job, then retry | Job failure recorded in `scheduler_job_status` + alert; next run converges idempotently | `paymentRecovery` 5–6, `recoveryFairness`, `paidSideEffects` | pass |
| Paid order with incomplete post-payment work | `recoverIncompletePaidOrders` completes missing markers exactly once (stock, journal, revenue, escrow, referral) | `paidSideEffects` 8/8, `paymentLifecycleRecovery` | pass |
| Uncertain payout | Reserved funds stay reserved; reconciler verifies; 404 after provider ack → review, never re-sent | `payoutLifecycle` 7, 13/17, 16b; `referralSystem` 18+20 | pass |

## 4. Business decisions still open (no policy invented)

| ID | Implementation today | Possible impact | Decision needed | Tests depending on it |
|---|---|---|---|---|
| **FV-9** | Partial refund = vendor's lines after discount; **tax and shipping are never refunded** on a partial | Customer under-refunded by the tax/shipping share on partial returns; platform keeps it | Should partial refunds include a pro-rata share of tax and/or shipping? | `partialRefunds`, `referralSystem` 14 (amounts) |
| **R-6** | Return approval voids/claws back vendor escrow **before** the refund is issued; if the refund then fails, vendor is debited and customer not yet refunded (admin warned). Allocations already **released** are never recovered automatically (now flagged) | Vendor debited for an unrefunded customer, or platform absorbs payouts on post-release refunds | (a) Ordering: debit vendor before or after refund success? (b) Post-release refunds: recover from vendor (negative balance / offset) or platform absorbs? | `escrowCancellationRefund` 2, 14; `refundLifecycle` 3 |
| **R-7** | One refund claim per order **forever**: after a successful partial refund the claim is kept, so no second partial or full refund can be issued through the app | Multi-vendor orders with returns from >1 vendor need manual Paystack refunds outside the ledger | Allow multiple refunds per order (cumulative cap = total)? | `partialRefunds`, `refundDoubleSpend` |
| REF-ASYNC follow-up | `refund.failed` alerts only; order stays `refunded` | Books show a refund that did not happen until an admin acts | Should a provider-failed refund re-open the order / re-queue the refund automatically? | `refundLifecycle` 1 |
| Fees | Paystack fees are not recorded; platform revenue = commission + platform lines | Revenue overstated by provider fees | Record fees in the ledger? | none |

## 5. Known gaps (not defects in the tested rules)

- Paystack processing fees are not in `financial_events` (§4 Fees).
- `vendor_wallets` vs `wallet_transactions` reconciliation query in the staging runbook §4 is indicative only.

## 6. TiDB

All results above are **MySQL 8.4** results. Static guards cover known TiDB incompatibilities (no `ALTER … ADD`
STORED generated columns, no MariaDB `IF [NOT] EXISTS` DDL). Untested on TiDB: FK enforcement (TiDB ≥ 6.6 only),
`SELECT … FOR UPDATE` lock semantics under the concurrency tests, `INSERT IGNORE` + unique-key dedupe, JSON
functions in the recovery queries, deadlock/lock-wait behaviour (the REF wallet fix relies on InnoDB S→X lock
upgrade semantics). **Status: UNVERIFIED** — run `STAGING_VALIDATION_RUNBOOK.md` §1, §9 on a dedicated staging TiDB.
