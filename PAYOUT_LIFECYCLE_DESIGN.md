# Vendor Payout Lifecycle — Design (R-8 redesign)

Status: implemented locally and tested on a disposable MySQL 8.4 database (2026-10-12).
**Not** validated on TiDB or against Paystack test mode. Nothing here was committed,
deployed, or run against a shared database, and no real transfer was initiated.

## 1. How vendor money actually moves (verified against the code)

| Step | Code | Storage |
|---|---|---|
| Customer pays; order flips to `paid` | `paymentRoutes` webhook / verify, `applyPaidOrderSideEffects` | `orders` |
| Allocation per vendor (commission fixed here) | `escrowService.createEscrowAllocations` | `escrow_allocations` (`amount`, `platformFee`, `payoutAmount`, `status='held'`) |
| Delivery confirmed / auto-release | `releaseAllocation` (held → available) + `walletService.creditVendorBalance` | allocation `available`; `wallet_transactions` `credit` (unique per allocation); `vendor_wallets.available_balance += payout` |
| Vendor withdraws | `POST /api/vendors/withdraw` → `vendorController.withdrawVendorBalance` → `escrowService.payoutAllocation` per allocation | **reservation** = `escrow_allocations.payoutAmount -= amount`; one `payout_attempts` row (`processing`) with a unique `reference` — both committed **before** the provider call |
| Provider call | `paystackServices.initiateTransfer(amount, recipient, reason, reference)` | Paystack `POST /transfer` with our reference |
| Outcome | signed `transfer.success / failed / reversed` webhooks (`paymentRoutes`) **and** `transferReconciliationService.reconcileStuckTransfers` (Paystack `GET /transfer/verify/:reference`) → `transferSettlementService.settleTransfer*` | attempt terminal status; wallet `withdrawal` debit (unique per reference) on success; allocation restore on failure/reversal; `financial_events` journal (unique `dedupeKey`) |
| Refund / return after release | `escrowService.voidEscrowForOrder / voidVendorEscrow` → `clawbackAvailableAllocation` | allocation `available` → `failed`; wallet `clawback` of the **remaining** `payoutAmount` only |

Two balances exist and must agree (invariant I-15):
`vendor_wallets.available_balance` (debited only when a transfer is **confirmed**) and the
per-allocation remainder `escrow_allocations.payoutAmount` (decremented when a withdrawal
**reserves** funds). For every vendor:

```
wallet.available_balance
  = Σ payoutAmount of credited allocations in available/releasing/released
  + Σ amount of payout_attempts in processing / reconciliation_required
```

`reconciliation_required` attempts still hold their reservation, so their amounts belong in
the in-flight term. "Withdrawable now" is `Σ payoutAmount` of `available` allocations whose
order is not cancelled/refunded. It is **not** the wallet balance, which also contains
in-flight money.

## 2. Root cause of R-8 (verified, and wider than first reported)

Before the redesign, settlement chose how to return a failed/reversed attempt's money from
the attempt's `isFull` flag. It required the allocation to still be in the state that the
claim had left it in:

- full attempt → restore only `WHERE status = 'releasing'`
- partial attempt → restore only `WHERE status = 'available'`

Anything else made it **throw**, roll back the whole settlement (including the attempt
claim), and answer the webhook with 500. The attempt stayed `processing`, so Paystack
redelivered, the reconciler retried every 30 minutes, and it failed the same way forever.
No admin was alerted. Reachable sequences:

1. Partial withdrawal A (allocation stays `available`) → withdrawal B takes the remainder
   (allocation `releasing`) → A fails. **Stuck** (the original R-8 report).
2. Same, but B succeeds first (allocation `released`) → A fails or is reversed. **Stuck.**
3. Partial A in flight → the order is refunded/returned, so the remainder is clawed back
   (allocation `failed`) → A fails. **Stuck.** (Not in the original report.)
4. Two concurrent withdrawals both read the allocation as 100. Each computed "full" from
   the stale read, so both were recorded as partial: the allocation ended `available` with
   0 and never became `released`.
5. Success settlement throws "Insufficient available balance" if the wallet ever holds less
   than the attempt. That would have stuck a **provider-confirmed** payout the same way.

No money was lost or paid twice: the reservation stayed in the attempt. But it could never
settle, and nobody was told.

The reconciler had related gaps:
- It scanned the 25 **oldest** `processing` rows. 25 permanently-stuck rows starved every
  newer one.
- It ignored non-terminal provider states (`pending`, `otp`, …) forever.
- It never alerted.
- It treated a provider 404 after 1 h as "never sent" even when our own initiate call had
  received a success acknowledgement.

Webhook settlement did not compare the provider's amount/currency with the reservation.

## 3. Financial invariants

| # | Invariant | Enforced by |
|---|---|---|
| I-1 | Withdraw ≤ eligible remainder (not the wallet total) | Claim runs under `SELECT … FOR UPDATE` on the allocation; checks `status='available'`, `payoutAmount ≥ amount`, order not cancelled/refunded |
| I-2 | Stable internal identity | `vendor_withdrawals.id` per request (new); `payout_attempts.reference` per transfer (unique); attempt → `withdrawalId`, `allocationId`, `vendorId` |
| I-3 | Transfer ↔ withdrawal ↔ vendor | the reference is generated and stored before the call, and sent to Paystack as the transfer reference |
| I-4 | Client cannot alter amount/currency | Amount parsed strictly to integer pesewas (≤ 2 dp, finite, > 0); currency must be absent or `GHS`; the provider amount is snapshotted as `amountMinor` |
| I-5 | No double reservation | Row lock + conditional decrement; tested with up to 10 parallel requests |
| I-6 | Settle/credit/restore at most once | Attempt claim `WHERE status='processing'` in the same transaction as every money effect; unique ledger keys (`wallet_transactions (type, reference)`, `financial_events.dedupeKey`) |
| I-7 | Timeout ≠ failure | Initiate errors never release funds; only provider evidence does |
| I-8 | No return to available while the transfer might succeed | Restore only on `failed`/`reversed` from a signed webhook or a verify call, or "transfer not found" from verify **and** no acknowledgement of our initiate call (§5) |
| I-9 | A confirmed success is never treated as failed | A success that cannot be booked goes to `reconciliation_required` (with alert), never to failed/restored |
| I-10 | Failure restores exactly the reserved amount, once | Restores `attempt.amount` under the attempt claim |
| I-11 | A partial withdrawal cannot strand other funds | Restore target no longer depends on allocation state (§4.3) |
| I-12 | Unresolved payouts stay discoverable | `processing` / `reconciliation_required` are indexed, listed by the admin API, and scanned in rotation |
| I-13 | Admins alerted when action is needed | Deduplicated per attempt and reason (`alertedReason`, re-alert ≥ 24 h) |
| I-14 | Reconciliation never re-issues a transfer | The reconciler and admin actions only call **verify**; there is no code path that re-initiates an existing attempt |
| I-15 | Wallet = ledger (§1 equation) | Checked per vendor after reconciler settlements and in the admin detail view; mismatch → alert |
| I-16 | Admin recovery keeps the audit trail | Admin actions are verify-only or add a note; every action goes to `admin_audit_log`; no "force paid" / "retry transfer" |
| I-17 | Currency/minor units consistent | GHS only (Paystack charging/transfer currency in this codebase); provider amount (pesewas) and currency must equal the attempt's, otherwise `reconciliation_required` |

## 4. State machine

### 4.1 `payout_attempts.status` (existing table, one row per provider transfer)

```
             claim (tx: lock alloc, decrement, insert)          provider success
 (none) ───────────────────────────────────────▶ processing ───────────────────▶ succeeded ──reversed──▶ reversed
                                                   │  │  ▲
                        provider failed/reversed,  │  │  │ (no automatic way back)
                        or verified "never sent"   │  │  │
                                     ┌─────────────┘  │  │
                                     ▼                │  │
                                   failed             │  │
                                                      ▼  │
                                         reconciliation_required  (terminal for automation;
                                           amount/currency mismatch, booking impossible,
                                           contradictory provider evidence)
```

| Transition | Trigger | Preconditions | Tx boundary / effects | Idempotency |
|---|---|---|---|---|
| → `processing` | vendor withdrawal | allocation `available`, remainder ≥ amount, order active, recipient present, amount/currency valid | one tx: `SELECT … FOR UPDATE` allocation; `payoutAmount -= amt`; status `releasing` if remainder → 0; insert attempt (`amountMinor`, `currency`, `withdrawalId`) | unique `reference`; duplicate requests deduplicated by `vendor_withdrawals (vendorId, requestKey)` |
| `processing` (ack) | `POST /transfer` answered | — | `initiatedAt`, `providerReference` recorded | none needed (no money effect) |
| `processing` (initiate error) | timeout / network / 5xx / 4xx | — | `lastError`, `initiateHttpStatus`; **reservation kept** | — |
| → `succeeded` | signed webhook or verify `success` | attempt `processing`; provider amount and currency equal the attempt's (when supplied) | one tx: claim attempt; wallet `withdrawal` debit; allocation status recomputed; journal | claim `WHERE status='processing'`; ledger unique keys |
| → `failed` | webhook/verify `failed`, or verify 404 when never acknowledged (§5) | as above | one tx: claim; restore (§4.3); journal; vendor notified | same |
| → `reversed` | webhook/verify `reversed` | attempt `processing` or `succeeded` | one tx: lock attempt; restore (§4.3); wallet `reversal` credit only if it was debited | lock + status check; `reversal` row unique per reference |
| → `reconciliation_required` | evidence mismatch; the wallet cannot absorb a confirmed debit; a restore target is not restorable; verify 404 after an acknowledged initiate | — | one tx: attempt status + `reviewReason`; **no money moves; reservation kept**; admin alert | claim `WHERE status='processing'` |

Prohibited: `failed` → anything; `succeeded` → `failed`; `reversed` → anything;
`reconciliation_required` → any status through automation (webhooks and the reconciler skip
it); re-initiating an existing reference with a new amount.

### 4.2 `escrow_allocations.status` for released money (existing)

`available` (remainder > 0) · `releasing` (remainder 0, ≥1 attempt still `processing`/review) ·
`released` (remainder 0, nothing in flight) · `failed` (voided/clawed back; never re-opened).
Settlement no longer *expects* a state. After every settlement it **recomputes** the state
from `payoutAmount` and the count of in-flight attempts, under the allocation row lock. A
`failed` allocation is never moved back.

### 4.3 Restoring a failed/reversed attempt (the R-8 fix)

Under the allocation row lock:

- allocation `available` / `releasing` / `released` → `payoutAmount += amount`, recompute
  status, clear `payoutReference` if it pointed at this attempt. The money is withdrawable
  again, whatever later withdrawals did.
- allocation `failed` (order refunded/returned; the remainder was already clawed back) →
  the returned money must **not** become withdrawable. That matches the existing
  refund policy: the vendor is not paid for a refunded order. For `failed` from
  `processing` the wallet still contains it (it was never debited), so it is clawed back:
  wallet `clawback` keyed `clawback:payout:<reference>`, journal `escrow.clawback`. For
  `reversed` after `succeeded` the wallet was already debited, so there is no reversal
  credit and no clawback (the net effect is the same).
- anything else (`pending`/`held`, missing row, wallet unable to absorb the clawback) →
  `reconciliation_required` + alert, no money moves.

## 5. Reconciliation (`reconcileStuckTransfers`, every 30 min, under the scheduler lock)

- **Selection:** `status='processing' AND created_at < now − 30 min`, ordered by
  `lastCheckedAt` (NULL first), `LIMIT 25`. Each pass rotates through the backlog, so
  nothing starves. It uses `idx_payout_lifecycle (status, lastCheckedAt)` and never scans
  history. `reconciliation_required` rows are excluded (they need a human).
- **Per attempt:** one `GET /transfer/verify/:reference`, sequentially, with a 15 s timeout
  (≤ 25 calls/run). Record `providerStatus`, `lastCheckedAt`, `checkCount += 1`.
  - `success` / `failed` / `reversed` → shared settlement with the provider amount and
    currency as evidence.
  - Any other status (`pending`, `otp`, `received`, `abandoned`, `blocked`, `rejected`, …)
    → no money moves; alert once the attempt is older than 24 h, or immediately for
    `otp`/`abandoned`/`blocked`/`rejected`, which need operator action at Paystack. These
    statuses are not documented as terminal failures, so funds stay reserved.
  - 404 "not found":
    - Our initiate was never acknowledged (`initiatedAt` NULL) and the attempt is older
      than 60 min (10 min when the initiate call itself got a 4xx answer, i.e. Paystack
      rejected it) → settle `failed` (restore).
    - Acknowledged → **contradictory**: `reconciliation_required` + alert.
  - Provider unreachable / 5xx / auth error → nothing changes; `lastError` recorded; alert
    once the attempt is older than 24 h. **Age alone never fails a payout.**
- The run returns a summary; per-attempt errors are counted and logged, never swallowed
  silently. The scheduler records the job status, and job-level failures alert through the
  existing `maybeAlertAdmins`.

## 6. Retry policy

No automatic re-initiation, ever (I-14). A vendor's next withdrawal claims *available*
funds under a *new* reference. Funds return to available only through §4.3. A failed
attempt's money can therefore be withdrawn again by a new request; a stuck or unknown
attempt's money cannot.

## 7. Manual recovery policy (admin)

Admin-only, audited (`/api/admin/payouts`):
- `GET /unresolved`: `processing` older than 30 min plus all `reconciliation_required`, with
  vendor id/business, amount, currency, age, status, provider status, last check,
  last error, review reason. No bank details.
- `GET /:id`: one attempt, its allocation and withdrawal, its journal rows, and the vendor
  wallet consistency check (I-15).
- `POST /:id/reconcile`: verify-only. The same code path as the scheduler for one
  `processing` attempt. It can only apply what Paystack confirms.
- `POST /:id/note`: records an investigation note (`resolutionNote`, `resolvedBy`) and an
  audit entry. It changes no money and no status.

Deliberately **not** provided: "force paid", "force failed", "retry transfer".

**Admin UI (2026-10-12):** Admin dashboard → **Payouts** (`/admin?section=payouts`, which is
also the link in every payout alert). It shows the list above, plus a detail panel with:
- the latest Paystack status, last check and last error;
- the wallet consistency banner;
- **Verify with Paystack** (the reconcile action), investigation notes, the per-attempt
  **action history** (from `admin_audit_log`, append-only) and the money journal.

Outcomes are labelled server-side (`severity` + `message`), so an unknown outcome is never
shown as a success.

### 7.1 Policy for `reconciliation_required` (implemented 2026-10-12)

1. **Who:** an `admin` account. The server enforces this (`protect` + `admin` on the router);
   vendors get 403 and anonymous callers 401.
2. **What:** *re-verify only*. `POST /:id/reconcile` on a parked attempt requires
   `acknowledge: true` and a justification note (10–1000 characters, no control characters)
   saying what was checked in the Paystack dashboard. It is recorded as
   `payout.review.reverify` in the audit log, with before/after state and the note.
3. **How money can move:** only through the normal settlement with **all** evidence and
   invariant checks. As a result:
   - an amount/currency mismatch stays parked;
   - a provider "not found" on a parked attempt never releases funds;
   - a transient cause settles once it is gone (for example a wallet shortfall corrected
     under the runbook, or Paystack later answering `success`/`failed`/`reversed`).
4. **What stays manual:** booking money **without** matching provider evidence (a genuine
   mismatch). That is the reviewed SQL procedure in the runbook. Whether it needs a second
   admin's approval is an **owner decision** (DEC-PAY-1); the system has a single `admin`
   role, so dual control is not enforceable in code today.

## 8. Withdrawal requests

`vendor_withdrawals` (new): one row per vendor request — `vendorId`, optional client
`requestKey` (unique per vendor), requested amount (pesewas), currency, `created_at`. It has
**no status column**; status is derived from its attempts, so no second state machine exists.
A repeated `requestKey` returns the original result (or 409 while the first is still
running) instead of reserving again. The vendor UI sends a fresh key per click. Older
clients without a key keep today's behaviour.

## 9. Business decisions recorded (not invented)

- Money from a failed transfer on a since-refunded order is clawed back, not re-credited
  (follows the existing void policy; R-6).
- Initiate-time 4xx answers are not treated as definitive failure by themselves (Paystack
  does not document that guarantee); they only shorten the 404 grace.
- **Staff withdrawals need `request_payouts` (SEC-11, fixed 2026-10-12).** `view_earnings`
  now only reads earnings and withdrawal history. Only the store **owner** can grant
  `request_payouts`: a staff manager cannot grant it to anyone, even while holding it.
  Owners always pass. Business impact: staff who withdrew under `view_earnings` lose that
  ability until the owner grants the new permission (communicate before deploying).
- **INT-1 (2026-10-12):** if the customer was refunded for a vendor's lines (full refund, or a
  partial refund journaled for that vendor) while that vendor's payout was in flight, the
  money returned by a failed/reversed transfer is clawed back. It is not restored to a
  withdrawable balance, and the allocation is closed (`failed`, "clawed back (refunded) —
  returned payout"). This is the same rule as §4.3's voided-allocation case.
