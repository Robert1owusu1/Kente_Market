# Payout Reconciliation Runbook — finding and resolving stuck vendor payouts

For operators and admins. Design background: `PAYOUT_LIFECYCLE_DESIGN.md`.
**Golden rule: never send a payout again while the original transfer could still succeed.**
A timeout, a 5xx, or an old attempt is *not* evidence of failure. Only Paystack's own answer
is: a signed webhook, `transfer/verify`, or the dashboard.

## 1. How you find out

| Signal | Where |
|---|---|
| In-app admin notification "Vendor payout needs attention" (one per attempt and reason; repeats at most every 24 h) | admin notifications |
| In-app admin notification "Vendor wallet out of balance" (at most once per vendor per day) | admin notifications |
| Logs: `PAYOUT RECONCILIATION REQUIRED`, `Transfer reconciliation failed`, `Escrow payout failed` | log drain / Sentry |
| Admin dashboard → **Payouts** (`/admin?section=payouts`; alert links open it) | admin UI — list, detail, Verify with Paystack, notes, action history |
| `GET /api/admin/payouts/unresolved` | admin API (admin session required) |
| `GET /api/admin/ops/reconciliation-reviews?job=staleRefundClaim\|stuckPending` | durable list of **refund/payment** recovery items that need a human (FV-6/FV-7; not payouts) |
| `scheduler_job_status` row `reconcileStuckTransfers` = `failed` | DB / `GET /api/admin/ops/scheduler-jobs` |

The SQL equivalent of the unresolved list (read-only):

```sql
SELECT id, vendorId, amount, currency, reference, status, providerStatus, initiatedAt,
       initiateHttpStatus, lastError, checkCount, lastCheckedAt, reviewReason,
       TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS ageMinutes
  FROM payout_attempts
 WHERE status = 'reconciliation_required'
    OR (status = 'processing' AND created_at < NOW() - INTERVAL 30 MINUTE)
 ORDER BY (status = 'reconciliation_required') DESC, created_at;
```

## 2. Read the state correctly

| `status` | Meaning | Money | What automation does |
|---|---|---|---|
| `processing`, `initiatedAt` set | Paystack accepted the request; final outcome not known yet | reserved (not withdrawable, not debited) | webhook or reconciler settles it |
| `processing`, `initiatedAt` NULL, `lastError` set | our call got no confirmation (timeout/network/5xx/4xx). **Outcome unknown** | reserved | reconciler verifies; releases only if Paystack says the transfer does not exist after the grace period (60 min; 10 min after a 4xx) |
| `processing`, `providerStatus` = `otp` / `abandoned` / `blocked` / `rejected` | Paystack needs action from us | reserved | alert; keeps checking |
| `reconciliation_required` | automation stopped on purpose (see `reviewReason`) | reserved | **nothing** — needs a human |
| `succeeded` / `failed` / `reversed` | final | settled / restored / restored | nothing |

## 3. Procedure per case

Always start with `GET /api/admin/payouts/:id`. It shows the attempt, allocation, journal and
the vendor consistency check. Then look the reference up in the **Paystack dashboard →
Transfers**.

**A. `processing`, waiting.** Usually nothing to do. To speed it up, use
`POST /api/admin/payouts/:id/reconcile`. It asks Paystack and applies only what Paystack
confirms. It is safe to repeat and never sends money.

**B. Paystack unreachable for a long time** (`lastError` shows HTTP 5xx/timeouts, alert
`provider_unreachable`). Check Paystack status and our `PAYSTACK_SECRET_KEY`. Do not touch the
row. Once Paystack answers again, the reconciler or (A) settles it.

**C. `otp`.** The transfer waits for OTP finalisation. Either finalise it in the Paystack
dashboard or disable transfer OTP for the integration (business owner decision). The webhook
then settles it. Do not create a new transfer.

**D. `abandoned` / `blocked` / `rejected`.** Paystack has not paid, but these statuses are not
documented to us as final failures. Confirm in the dashboard and with Paystack support that no
money moved. If Paystack later reports `failed`, the reconciler restores automatically. If it
never does, treat the attempt as case F with that evidence.

**E. Vendor wallet out of balance.** The alert shows wallet vs withdrawable + in-flight. Do
not approve further payouts for that vendor until it is explained. Compare
`wallet_transactions` (credit / withdrawal / clawback / reversal) with `escrow_allocations` and
`payout_attempts`. Historical data from before the redesign may account for differences;
document what you find with `POST /api/admin/payouts/:id/note`.

**F. `reconciliation_required`.** Read `reviewReason`:

| reviewReason | Cause | Resolution (manual, two-person) |
|---|---|---|
| `amount_mismatch` / `currency_mismatch` | Paystack's amount/currency for this reference differs from what we reserved | Escalate to engineering. Never "fix" the number. Establish what Paystack actually paid from the dashboard |
| `confirmed_success_unbookable` | Paystack **paid**, but the vendor wallet holds less than the amount (ledger inconsistency) | The vendor has been paid. Find why the wallet is short (case E). Book the withdrawal with a reviewed SQL script once explained |
| `provider_not_found_after_ack` | Paystack acknowledged the transfer earlier, but verify now says it does not exist | Ask Paystack support for the transfer by reference/transfer code. Until they answer, the money stays reserved |
| `clawback_insufficient_balance` | A failed payout on a refunded order could not be clawed back (wallet already short) | Case E |
| `allocation_missing` / `allocation_state_*` | The allocation row is missing or in an unexpected state | Escalate to engineering |

**Re-verify first (allowed for any reason).** In the Payouts page, open the attempt, tick the
acknowledgement and write what you checked. Then press **Verify with Paystack**
(`POST /api/admin/payouts/:id/reconcile` with `acknowledge: true` and a `note`).
- Money moves only if Paystack now confirms an outcome that passes every check.
- `amount_mismatch` / `currency_mismatch` stay parked by design.
- A "not found" never releases a parked payout.

Use this after fixing a transient cause, e.g. a corrected wallet shortfall
(`confirmed_success_unbookable`), or once Paystack support has resolved a
`provider_not_found_after_ack`.

Only when re-verification cannot apply provider-confirmed evidence: manual resolution is a
**reviewed SQL change in one transaction**, prepared by one person and
checked by a second, after a backup. It must keep §4's equation true and add a
`financial_events` row describing the correction. Record the evidence (Paystack screenshot or
reference, ticket) with `POST /api/admin/payouts/:id/note` before and after. The API
deliberately offers no "force paid", "force failed" or "retry transfer".

## 4. Invariant to check after any manual action

```sql
-- must return no rows
SELECT w.vendorId, w.available_balance,
       (SELECT COALESCE(SUM(ea.payoutAmount),0) FROM escrow_allocations ea
         WHERE ea.vendorId = w.vendorId AND ea.status IN ('available','releasing','released')
           AND EXISTS (SELECT 1 FROM wallet_transactions t WHERE t.type='credit' AND t.allocationId=ea.id)) AS withdrawable,
       (SELECT COALESCE(SUM(pa.amount),0) FROM payout_attempts pa
         WHERE pa.vendorId = w.vendorId AND pa.status IN ('processing','reconciliation_required')) AS in_flight
  FROM vendor_wallets w
HAVING ROUND(available_balance,2) <> ROUND(withdrawable + in_flight,2);
```

Historical rows from before the redesign (legacy auto-transfers, pre-wallet payouts) may
appear here. Investigate them once and document them; do not "correct" them blindly.

## 5. What never to do

- Re-send a transfer for an attempt whose outcome is unknown.
- Set `status='failed'` by hand because an attempt is old.
- Credit a wallet to "unstick" a vendor without a matching ledger row and evidence.
- Delete `payout_attempts`, `wallet_transactions` or `financial_events` rows.

## 6. Refund / payment recovery items needing a human (FV-6, FV-7)

`GET /api/admin/ops/reconciliation-reviews` (admin) lists them. The data is in table
`reconciliation_checks`: `job`, `entityId` = order id, `state = needs_review`,
`reviewReason`, `detail`, first seen, last checked.

| job / reason | Meaning | Action |
|---|---|---|
| `staleRefundClaim` / `charge_not_confirmed`, `unusable_reference`, `unrecognized_claim` | a late-charge refund claim whose charge Paystack does not confirm | verify in the dashboard; clear `orders.refundReference` if no refund is due |
| `staleRefundClaim` / `partial_refund_on_full_claim`, `refund_not_completed`, `refund_state_ambiguous`, `recovered_refund_refused`, `recovered_refund_rejected` | a refund exists but is incomplete or ambiguous | finish it in the Paystack dashboard; **never** re-issue blindly |
| `stuckPending` / `charge_amount_mismatch` | Paystack confirms a successful charge that does not match its order; the order was **not** marked paid | refund or correct the charge in the dashboard |
| `stuckPending` / `invalid_reference` | the order's payment reference cannot be queried safely | investigate the order |

The jobs re-check these items every 6 h, so a fix made in the Paystack dashboard is picked
up automatically. Alerts repeat at most once per item and reason per 24 h.
