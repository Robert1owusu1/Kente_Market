// @ts-check
// SERVICES/paymentCurrency.js
// ---------------------------------------------------------------------------
// Single source of truth for the currency Kente Market CHARGES in.
//
// Why this file exists
// --------------------
// Before Global Production, the string 'GHS' was written literally into nine
// separate call sites across four files (paystackservices, paymentRoutes,
// escrowService, customRequestController). That made two things impossible:
//
//   1. Answering "which currencies do we actually support?" with anything but
//      a grep, and
//   2. Changing the assumption safely, because a missed literal is a payment
//      that verifies against the wrong unit and is silently rejected (or, far
//      worse, accepted).
//
// This module does NOT add multi-currency. It names the existing single-
// currency assumption, keeps every check byte-for-byte equivalent in behaviour,
// and gives the checkout/shipping workstreams one import to depend on.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
// ----------------------------------------
// - It does not convert between currencies.
// - It does not fetch, store, cache or interpolate an exchange rate.
// - It does not recalculate a historical order against a current rate.
// - It does not assume Paystack supports any currency other than GHS.
//
// Paystack currency support is a property of the merchant's account and the
// receiving bank, not of this codebase. Enabling a second currency requires
// provider-account configuration and an operational approval that has NOT been
// obtained. Until that exists, CHARGED_CURRENCY is a constant and any request
// to charge a different unit is refused.
// ---------------------------------------------------------------------------

/**
 * The one currency Kente Market charges, settles and verifies in.
 *
 * Mirrors the hard-coded literals this module replaced. Changing this value
 * without provider-account configuration will make every charge fail
 * verification — which is the correct outcome, not a bug.
 *
 * @type {'GHS'}
 */
export const CHARGED_CURRENCY = 'GHS';

// Minor units (the smallest divisible unit) per major unit, per currency.
// GHS is 100 (pesewas). This map exists so a second currency cannot be added
// by typing a new name somewhere without also declaring its precision — a
// missing entry is a hard error rather than a silent 100x overcharge.
const MINOR_UNIT_SCALE = Object.freeze({ GHS: 100 });

/**
 * Minor units per major unit for a currency. Throws for an unknown currency so
 * that a mis-declared currency fails loudly instead of being multiplied by the
 * wrong factor.
 *
 * @param {string} currency
 * @returns {number}
 */
export const minorUnitScale = (currency) => {
  const scale = MINOR_UNIT_SCALE[String(currency).toUpperCase()];
  if (!scale) {
    throw new Error(
      `Unknown currency '${currency}' — declare its minor-unit scale in paymentCurrency.js before charging it.`
    );
  }
  return scale;
};

/**
 * Convert a major-unit decimal to an integer in that currency's minor units.
 * Uses the same rounding the codebase already applied (`Math.round(x * 100)`),
 * kept identical so this refactor cannot change a single charged amount.
 *
 * @param {number|string} major
 * @param {string} [currency]
 * @returns {number} integer minor units
 */
export const toMinorUnits = (major, currency = CHARGED_CURRENCY) =>
  Math.round(parseFloat(String(major)) * minorUnitScale(currency));

/**
 * The four currency roles. These are distinct in the codebase and must not be
 * collapsed — conflating any pair is how a customer gets charged in the wrong
 * unit or a vendor is settled in a unit they never listed in.
 *
 * 1. LISTING CURRENCY    — what a vendor types into their product price.
 *                          Free text today; never used for a charge.
 * 2. DISPLAY CURRENCY    — cosmetic, from the `currency` admin setting
 *                          (settingController.js). Affects presentation only.
 * 3. CHARGED CURRENCY    — CHARGED_CURRENCY. What Paystack is asked to collect
 *                          and what verification is compared against.
 * 4. SETTLEMENT CURRENCY — the unit a transfer recipient is created in, and
 *                          therefore the unit a vendor can actually receive.
 *                          Today this equals CHARGED_CURRENCY; payouts to an
 *                          account that cannot receive GHS will fail at the
 *                          provider, which is the safe failure.
 *
 * @typedef {'listing'|'display'|'charged'|'settlement'} CurrencyRole
 */

/**
 * @typedef {Object} ProviderChargeSnapshot
 * @property {string} reference
 * @property {string|null} status
 * @property {string|null} currency
 * @property {number|null} amountMinorUnits
 * @property {string|null} channel
 * @property {string|null} paidAt
 * @property {number|null} createdAt
 * @property {string|null} domain
 * @property {string|null} gatewayResponse
 * @property {string} capturedBy
 */

// The ONLY provider fields permitted into the immutable financial snapshot.
//
// Every key here is financial metadata. Anything not on this list is dropped,
// which is what keeps `customer` (email/phone), `authorization` (card bin,
// last4, signature, reusable token), `meta` and `log` out of
// financial_events.payload. Those columns are append-only and effectively
// permanent, so a single careless spread of the raw provider object would be a
// durable card/PII leak that no later migration could reliably scrub.
const SNAPSHOT_FIELDS = Object.freeze({
  reference: 'reference',
  status: 'status',
  currency: 'currency',
  amount: 'amountMinorUnits',
  channel: 'channel',
  paid_at: 'paidAt',
  created_at: 'createdAt',
  domain: 'domain',
  gateway_response: 'gatewayResponse',
});

/**
 * Build the immutable financial snapshot for a Paystack charge object.
 *
 * Allowlist-only by design: an unknown field is silently dropped, never
 * copied. The returned object is frozen so a caller cannot mutate it before
 * it is written.
 *
 * @param {object|null|undefined} tx the provider `data` object
 * @param {string} capturedBy which server path observed this charge
 *        ('webhook' | 'verify' | 'recovery' | 'custom-request')
 * @returns {ProviderChargeSnapshot}
 */
export const buildChargeSnapshot = (tx, capturedBy) => {
  const t = tx && typeof tx === 'object' ? tx : {};
  /** @type {Record<string, unknown>} */
  const snapshot = { capturedBy: String(capturedBy) };
  for (const [from, to] of Object.entries(SNAPSHOT_FIELDS)) {
    if (t[from] !== undefined) snapshot[to] = t[from];
  }
  return Object.freeze(snapshot);
};

/**
 * Validate a provider charge against the order we intend to have been paid.
 *
 * This is the exact comparison the codebase already performs in three places —
 * verify-paystack, the charge.success webhook, and the stuck-order recovery
 * job — reproduced once so the three can never drift apart. Drift is the
 * failure mode that matters: if one path checks currency and another does not,
 * a reference paid in a different unit can be accepted on the looser path.
 *
 * Behaviour is unchanged from the literals it replaces: the currency must be
 * exactly CHARGED_CURRENCY and the paid minor units must equal the expected
 * minor units exactly. No tolerance, no rounding band.
 *
 * @param {object|null|undefined} tx provider `data` object
 * @param {number} expectedMinorUnits
 * @returns {{ ok: boolean, reason: string|null, paidMinorUnits: number, paidCurrency: string|null }}
 */
export const verifyChargeMatchesOrder = (tx, expectedMinorUnits) => {
  const t = tx && typeof tx === 'object' ? tx : {};
  const paidCurrency = t.currency ?? null;
  const paidMinorUnits = parseInt(/** @type {string} */ (t.amount), 10);

  if (paidCurrency !== CHARGED_CURRENCY) {
    return { ok: false, reason: 'currency_mismatch', paidMinorUnits, paidCurrency };
  }
  if (!Number.isFinite(paidMinorUnits)) {
    return { ok: false, reason: 'amount_unparseable', paidMinorUnits, paidCurrency };
  }
  if (paidMinorUnits !== expectedMinorUnits) {
    return { ok: false, reason: 'amount_mismatch', paidMinorUnits, paidCurrency };
  }
  return { ok: true, reason: null, paidMinorUnits, paidCurrency };
};

/**
 * Assert that a financial event is being recorded in the charged currency.
 *
 * The ledger already defaults `currency` to 'GHS'. This helper exists so a
 * caller that PASSES an explicit currency is forced to pass the right one —
 * a journal row booked in the wrong unit is not correctable after the fact,
 * because the journal is append-only.
 *
 * @param {string} currency
 * @returns {string} the validated currency
 */
export const assertJournalCurrency = (currency) => {
  const c = String(currency).toUpperCase();
  if (!MINOR_UNIT_SCALE[c]) {
    throw new Error(
      `Refusing to journal a financial event in undeclared currency '${currency}'.`
    );
  }
  return c;
};
