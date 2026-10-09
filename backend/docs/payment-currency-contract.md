# Payment & Currency Contract — Global Production

**Workstream:** `feature/global-production-payments`
**Integration target:** `feature/global-production`
**Status:** implemented and tested in isolation; depends on no unmerged branch.

This document is the agreed boundary between the payments workstream and the
checkout / shipping workstreams. It states what the platform actually does
today, what it deliberately does not do, and what each workstream may rely on.

---

## 1. Provider-supported assumptions found in the code

These are the assumptions the **existing code** makes. They are recorded here
because they were previously implicit in nine scattered string literals.

| Assumption | Where it lived | Evidence |
|---|---|---|
| Charges are initialized in GHS | `paystackservices.initializeTransaction` | `currency: 'GHS'` literal (now `CHARGED_CURRENCY`) |
| Tokenised re-charges are in GHS | `paystackservices.chargeAuthorization` | same |
| Transfer recipients are created in GHS | `paystackservices.createTransferRecipient` | same |
| Transfers are initiated in GHS | `paystackservices.initiateTransfer` | same |
| MoMo recipients are created in GHS | `paystackservices.createMomoRecipient` | same |
| Verification rejects any non-GHS charge | `paymentRoutes` (verify + webhook), `escrowService` (stuck-order recovery), `customRequestController` | `currency !== 'GHS'` in all four |
| The bank/telco list query accepts a country param | `getBankList(country='ghana')`, `getMobileMoneyTelcos(currency='GHS')` | read-only list endpoints, **not** charges |

**All five charge/transfer payloads and all four verification comparisons now
read from a single constant**, `CHARGED_CURRENCY` in
`backend/Services/paymentCurrency.js`.

### What this does NOT establish

- It does **not** establish that Paystack supports any currency other than GHS
  for this merchant account. Currency support is a property of the merchant's
  Paystack account and receiving bank, not of this repository.
- It does **not** establish that any payout method (card, bank transfer, MoMo)
  works outside Ghana.
- It does **not** establish settlement, FX, or multi-currency capability.

**No evidence of multi-currency support exists in this repository.** Enabling a
second currency requires provider-account configuration and an operational
approval that has **not** been obtained. Until then, `CHARGED_CURRENCY` is a
constant and any attempt to charge another unit is refused at verification.

---

## 2. The four currency roles — do not collapse these

| Role | Definition | Source today | Safe to change? |
|---|---|---|---|
| **1. Listing currency** | The unit a vendor means when they type a product price. | Free-form vendor input. **Never used for a charge.** | No — not validated against the charged currency. |
| **2. Display currency** | Cosmetic currency shown in the UI. | `currency` admin setting via `settingController.js` | Yes — presentation only. |
| **3. Charged currency** | The unit Paystack is asked to collect, and the unit verification compares against. | `CHARGED_CURRENCY` | **No** — requires provider config + approval. |
| **4. Settlement currency** | The unit a transfer recipient is created in, i.e. what a vendor can actually receive. | Hard-coded GHS in recipient creation | **No** — a recipient that cannot receive GHS fails at the provider. |

> **Trap for the checkout workstream:** the `currency` admin setting is role 2.
> It is **not** the charged currency and must never be fed into a charge or a
> verification comparison. Using it to size a Paystack payload would let an
> admin setting silently break payment verification.

> **Trap for the shipping workstream:** shipping and tax amounts are added to
> the charged total. Whatever unit they are computed in must be the **charged**
> currency. There is no conversion step anywhere in this pipeline.

---

## 3. Immutable financial snapshot

`financial_events` (`backend/migrateHardening.js`) is the append-only money
journal and is the home of the snapshot:

```
currency CHAR(3) NOT NULL DEFAULT 'GHS'
amount   DECIMAL(12,2) NOT NULL
providerReference VARCHAR(255)
payload  JSON            -- the provider snapshot
UNIQUE KEY uq_fe_dedupe (dedupeKey)
```

### What changed

Previously both `charge.collected` writes persisted a **label**, not evidence:

```js
payload: { event: 'charge.success' }             // webhook
payload: { event: 'verify-paystack fallback' }   // verify
```

Both now persist a **redacted provider snapshot** via `buildChargeSnapshot(tx, capturedBy)`:

```js
{ capturedBy, reference, status, currency, amountMinorUnits,
  channel, paidAt, createdAt, domain, gatewayResponse }
```

The snapshot records **the provider's own currency value**, not our constant —
so an anomaly is visible in the journal rather than papered over.

### Redaction is allowlist-only

`buildChargeSnapshot` copies an explicit allowlist and **drops everything
else**. This is what keeps out:

- `authorization` — card bin, last4, expiry, `signature`, `reusable` token
- `customer` — email, name, phone
- `meta`, `log`

This matters because `financial_events.payload` is append-only and effectively
permanent. Spreading the raw provider object would create a durable card/PII
leak that no later migration could reliably scrub. Asserted by test
**P-GP-3**, which greps the serialised snapshot for the fixture's card digits,
signature and email.

### Why there is deliberately no `orders.currency` column

The order's charged currency is discoverable through
`financial_events (orderId, currency)` with `idx_fe_order`, and that store is
**append-only**, whereas an `orders` column is mutable. Putting the currency
only in the journal means the record of what was actually charged cannot be
edited after the fact.

**Consequence for checkout/shipping:** if you need an order's charged currency,
join `financial_events` on `orderId` and `eventType = 'charge.collected'`.
Do **not** add a mutable currency column to `orders` — coordinate with the
payments workstream first if you believe you need one.

---

## 4. Verification — unchanged and still server-authoritative

`verifyChargeMatchesOrder(tx, expectedMinorUnits)` reproduces, in one place, the
comparison that previously existed as three independent literals:

| Check | Result |
|---|---|
| `currency !== CHARGED_CURRENCY` | reject, `reason: 'currency_mismatch'` |
| amount not parseable | reject, `reason: 'amount_unparseable'` |
| `paidMinorUnits !== expectedMinorUnits` | reject, `reason: 'amount_mismatch'` |

Behaviour is **byte-for-byte equivalent** to what it replaced:

- exact equality, **no tolerance band**, in either direction
- `expectedMinorUnits` always derives from the **server-side** order total,
  never from a client-supplied value
- the order is never marked paid before this check passes

Note a pre-existing asymmetry, **preserved deliberately**: the verify path
(`paymentRoutes`) omits the explicit `Number.isFinite(paidKobo)` guard that the
webhook and recovery paths have. It is still safe — `parseInt` of garbage
yields `NaN`, and `NaN !== expectedKobo` rejects. Flagged rather than
"fixed", because touching it is a behaviour change outside this workstream's
brief.

---

## 5. Idempotency — unchanged

The `dedupeKey` template `charge.collected:${reference}` is load-bearing.
`financial_events` has `UNIQUE(dedupeKey)`, so a redelivered webhook is a
no-op.

> ⚠️ **Do not edit this template.** If it changes, existing rows stop matching
> and the *next* redelivery books the charge a second time. Asserted by test
> **P-GP-6**, which pins the template text and the exact count of
> `charge.collected` writes.

Webhook authentication (`HMAC-SHA512` + `timingSafeEqual`), the
`received → processing → processed/failed` state machine, the escrow claim/CAS
logic, and the refund `refundReference` claim were **not modified**.

---

## 6. Interface for international checkout

Checkout/shipping should depend on this, **not** on `paystackservices` internals:

```js
import {
  CHARGED_CURRENCY,        // the unit you must charge and verify in
  toMinorUnits,            // major -> minor (pesewas); throws on unknown currency
  minorUnitScale,          // precision declaration per currency
  verifyChargeMatchesOrder,// reuse instead of hand-rolling a comparison
  buildChargeSnapshot,     // reuse for any additional journal writes
} from '../Services/paymentCurrency.js';
```

Rules for consumers:

1. **Never** introduce a currency literal. Import `CHARGED_CURRENCY`.
2. **Never** size a Paystack payload from the admin `currency` setting.
3. Amounts handed to Paystack are **minor units** (`toMinorUnits`).
4. Any new journal write must pass `currency` explicitly and use
   `buildChargeSnapshot` for its payload.
5. If you need a second currency, you must first extend `MINOR_UNIT_SCALE` —
   which **throws** for an undeclared currency rather than guessing ×100.

---

## 7. Test doubles for the other workstreams

`backend/tests/helpers/paystackMock.js` — no credentials, no network.

```js
import {
  chargeSucceeded, currencyMismatch, amountMismatch, chargeFailed,
  envelope, verifyEndpoint, toPesewas,
} from './helpers/paystackMock.js';
```

| Helper | Use |
|---|---|
| `chargeSucceeded({reference, amountMinorUnits})` | happy path; deliberately **includes** `authorization` + `customer` so a test can prove the snapshot drops them |
| `currencyMismatch({...})` | an NGN charge — must be rejected |
| `amountMismatch({...})` | reference-replay in the same currency |
| `chargeFailed({...})` | provider says no |
| `envelope(charge)` | the axios-shaped `{data:{status,message,data}}` envelope |
| `verifyEndpoint({verifyResponse})` | an axios adapter that answers `/transaction/verify/<ref>` and records every outbound call |
| `toPesewas(n)` | major → minor, matching `Math.round(n*100)` |

The mock never asserts; the calling test owns assertions. It also refuses a
non-provider host, so a test cannot accidentally be written against a URL a
crafted reference could redirect.

---

## 8. Migration

**No schema change was required.** `financial_events.currency` and `.payload`
already existed; they were simply not being populated with real values. No
migration was added, so there is nothing to roll back.

---

## 9. Known limitations (documented, not pretended away)

1. **GHS-only charging.** A cross-border buyer paying from outside Ghana is
   still charged in GHS on a GHS-denominated Paystack account. Whether their
   card can complete that charge is a **provider/bank** question this
   repository cannot answer.
2. **No FX.** There is no rate source, no conversion, and no rate table. The
   suite asserts none exists (**P-GP-5**) so an accidental introduction fails
   CI.
3. **No settlement outside GHS.** Vendor payouts go to GHS recipients. A
   vendor who cannot receive GHS will have transfers fail at the provider.
4. **Tax and shipping are not in escrow.** Unchanged from before, and out of
   this workstream's scope, but flagged: collected shipping/tax are not
   allocated or journaled, so the books do not balance. Owned by
   checkout/shipping + finance, not here.
5. **Currency is not on `orders`.** See §3 — deliberate, with a documented
   join path.

---

## 10. Coordination status

| With | Agreement | Status |
|---|---|---|
| **Checkout** | snapshot shape + `paymentCurrency` import surface | contract published here; no unmerged code imported |
| **Shipping** | fields needed to compute the order total must be in `CHARGED_CURRENCY` | awaiting their field list |

Shared files touched by this workstream, each with the **smallest possible**
change:

| File | Change | Why unavoidable |
|---|---|---|
| `Services/paystackservices.js` | 5 literals → constant + import | provider payload currency |
| `routes/paymentRoutes.js` | 2 comparisons → constant; 2 stub payloads → real snapshot | verification + journal |
| `Services/escrowService.js` | 1 comparison → constant + import | recovery-path verification must not drift |
| `controllers/customRequestController.js` | 1 comparison → constant + import | same |

No shared file's behaviour changed. Every substitution is value-identical.
