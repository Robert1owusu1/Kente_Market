// FILE LOCATION: backend/tests/helpers/paystackMock.js
// DESCRIPTION: A credential-free Paystack stand-in for the Global Production
//              workstreams.
//
// Why this exists
// ---------------
// Checkout and shipping both need to drive payment-adjacent code paths (order
// totals, paid-flip guards, escrow arming on delivery) without ever touching
// api.paystack.co. Hitting the real API would require a secret key, spend real
// money, and make the suite non-deterministic — none of which is acceptable in
// CI, and all of which the project rules forbid.
//
// The mock returns objects shaped exactly like the provider envelope this
// codebase actually consumes, so a test written against it exercises the real
// validation logic rather than a simplified stand-in.
//
// WHAT THIS IS NOT
// ----------------
// - It is not a fake that always succeeds. `chargeSucceeded()` is the happy
//   path; `currencyMismatch()`, `amountMismatch()` and `chargeFailed()` exist
//   precisely so a workstream can prove its guards REJECT, which is the half
//   that matters.
// - It does not model FX, conversion, or any currency other than GHS. The
//   platform charges in one currency; a mock that happily returned NGN totals
//   would let a workstream build against a capability that does not exist.
// - It never asserts on its own. It only produces data; the calling test owns
//   the assertions.

/**
 * @typedef {Object} MockCharge
 * @property {string} reference
 * @property {'success'|'failed'|'abandoned'} status
 * @property {string} currency
 * @property {number} amount amount in MINOR units (pesewas)
 * @property {string} channel
 * @property {string|null} paid_at
 * @property {number} created_at
 * @property {string} domain
 * @property {string} gateway_response
 * @property {object} authorization deliberately present so tests can prove it
 *           is NOT copied into the financial snapshot
 * @property {object} customer deliberately present so tests can prove it is
 *           NOT copied into the financial snapshot
 */

/**
 * Build a Paystack-shaped charge in the success state.
 *
 * @param {Object} opts
 * @param {string} opts.reference
 * @param {number} opts.amountMinorUnits amount in pesewas
 * @param {string} [opts.currency]
 * @returns {MockCharge}
 */
export const chargeSucceeded = ({ reference, amountMinorUnits, currency = 'GHS' }) => ({
  reference,
  status: 'success',
  currency,
  amount: amountMinorUnits,
  channel: 'card',
  paid_at: '2026-01-01T12:00:00.000+00:00',
  created_at: 1767278400,
  domain: 'live',
  gateway_response: 'Successful',
  // Present on purpose. buildChargeSnapshot() must drop both of these; a test
  // that asserts their absence is what stops a future "just spread the whole
  // object" refactor from leaking card/PII data into an append-only table.
  authorization: {
    authorization_code: 'AUTH_mock',
    bin: '408408',
    last4: '4081',
    exp_month: '12',
    exp_year: '2030',
    channel: 'card',
    card_type: 'visa',
    bank: 'TEST BANK',
    reusable: true,
    signature: 'mock_signature_do_not_log',
  },
  customer: {
    email: 'buyer@example.com',
    first_name: 'Ama',
    last_name: 'Test',
    phone: '+233200000000',
  },
});

/**
 * A charge in a currency the platform does not accept. Verification must
 * refuse it regardless of amount.
 *
 * @param {Object} opts
 * @param {string} opts.reference
 * @param {number} opts.amountMinorUnits
 * @param {string} [opts.currency]
 * @returns {MockCharge}
 */
export const currencyMismatch = ({ reference, amountMinorUnits, currency = 'NGN' }) =>
  chargeSucceeded({ reference, amountMinorUnits, currency });

/**
 * A successful charge for the wrong amount. This is the classic reference-
 * replay: a 1 GHS payment's reference pasted onto a 5,000 GHS order.
 *
 * @param {Object} opts
 * @param {string} opts.reference
 * @param {number} opts.amountMinorUnits
 * @returns {MockCharge}
 */
export const amountMismatch = ({ reference, amountMinorUnits }) =>
  chargeSucceeded({ reference, amountMinorUnits });

/**
 * A charge Paystack reports as not successful.
 *
 * @param {Object} opts
 * @param {string} opts.reference
 * @param {number} [opts.amountMinorUnits]
 * @returns {MockCharge}
 */
export const chargeFailed = ({ reference, amountMinorUnits = 0 }) => ({
  ...chargeSucceeded({ reference, amountMinorUnits }),
  status: 'failed',
  gateway_response: 'Declined',
});

/**
 * The full axios-shaped envelope the codebase reads (`response.data`).
 *
 * @param {MockCharge|null} data
 * @param {boolean} [status]
 * @param {string} [message]
 * @returns {{data: {status: boolean, message: string, data: object|null}}}
 */
export const envelope = (data, status = Boolean(data), message = 'ok') => ({
  data: { status, message, data },
});

/**
 * Build the axios adapter a service can be pointed at instead of the network.
 * Returns a function suitable for `axios.post`/`axios.get` mocking that
 * answers `/transaction/verify/<ref>` with the supplied charge and records
 * every call so a test can assert on the outbound request.
 *
 * @param {Object} opts
 * @param {MockCharge|null} opts.verifyResponse charge to answer verify with
 * @param {string} opts.expectedHost host the service must be calling
 * @returns {{adapter: Function, calls: Array<{method: string, url: string, body: object|null}>}}
 */
export const verifyEndpoint = ({ verifyResponse, expectedHost = 'https://api.paystack.co' }) => {
  /** @type {Array<{method: string, url: string, body: object|null}>} */
  const calls = [];
  return {
    calls,
    adapter: async (config) => {
      calls.push({
        method: String(config.method || 'get').toLowerCase(),
        url: String(config.url || ''),
        body: config.data ?? null,
      });
      // Mirrors the real service's host check: a crafted reference must never
      // be able to move the request off the provider origin.
      const url = new URL(String(config.url));
      if (url.host !== expectedHost.replace(/^https?:\/\//, '')) {
        throw new Error(`unexpected host ${url.host}`);
      }
      return envelope(verifyResponse);
    },
  };
};

/**
 * Convert major units (GHS) to the minor units (pesewas) the provider speaks.
 * Mirrors `Math.round(amount * 100)` so a mock total and a real total are
 * computed the same way.
 *
 * @param {number} major
 * @returns {number}
 */
export const toPesewas = (major) => Math.round(major * 100);
