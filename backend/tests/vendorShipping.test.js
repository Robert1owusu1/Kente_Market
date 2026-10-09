// FILE LOCATION: backend/tests/vendorShipping.test.js
// DESCRIPTION: Vendor shipping destinations — eligibility, CRUD, and isolation.
// DB-backed; cleans up after itself.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const ts = Date.now();
const state = {};

const mockRes = () => {
  let status = 200;
  let body = null;
  return {
    res: {
      status(code) { status = code; return this; },
      json(payload) { body = payload; return this; },
    },
    get: () => ({ status, body }),
  };
};

before(async () => {
  if (!dbAvailable || !pool) return;
  const User = (await import('../models/usersModel.js')).default;
  const mk = (tag, role) => User.create({
    firstName: 'Ship', lastName: tag, email: `vship-${tag}-${ts}@example.com`,
    password: 'Test1234x', role, legalConsentAccepted: true,
  });
  const vendor = await mk('v', 'vendor');
  const vendor2 = await mk('v2', 'vendor');
  const buyer = await mk('buyer', 'customer');
  Object.assign(state, { vendor: vendor.id, vendor2: vendor2.id, buyer: buyer.id });

  const [pr] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
    [`VSHIP ${ts}`, '/uploads/test.png', 100.0, 'test', 10, vendor.id]
  );
  state.product = pr.insertId;

  const [pr2] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
    [`VSHIP2 ${ts}`, '/uploads/test.png', 150.0, 'test', 5, vendor2.id]
  );
  state.product2 = pr2.insertId;

  const [o] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
      paymentMethod, paymentStatus, orderStatus, paymentReference, escrowStatus)
     VALUES (?, ?, ?, ?, ?, ?, 'paystack', 'paid', 'processing', ?, 'held')`,
    [buyer.id, `VSHIP-${ts}`, JSON.stringify([{ product: pr.insertId, qty: 1, price: 100, vendorId: vendor.id }]),
     115, '{}', '{}', `VSHIPREF-${ts}`]
  );
  state.order = o.insertId;
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [state.order]);
    await pool.execute(`DELETE FROM product WHERE id IN (?, ?)`, [state.product, state.product2]);
    await pool.execute(`DELETE FROM vendor_shipping_destinations WHERE vendorId IN (?, ?)`, [state.vendor, state.vendor2]);
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [state.vendor, state.vendor2, state.buyer]);
  } finally {
    await pool.end();
  }
});

describe('vendor shipping destinations', () => {
  test('vendor can add a shipping destination', { skip: !dbAvailable }, async () => {
    const { addVendorShippingDestination } = await import('../Services/shippingService.js');
    const result = await addVendorShippingDestination(state.vendor, 'GB', null, true);
    assert.equal(result.vendorId, state.vendor);
    assert.equal(result.countryCode, 'GB');
    assert.equal(result.region, null);
    assert.equal(result.isActive, true);

    // Verify in DB
    const [[row]] = await pool.execute(
      `SELECT * FROM vendor_shipping_destinations WHERE vendorId = ? AND countryCode = 'GB'`,
      [state.vendor]
    );
    assert.ok(row);
    assert.equal(row.isActive, 1);
  });

  test('vendor can add a shipping destination with region', { skip: !dbAvailable }, async () => {
    const { addVendorShippingDestination } = await import('../Services/shippingService.js');
    const result = await addVendorShippingDestination(state.vendor, 'US', 'CA', true);
    assert.equal(result.countryCode, 'US');
    assert.equal(result.region, 'CA');
    assert.equal(result.isActive, true);
  });

  test('vendor cannot add unsupported country', { skip: !dbAvailable }, async () => {
    const { addVendorShippingDestination } = await import('../Services/shippingService.js');
    try {
      await addVendorShippingDestination(state.vendor, 'XX', null, true);
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('Unsupported country'));
    }
  });

  test('vendor cannot add invalid region for country', { skip: !dbAvailable }, async () => {
    const { addVendorShippingDestination } = await import('../Services/shippingService.js');
    try {
      await addVendorShippingDestination(state.vendor, 'US', 'INVALID', true);
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('Invalid region'));
    }
  });

  test('vendor can list their shipping destinations', { skip: !dbAvailable }, async () => {
    const { getVendorShippingDestinations } = await import('../Services/shippingService.js');
    const destinations = await getVendorShippingDestinations(state.vendor);
    assert.ok(Array.isArray(destinations));
    assert.ok(destinations.length >= 2); // GB and US from previous tests
    const gb = destinations.find(d => d.countryCode === 'GB');
    assert.ok(gb);
    assert.equal(gb.isActive, true);
  });

  test('vendor can remove a shipping destination', { skip: !dbAvailable }, async () => {
    const { removeVendorShippingDestination, getVendorShippingDestinations } = await import('../Services/shippingService.js');
    const before = await getVendorShippingDestinations(state.vendor);
    const toRemove = before.find(d => d.countryCode === 'GB');
    assert.ok(toRemove);

    const deleted = await removeVendorShippingDestination(state.vendor, toRemove.id);
    assert.equal(deleted, true);

    const after = await getVendorShippingDestinations(state.vendor);
    const found = after.find(d => d.countryCode === 'GB');
    assert.equal(found, undefined);
  });

  test('vendor cannot remove another vendor destination', { skip: !dbAvailable }, async () => {
    const { removeVendorShippingDestination, addVendorShippingDestination } = await import('../Services/shippingService.js');
    // Add destination for vendor2
    await addVendorShippingDestination(state.vendor2, 'DE', null, true);
    const [[row]] = await pool.execute(
      `SELECT id FROM vendor_shipping_destinations WHERE vendorId = ? AND countryCode = 'DE'`,
      [state.vendor2]
    );

    // Try to remove as vendor1
    const deleted = await removeVendorShippingDestination(state.vendor, row.id);
    assert.equal(deleted, false);
  });

  test('checkVendorDestination returns true for active destination', { skip: !dbAvailable }, async () => {
    const { checkVendorDestination } = await import('../Services/shippingService.js');
    const eligible = await checkVendorDestination(state.vendor, 'US', 'CA');
    assert.equal(eligible, true);
  });

  test('checkVendorDestination returns false for inactive destination', { skip: !dbAvailable }, async () => {
    const { setVendorShippingDestination, checkVendorDestination } = await import('../Services/shippingService.js');
    // Add and then deactivate
    await setVendorShippingDestination(state.vendor, 'FR', null, true);
    await setVendorShippingDestination(state.vendor, 'FR', null, false);
    const eligible = await checkVendorDestination(state.vendor, 'FR', null);
    assert.equal(eligible, false);
  });

  test('checkVendorDestination returns false for missing destination', { skip: !dbAvailable }, async () => {
    const { checkVendorDestination } = await import('../Services/shippingService.js');
    const eligible = await checkVendorDestination(state.vendor, 'JP', null);
    assert.equal(eligible, false);
  });

  test('vendor isolation: vendor1 destination does not affect vendor2', { skip: !dbAvailable }, async () => {
    const { checkVendorDestination } = await import('../Services/shippingService.js');
    // vendor1 has US, vendor2 has DE
    const v1US = await checkVendorDestination(state.vendor, 'US', null);
    const v2US = await checkVendorDestination(state.vendor2, 'US', null);
    const v1DE = await checkVendorDestination(state.vendor, 'DE', null);
    const v2DE = await checkVendorDestination(state.vendor2, 'DE', null);
    assert.equal(v1US, true);
    assert.equal(v2US, false);
    assert.equal(v1DE, false);
    assert.equal(v2DE, true);
  });
});

describe('shipping options with vendor eligibility', () => {
  test('getShippingOptions returns unsupported for vendor without destination', { skip: !dbAvailable }, async () => {
    const { getShippingOptions } = await import('../Services/shippingService.js');
    // vendor2 does not have GB enabled
    const result = await getShippingOptions({
      destinationCountry: 'GB',
      vendorId: state.vendor2,
      items: [{ productId: state.product2, qty: 1 }],
      subtotal: 200,
      currency: 'GBP',
    });
    assert.equal(result.supported, false);
    assert.ok(result.message.includes('does not ship to'));
  });

  test('getShippingOptions returns options for eligible vendor', { skip: !dbAvailable }, async () => {
    const { getShippingOptions } = await import('../Services/shippingService.js');
    // vendor has US enabled
    const result = await getShippingOptions({
      destinationCountry: 'US',
      vendorId: state.vendor,
      items: [{ productId: state.product, qty: 1 }],
      subtotal: 200,
      currency: 'USD',
    });
    assert.equal(result.supported, true);
    assert.ok(Array.isArray(result.options));
    assert.ok(result.options.length > 0);
    assert.ok(result.options[0].amount >= 0);
    assert.ok(result.options[0].transitDaysMin > 0);
    assert.ok(result.options[0].transitDaysMax >= result.options[0].transitDaysMin);
  });

  test('getShippingOptions falls back to default when no DB rates', { skip: !dbAvailable }, async () => {
    const { getShippingOptions } = await import('../Services/shippingService.js');
    // Use a country with no seeded rates for vendor
    const result = await getShippingOptions({
      destinationCountry: 'NL',
      vendorId: state.vendor, // vendor doesn't have NL
      items: [{ productId: state.product, qty: 1 }],
      subtotal: 200,
      currency: 'EUR',
    });
    // Should fall back to default
    assert.equal(result.supported, true);
    assert.ok(Array.isArray(result.options));
  });
});