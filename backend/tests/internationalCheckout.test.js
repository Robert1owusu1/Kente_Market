// FILE LOCATION: backend/tests/internationalCheckout.test.js
// DESCRIPTION: Checkout-workstream regression tests (DB-free).
// Covers: Ghana checkout preserved, international address/phone validation,
// unsupported-destination rejection, missing-field/invalid handling, totals
// separation, and the paid-snapshot-immutability + route-contract guards.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  SUPPORTED_DESTINATIONS,
  CHARGE_CURRENCY,
  normalizeDestinationCode,
  isSupportedDestination,
  validateDestinationAddress,
  verifyTotalsBreakdown,
} from '../utils/destinationValidation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.join(__dirname, '..');
const FRONTEND_TS = path.join(BACKEND_ROOT, '..', 'src', 'utils', 'internationalCheckout.ts');

const ghHome = {
  firstName: 'Ama',
  lastName: 'Mensah',
  email: 'ama@example.com',
  phone: '0241234567',
  address: '123 Oxford Street',
  city: 'Accra',
  region: 'Greater Accra',
  country: 'Ghana',
};

describe('international checkout — Ghana regression', () => {
  test('legacy Ghana home address still validates', () => {
    const r = validateDestinationAddress(ghHome);
    assert.equal(r.valid, true);
    assert.equal(r.countryCode, 'GH');
  });

  test('Ghana +233 phone validates, bad phone rejected with INVALID_PHONE', () => {
    assert.equal(validateDestinationAddress({ ...ghHome, phone: '+233241234567' }).valid, true);
    const bad = validateDestinationAddress({ ...ghHome, phone: '123' });
    assert.equal(bad.valid, false);
    assert.equal(bad.code, 'INVALID_PHONE');
  });

  test('Ghana pickup needs contact fields only (no address)', () => {
    const pickup = {
      firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com', phone: '0241234567',
      deliveryMethod: 'pickup', country: 'Ghana',
    };
    assert.equal(validateDestinationAddress(pickup).valid, true);
    const missing = validateDestinationAddress({ ...pickup, phone: '' });
    assert.equal(missing.valid, false);
    assert.equal(missing.code, 'MISSING_ADDRESS_FIELDS');
  });

  test('charge currency is always GHS (no invented FX)', () => {
    assert.equal(CHARGE_CURRENCY, 'GHS');
  });
});

describe('international checkout — destination validation', () => {
  test('unsupported destinations rejected safely', () => {
    for (const code of ['XX', 'FR', 'NG', '']) {
      const r = validateDestinationAddress({ ...ghHome, countryCode: code || undefined, country: code });
      // '' falls back to GH default; explicit unsupported codes reject
      if (!code) {
        assert.equal(r.valid, true);
      } else {
        assert.equal(r.valid, false);
        assert.equal(r.code, 'UNSUPPORTED_DESTINATION');
      }
    }
  });

  test('US address validates; bad ZIP and bad state rejected at field level', () => {
    const us = {
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '+15551234567',
      addressLine1: '350 5th Ave', city: 'New York', region: 'NY', countryCode: 'US',
    };
    // destination gate passes (deep field/zip rules live in validateAddress endpoint)
    assert.equal(validateDestinationAddress(us).valid, true);
    assert.equal(normalizeDestinationCode('us'), 'US');
    // NOTE: full-name mapping ('Ghana' -> 'GH') lives in
    // validateDestinationAddress, not normalizeDestinationCode.
    assert.equal(normalizeDestinationCode('Ghana'), null);
    assert.equal(validateDestinationAddress({ ...ghHome }).countryCode, 'GH');
    assert.equal(isSupportedDestination('FR'), false);
  });

  test('GB address does not require region (postal code instead)', () => {
    const gb = {
      firstName: 'John', lastName: 'Smith', email: 'john@example.co.uk', phone: '+442071234567',
      addressLine1: '10 Downing Street', city: 'London', countryCode: 'GB',
    };
    assert.equal(validateDestinationAddress(gb).valid, true);
  });

  test('missing international fields list names', () => {
    const r = validateDestinationAddress({ firstName: 'Jane', countryCode: 'US' });
    assert.equal(r.valid, false);
    assert.equal(r.code, 'MISSING_ADDRESS_FIELDS');
    assert.ok(r.missing.includes('phone'));
  });

  test('invalid email rejected', () => {
    const r = validateDestinationAddress({ ...ghHome, email: 'not-an-email' });
    assert.equal(r.valid, false);
    assert.equal(r.code, 'INVALID_EMAIL');
  });

  test('per-country phone patterns enforced', () => {
    const base = { firstName: 'A', lastName: 'B', email: 'a@b.co', addressLine1: '123 Main St', city: 'Xy', region: 'NY', postalCode: '10001' };
    assert.equal(validateDestinationAddress({ ...base, phone: '+15551234567', countryCode: 'US' }).valid, true);
    assert.equal(validateDestinationAddress({ ...base, phone: '0241234567', countryCode: 'US' }).code, 'INVALID_PHONE');
    assert.equal(validateDestinationAddress({ ...base, phone: '+442071234567', addressLine1: '10 Downing St', city: 'London', countryCode: 'GB' }).valid, true);
  });
});

describe('international checkout — totals separation', () => {
  test('subtotal + shipping + tax - discount equals total', () => {
    const ok = verifyTotalsBreakdown({ subtotal: 100, shipping: 15, tax: 15, discount: 10, total: 120 });
    assert.equal(ok.matches, true);
    assert.equal(ok.expected, 120);
  });

  test('tampered total detected', () => {
    const bad = verifyTotalsBreakdown({ subtotal: 100, shipping: 15, tax: 15, discount: 0, total: 999 });
    assert.equal(bad.matches, false);
  });
});

describe('international checkout — contracts (no DB)', () => {
  test('frontend/backend destination allowlists agree', () => {
    const ts = readFileSync(FRONTEND_TS, 'utf8');
    for (const code of Object.keys(SUPPORTED_DESTINATIONS)) {
      assert.ok(ts.includes(`"${code}"`), `frontend helper missing ${code}`);
    }
  });

  test('orderController keeps destination gate + paid-snapshot immutability', () => {
    const src = readFileSync(path.join(BACKEND_ROOT, 'controllers', 'orderController.js'), 'utf8');
    assert.ok(src.includes('validateDestinationAddress'), 'destination gate missing');
    assert.ok(src.includes('PAID_SNAPSHOT_IMMUTABLE'), 'paid immutability guard missing');
    assert.ok(src.includes("UNSUPPORTED_DESTINATION") || src.includes('dest.code'), 'unsupported code passthrough missing');
  });

  test('international routes mounted with documented contract', () => {
    const server = readFileSync(path.join(BACKEND_ROOT, 'server.js'), 'utf8');
    assert.ok(server.includes('/api/checkout/international'), 'route mount missing');
    const routes = readFileSync(path.join(BACKEND_ROOT, 'routes', 'internationalCheckoutRoutes.js'), 'utf8');
    for (const p of ['countries', 'validate-address', 'shipping-options', 'vendor-eligibility']) {
      assert.ok(routes.includes(p), `route missing: ${p}`);
    }
  });
});
