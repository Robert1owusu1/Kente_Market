// @ts-check
// Tests for the UNIFIED international checkout controller
// (fix/global-production-integration): the checkout + shipping workstreams
// previously shipped divergent copies of this file. These DB-free tests pin
// the merged semantics so a future split cannot silently regress:
//
// - single allowlist source (destinationValidation.js SSOT)
// - "Ghana" legacy name maps to GH
// - postcode validation is normalize-then-test ("SW1A 1AA" == "SW1A1AA")
// - every response carries chargeCurrency === "GHS" (charge stays GHS-only)
// - unknown countries fail closed on all endpoints
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

let controller;
let CHARGE_CURRENCY;

before(async () => {
  controller = await import('../controllers/internationalCheckoutController.js');
  ({ CHARGE_CURRENCY } = await import('../utils/destinationValidation.js'));
});

/**
 * Minimal express res double capturing status + json payload.
 */
const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  // @ts-expect-error test double: express response shape
  res.status = (code) => { res.statusCode = code; return res; };
  // @ts-expect-error test double: express response shape
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const validGB = {
  countryCode: 'GB',
  firstName: 'Ama',
  lastName: 'Mensah',
  phone: '+44 20 7123 4567',
  addressLine1: '10 Downing Street',
  city: 'London',
  postalCode: 'SW1A 1AA',
};

describe('unified destination semantics (no DB)', () => {
  test('charge currency is single-sourced GHS', () => {
    assert.equal(CHARGE_CURRENCY, 'GHS');
  });

  test('getSupportedCountries lists 6 destinations + chargeCurrency', async () => {
    const res = mockRes();
    await controller.getSupportedCountries({}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.chargeCurrency, 'GHS');
    assert.deepEqual(
      res.body.countries.map((/** @type {any} */ c) => c.code).sort(),
      ['CA', 'DE', 'GB', 'GH', 'NL', 'US']
    );
  });

  test('getAddressConfig normalizes case and keeps chargeCurrency', async () => {
    const res = mockRes();
    await controller.getAddressConfig({ params: { countryCode: 'gb' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.countryCode, 'GB');
    assert.equal(res.body.chargeCurrency, 'GHS');
  });

  test('getAddressConfig rejects unknown countries', async () => {
    const res = mockRes();
    await controller.getAddressConfig({ params: { countryCode: 'NG' } }, res);
    assert.equal(res.statusCode, 404);
  });

  test('validateAddress accepts GB postcode with a space', async () => {
    const res = mockRes();
    await controller.validateAddress({ body: { ...validGB } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.valid, true);
    assert.equal(res.body.chargeCurrency, 'GHS');
  });

  test('validateAddress accepts GB postcode without a space (normalize-then-test)', async () => {
    const res = mockRes();
    await controller.validateAddress(
      { body: { ...validGB, postalCode: 'SW1A1AA' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.valid, true);
  });

  test('validateAddress maps legacy "Ghana" to GH', async () => {
    const res = mockRes();
    await controller.validateAddress(
      {
        body: {
          countryCode: 'Ghana',
          firstName: 'Kwame',
          lastName: 'Asante',
          phone: '0241234567',
          addressLine1: '123 Oxford Street',
          city: 'Accra',
          region: 'Greater Accra',
        },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.valid, true);
    assert.equal(res.body.normalized.countryCode, 'GH');
  });

  test('validateAddress rejects unsupported countries fail-closed', async () => {
    for (const code of ['NG', 'XX', 'FR', '']) {
      const res = mockRes();
      await controller.validateAddress({ body: { ...validGB, countryCode: code } }, res);
      assert.equal(res.statusCode, 400, `expected 400 for ${code}`);
      assert.equal(res.body.valid, false);
    }
  });

  test('validateAddress rejects bad GB postcode', async () => {
    const res = mockRes();
    await controller.validateAddress(
      { body: { ...validGB, postalCode: 'NOT-A-POSTCODE' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.valid, false);
    assert.ok(res.body.errors.postalCode);
  });

  test('getShippingOptions rejects unknown countries without touching the DB', async () => {
    const res = mockRes();
    await controller.getShippingOptions({ body: { countryCode: 'XX', subtotal: 100 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.supported, false);
  });

  test('checkVendorShippingEligibility rejects unknown countries without touching the DB', async () => {
    const res = mockRes();
    await controller.checkVendorShippingEligibility(
      { body: { countryCode: 'XX', vendorIds: [1] } },
      res
    );
    assert.equal(res.body.eligible, false);
  });
});
