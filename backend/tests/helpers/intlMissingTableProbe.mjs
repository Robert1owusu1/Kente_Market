// FILE LOCATION: backend/tests/helpers/intlMissingTableProbe.mjs
// DESCRIPTION: F-6 probe for the "migration never ran" condition. It renames
//              ONE required table aside, exercises the real quote endpoint and
//              the real booking service, restores the table in a finally, and
//              prints a single JSON line with what happened.
//
// Why a subprocess: the shared test database is used by other suites in the
// same `node --test` run, so RENAME TABLE here must not be visible to them.
// This probe is pointed at the suite's own disposable schema (DB_NAME set by
// the caller), which makes the window invisible to every other test file.
//
// Usage: DB_NAME=<schema> node intlMissingTableProbe.mjs <table>
//        <table> ∈ exchange_rates | shipping_rates | vendor_shipping_destinations
import pool from '../../config/db.js';

const TABLES = new Set([
  'exchange_rates',
  'shipping_rates',
  'vendor_shipping_destinations',
]);

const table = process.argv[2];
if (!TABLES.has(table)) {
  console.error(`usage: intlMissingTableProbe.mjs <${[...TABLES].join(' | ')}>`);
  process.exit(2);
}

const BAK = `${table}_probe_bak`;
const output = { table, quote: null, vendorQuote: null, booking: null, eligibility: null, restored: false };

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (/** @type {number} */ c) => { res.statusCode = c; return res; };
  res.json = (/** @type {any} */ p) => { res.body = p; return res; };
  return res;
};

const controller = await import('../../controllers/internationalCheckoutController.js');
const svc = await import('../../Services/shippingService.js');
const { checkVendorDestination } = svc;

await pool.query(`RENAME TABLE \`${table}\` TO \`${BAK}\``);
try {
  const q = mockRes();
  await controller.getShippingOptions({ body: { countryCode: 'GB', subtotal: 100 } }, q);
  output.quote = { status: q.statusCode, body: q.body };

  // Vendor-eligible variant of the same quote: this is the branch that reads
  // vendor_shipping_destinations inside the service (the controller only
  // reaches it when the cart names vendors).
  const vq = await svc.getShippingOptions({
    destinationCountry: 'GB',
    vendorId: 1,
    items: [],
    subtotal: 100,
    currency: 'GBP',
  });
  output.vendorQuote = { status: vq.status ?? 200, body: vq };

  output.booking = await svc.getChargeableShippingGHS({
    destinationCountry: 'GB',
    items: [{ productId: 1, qty: 1 }],
    subtotal: 100,
  });

  if (table === 'vendor_shipping_destinations') {
    try {
      output.eligibility = { ok: true, value: await checkVendorDestination(1, 'GB', null) };
    } catch (err) {
      output.eligibility = { ok: false, code: err.code ?? null, message: err.message };
    }
  }
} finally {
  await pool.query(`RENAME TABLE \`${BAK}\` TO \`${table}\``);
  output.restored = true;
  await pool.end();
}

console.log(`PROBE_RESULT ${JSON.stringify(output)}`);
process.exit(0);
