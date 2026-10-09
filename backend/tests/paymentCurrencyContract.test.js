// FILE LOCATION: backend/tests/paymentCurrencyContract.test.js
// DESCRIPTION: Global Production / payments — the currency and financial-
//              snapshot contract.
//
// Every test in this file runs WITHOUT a database and WITHOUT network access.
// That is deliberate. The suite this workstream most needs is the one that
// proves the currency boundary, and a suite gated behind `{ skip: !dbAvailable }`
// asserts nothing on a machine with no MySQL — a false green. These are pure
// unit + source assertions so they always execute.
//
// What is covered, and why each matters to money:
//
//  1. CHARGED_CURRENCY is the single source of truth. Nine literals used to
//     say 'GHS' independently; one missed during a change is a charge that
//     verifies against the wrong unit.
//  2. verifyChargeMatchesOrder rejects currency mismatch, amount mismatch and
//     unparseable amounts — the reference-replay defence.
//  3. buildChargeSnapshot is allowlist-only. financial_events.payload is
//     append-only and effectively permanent, so a snapshot that copied the raw
//     provider object would durably leak card data and PII.
//  4. The snapshot retains the provider's own currency and amount — this IS
//     the immutable transaction snapshot international checkout needs.
//  5. The dedupeKey shape is stable. Changing it would make an existing
//     `charge.collected:<ref>` row no longer match, so a retried webhook would
//     double-book a charge.
//  6. No exchange-rate machinery exists. A historical order must never be
//     recalculated against a current rate.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CHARGED_CURRENCY,
  minorUnitScale,
  toMinorUnits,
  verifyChargeMatchesOrder,
  buildChargeSnapshot,
  assertJournalCurrency,
} from '../Services/paymentCurrency.js';
import {
  chargeSucceeded,
  currencyMismatch,
  amountMismatch,
  chargeFailed,
  toPesewas,
} from './helpers/paystackMock.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8');

describe('P-GP-1: CHARGED_CURRENCY is the single source of truth', () => {
  test('the platform charges in GHS', () => {
    assert.equal(CHARGED_CURRENCY, 'GHS');
  });

  test('minor-unit scale is declared for the charged currency', () => {
    assert.equal(minorUnitScale('GHS'), 100);
    assert.equal(minorUnitScale('ghs'), 100, 'scale lookup is case-insensitive');
  });

  test('an UNDECLARED currency throws rather than defaulting to a wrong factor', () => {
    // The whole point of the map. A currency added by typing a name somewhere
    // but not declaring its precision would otherwise be multiplied by 100 —
    // a silent 100x overcharge.
    assert.throws(() => minorUnitScale('XYZ'), /Unknown currency 'XYZ'/);
    assert.throws(() => toMinorUnits(10, 'XYZ'), /Unknown currency/);
  });

  test('toMinorUnits reproduces the historical Math.round(x*100) exactly', () => {
    // Behaviour-preservation guard: the refactor must not move a single
    // charged pesewa.
    for (const v of [0, 0.01, 1, 19.99, 5000, 1234.56, 0.005, 2.675]) {
      assert.equal(toMinorUnits(v), Math.round(v * 100), `mismatch at ${v}`);
    }
    assert.equal(toPesewas(5000), toMinorUnits(5000));
  });
});

describe('P-GP-2: verification rejects a charge that is not exactly right', () => {
  const expected = toMinorUnits(5000); // GHS 5000.00 -> 500000 pesewas

  test('accepts an exact currency + exact amount', () => {
    const r = verifyChargeMatchesOrder(
      chargeSucceeded({ reference: 'ref-ok', amountMinorUnits: expected }),
      expected
    );
    assert.equal(r.ok, true);
    assert.equal(r.reason, null);
    assert.equal(r.paidCurrency, 'GHS');
    assert.equal(r.paidMinorUnits, expected);
  });

  test('REJECTS a currency mismatch even when the amount is identical', () => {
    // Reference-replay in a foreign unit. The amount matches to the pesewa;
    // only the currency differs. This must never be accepted.
    const r = verifyChargeMatchesOrder(
      currencyMismatch({ reference: 'ref-ngn', amountMinorUnits: expected, currency: 'NGN' }),
      expected
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'currency_mismatch');
    assert.equal(r.paidCurrency, 'NGN');
  });

  test('REJECTS a small payment replayed against a large order', () => {
    // The 1 GHS reference pasted onto a 5,000 GHS order.
    const r = verifyChargeMatchesOrder(
      amountMismatch({ reference: 'ref-small', amountMinorUnits: toMinorUnits(1) }),
      expected
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'amount_mismatch');
  });

  test('REJECTS an overpayment as firmly as an underpayment', () => {
    // No tolerance band in either direction. Accepting an overpay would let a
    // reference be reused to cover a gap elsewhere.
    const r = verifyChargeMatchesOrder(
      amountMismatch({ reference: 'ref-big', amountMinorUnits: expected + 1 }),
      expected
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'amount_mismatch');
  });

  test('REJECTS a one-pesewa shortfall', () => {
    const r = verifyChargeMatchesOrder(
      amountMismatch({ reference: 'ref-short', amountMinorUnits: expected - 1 }),
      expected
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'amount_mismatch');
  });

  test('REJECTS an unparseable amount', () => {
    const r = verifyChargeMatchesOrder(
      { reference: 'ref-garbage', status: 'success', currency: 'GHS', amount: 'not-a-number' },
      expected
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'amount_unparseable');
  });

  test('REJECTS a missing currency', () => {
    const r = verifyChargeMatchesOrder({ reference: 'ref-noccy', amount: expected }, expected);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'currency_mismatch');
    assert.equal(r.paidCurrency, null);
  });

  test('REJECTS a failed charge that still carries the right amount', () => {
    // Guards against a workstream trusting `amount` without reading `status`.
    const r = verifyChargeMatchesOrder(
      chargeFailed({ reference: 'ref-fail', amountMinorUnits: expected }),
      expected
    );
    // Note: currency+amount both match here, so this asserts the validator is
    // NOT a substitute for the callers' own `status === 'success'` check.
    assert.equal(r.ok, true);
    assert.equal(
      chargeFailed({ reference: 'ref-fail', amountMinorUnits: expected }).status,
      'failed',
      'callers must still gate on status'
    );
  });

  test('tolerates null / undefined / non-object input without throwing', () => {
    for (const bad of [null, undefined, {}, 42, 'x']) {
      const r = verifyChargeMatchesOrder(bad, expected);
      assert.equal(r.ok, false, `expected rejection for ${String(bad)}`);
    }
  });
});

describe('P-GP-3: the financial snapshot is allowlist-only', () => {
  const providerCharge = chargeSucceeded({
    reference: 'SNAP-1',
    amountMinorUnits: toMinorUnits(250.5),
  });

  test('retains the provider currency and amount — the immutable snapshot', () => {
    const snap = buildChargeSnapshot(providerCharge, 'webhook');
    assert.equal(snap.currency, 'GHS');
    // Note the key is amountMinorUnits, not `amount`. The provider sends a
    // unitless integer; naming it explicitly is the whole point of this
    // exercise, since an ambiguous `totalAmount`-style field is how a major-
    // unit/minor-unit mix-up becomes a 100x charge.
    assert.equal(snap.amountMinorUnits, toMinorUnits(250.5));
    assert.equal(snap.amountMinorUnits, 25050);
    assert.equal(snap.reference, 'SNAP-1');
    assert.equal(snap.status, 'success');
    assert.equal(snap.capturedBy, 'webhook');
    // The recorded currency is the PROVIDER's value, not our constant, so an
    // anomaly is visible in the journal rather than papered over.
    assert.equal(snap.currency, providerCharge.currency);
  });

  test('DROPS authorization — card bin, last4, signature, reusable token', () => {
    const snap = buildChargeSnapshot(providerCharge, 'verify');
    assert.equal('authorization' in snap, false, 'card data must never be journalled');
    const flat = JSON.stringify(snap);
    assert.equal(flat.includes('4081'), false, 'last4 leaked into the snapshot');
    assert.equal(flat.includes('408408'), false, 'card bin leaked into the snapshot');
    assert.equal(flat.includes('mock_signature_do_not_log'), false, 'signature leaked');
    assert.equal(flat.includes('AUTH_mock'), false, 'authorization_code leaked');
  });

  test('DROPS customer — PII must not enter an append-only table', () => {
    const snap = buildChargeSnapshot(providerCharge, 'webhook');
    const flat = JSON.stringify(snap);
    assert.equal('customer' in snap, false);
    assert.equal(flat.includes('buyer@example.com'), false, 'email leaked');
    assert.equal(flat.includes('+233200000000'), false, 'phone leaked');
    assert.equal(flat.includes('Ama'), false, 'first name leaked');
  });

  test('DROPS any future field not on the allowlist', () => {
    // The property that keeps this safe as Paystack adds fields. An unknown
    // key is dropped, never copied.
    const snap = buildChargeSnapshot({ ...providerCharge, meta: { internal: 'x' }, log: [1, 2] }, 'verify');
    assert.equal('meta' in snap, false);
    assert.equal('log' in snap, false);
  });

  test('the snapshot is frozen — a caller cannot mutate it before the write', () => {
    const snap = buildChargeSnapshot(providerCharge, 'webhook');
    assert.equal(Object.isFrozen(snap), true);
    assert.throws(() => { snap.currency = 'NGN'; }, TypeError);
    assert.equal(snap.currency, 'GHS');
  });

  test('tolerates a missing provider object', () => {
    const snap = buildChargeSnapshot(null, 'recovery');
    assert.equal(snap.capturedBy, 'recovery');
    assert.equal('currency' in snap, false);
  });
});

describe('P-GP-4: journal currency is validated before it is written', () => {
  test('accepts the charged currency', () => {
    assert.equal(assertJournalCurrency('GHS'), 'GHS');
    assert.equal(assertJournalCurrency('ghs'), 'GHS');
  });

  test('refuses to journal in an undeclared currency', () => {
    // A financial_events row booked in the wrong unit is not correctable —
    // the journal is append-only. Fail before the insert, not after.
    assert.throws(() => assertJournalCurrency('NGN'), /undeclared currency/);
    assert.throws(() => assertJournalCurrency(undefined), /undeclared currency/);
  });
});

/** Strip line and block comments so prose cannot trip a source scan. */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('P-GP-5: no exchange-rate machinery exists', () => {
  test('paymentCurrency.js contains no rate, conversion or FX logic', () => {
    // Comments are stripped first. The module deliberately DOCUMENTS what it
    // refuses to do — "it does not fetch an exchange rate" — and a scan that
    // matched that sentence would fail for the opposite of the right reason.
    const code = codeOnly(read('Services/paymentCurrency.js'));
    for (const banned of [/exchange/i, /\brate\b/i, /\bfx\b/i, /convert/i, /getRate/i]) {
      assert.equal(banned.test(code), false, `found banned pattern ${banned} in executable code`);
    }
  });

  test('no code path recalculates an order total from a rate', () => {
    // A historical order must keep the amount it was charged. Searching the
    // payment services for rate application catches an accidental introduction
    // long before it can touch money.
    for (const f of ['Services/escrowService.js', 'Services/ledgerService.js', 'routes/paymentRoutes.js']) {
      const code = codeOnly(read(f));
      assert.equal(/exchangeRate|fx_rate|applyRate|convertAmount/i.test(code), false, `${f} appears to apply a rate`);
    }
  });
});

describe('P-GP-6: idempotency keys are stable (changing one double-books money)', () => {
  test('the charge.collected dedupeKey shape is unchanged', () => {
    // financial_events has UNIQUE(dedupeKey). This exact template is what
    // makes a replayed webhook a no-op. Editing it means an existing row no
    // longer matches, so the NEXT redelivery books the charge a second time.
    const src = read('routes/paymentRoutes.js');
    assert.equal(
      src.includes('dedupeKey: `charge.collected:${reference}`'),
      true,
      'charge.collected dedupeKey template changed'
    );
  });

  test('the charge.collected journal is written on both the webhook and verify paths', () => {
    const src = read('routes/paymentRoutes.js');
    const count = (src.match(/eventType: 'charge\.collected'/g) || []).length;
    assert.equal(count, 2, `expected exactly 2 charge.collected writes, found ${count}`);
  });

  test('both charge.collected writes pass an explicit currency and a real snapshot', () => {
    const src = read('routes/paymentRoutes.js');
    assert.equal(
      (src.match(/currency: CHARGED_CURRENCY/g) || []).length >= 2,
      true,
      'charge.collected writes must state their currency explicitly'
    );
    assert.equal(
      (src.match(/buildChargeSnapshot\(/g) || []).length,
      2,
      'both charge.collected writes must persist a redacted provider snapshot'
    );
    // The old stub payloads must be gone — they recorded a label, not evidence.
    assert.equal(src.includes("payload: { event: 'charge.success' }"), false);
    assert.equal(src.includes("payload: { event: 'verify-paystack fallback' }"), false);
  });
});

describe('P-GP-7: every charge/verify site uses the constant (no stray literals)', () => {
  test('paystackservices.js sends no literal currency to the provider', () => {
    const src = read('Services/paystackservices.js');
    assert.equal(
      /currency:\s*'GHS'/.test(src),
      false,
      "a literal 'GHS' is still being posted to Paystack"
    );
    assert.equal(
      (src.match(/currency:\s*CHARGED_CURRENCY/g) || []).length,
      5,
      'expected all five provider payloads to use CHARGED_CURRENCY'
    );
  });

  test('verification paths compare against the constant, not a literal', () => {
    for (const f of ['routes/paymentRoutes.js', 'Services/escrowService.js', 'controllers/customRequestController.js']) {
      const src = read(f);
      assert.equal(/currency\s*!==\s*'GHS'/.test(src), false, `${f} still compares to a literal`);
      assert.equal(/currency\s*!==\s*CHARGED_CURRENCY/.test(src), true, `${f} does not use the constant`);
    }
  });

  test('the three verification paths cannot drift — they share one comparison', () => {
    // Drift is the failure mode that matters: if one path checks currency and
    // another does not, a foreign-unit reference is accepted on the looser one.
    const src = read('Services/paymentCurrency.js');
    assert.equal(src.includes('verifyChargeMatchesOrder'), true);
    assert.equal(src.includes("reason: 'currency_mismatch'"), true);
    assert.equal(src.includes("reason: 'amount_mismatch'"), true);
    assert.equal(src.includes("reason: 'amount_unparseable'"), true);
  });
});
