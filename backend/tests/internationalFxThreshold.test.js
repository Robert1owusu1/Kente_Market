// FILE LOCATION: backend/tests/internationalFxThreshold.test.js
// DESCRIPTION: F-6 (missing `exchange_rates` migration) + F-7 (free-shipping
//              threshold compared across currencies) remediation — the
//              regression suite for international checkout money math.
//
// F-6 root cause under test
//   The canonical schema (branding_house.sql) did not contain exchange_rates /
//   shipping_carriers / shipping_rates / vendor_shipping_destinations, the
//   shared dev database never received `db:migrate`, and the QUOTE path did
//   not handle a missing table: a cross-currency quote threw a driver error
//   (opaque 500 "Failed to fetch shipping options") while order creation
//   refused with 503 — and a lane with no rate rows was answered from the
//   static fallback table, i.e. a missing migration looked like a successful
//   quote. Now: schema + migration + runtime agree, and BOTH paths fail closed
//   with explicit, distinguishable codes.
//
// F-7 root cause under test
//   `shipping_rates.freeThreshold` is denominated in the RATE ROW's currency
//   (schema comment: "Subtotal in rate currency for free shipping"; the seeded
//   GB row is 100 with currency GBP) and the static fallback table is
//   denominated in the destination display currency — but the quote path
//   compared those numbers against the GHS cart subtotal with no conversion,
//   while the booking path converted to GHS first. So quote(GB,100) answered
//   isFree:true (100 GHS >= 100 GBP read as plain numbers) and order creation
//   charged 222.22 GHS for the same cart. Both paths now normalize the
//   threshold to GHS through one shared `toGHS()` helper.
//
// These tests FAIL if the quote path ever compares a foreign-currency
// threshold directly with a GHS subtotal (see the "F-7 regression" block).
//
// DB-backed. Skips without MySQL. Never runs against TiDB: the destructive
// schema cases and the executed-migration cases additionally refuse when
// DB_HOST points at TiDB Cloud, so this suite cannot touch the shared DB.
// No payment-provider calls are made anywhere.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);

process.env.EMAIL_DISABLED = process.env.EMAIL_DISABLED || '1';
process.env.REDIS_URL = process.env.REDIS_URL ?? '';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(BACKEND_ROOT, '..');
// Paths are given relative to backend/ (a leading ../ is tolerated because
// sibling suites address migrations that way).
const read = (rel) => readFileSync(path.join(BACKEND_ROOT, rel.replace(/^(\.\.\/)+/, '')), 'utf8');

const HOST = process.env.DB_HOST || '';
// Destructive/schema-executing cases are refused against TiDB Cloud — the
// shared dev database is off limits by the working rules.
const isTiDB = /tidbcloud\.com/i.test(HOST);

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const runOk = dbAvailable;
const runSchema = dbAvailable && !isTiDB;

const ts = Date.now();
const MARK = `FINFXT-${ts}`; // orders.notes marker so cleanup is scoped to us
// Disposable schema owned by THIS suite: the executed-migration cases and the
// missing-table probes run here, so they can never disturb other suites (or
// the shared dev database) while `node --test` runs files in parallel.
const SCRATCH = 'finaud_fresh_mig';
let scratchReady = false;
const state = {
  customer: null,
  vendorA: null, // GB + GH eligible
  vendorB: null, // GB + GH eligible
  vendorC: null, // GH only — must NOT sell into GB
  prodA: null,
  prodB: null,
  prodC: null,
  gbRateId: null, // seeded GH->GB platform rate row (currency GBP)
  ghsGbpRow: null, // original exchange_rates GHS->GBP row (restored in finally)
};

const addrGH = {
  countryCode: 'GH', firstName: 'Kwame', lastName: 'Asante',
  email: 'kwame@example.com', phone: '0241234567',
  address: '123 Oxford Street', city: 'Accra', region: 'Greater Accra',
};
const addrGB = {
  countryCode: 'GB', firstName: 'Ama', lastName: 'Mensah',
  email: 'ama@example.com', phone: '+442071234567',
  address: '10 Downing Street', addressLine1: '10 Downing Street',
  city: 'London', postalCode: 'SW1A 1AA',
};
const addrUS = {
  countryCode: 'US', firstName: 'Ama', lastName: 'Mensah',
  email: 'ama@example.com', phone: '12025550123',
  address: '1600 Pennsylvania Avenue', addressLine1: '1600 Pennsylvania Avenue',
  city: 'Washington', state: 'DC', zipCode: '20500', postalCode: '20500',
};

// ---------------------------------------------------------------------------
// Fixture helpers (disposable rows, MARK-scoped cleanup)
// ---------------------------------------------------------------------------
const cleanup = async (label, sql, params) => {
  try {
    await pool.execute(sql, params);
  } catch (err) {
    console.warn(` finFxThreshold cleanup (${label}) skipped: ${err.message}`);
  }
};

const mkUser = async (role, tag) => {
  const [u] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('FINFXT', ?, ?, 'hashed', ?, 1, 1)`,
    [tag, `finfxt-${tag}-${ts}@test.local`, role]
  );
  return u.insertId;
};

const mkVendor = async (tag, destinations) => {
  const userId = await mkUser('vendor', tag);
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode)
     VALUES (?, ?, 'approved', ?)`,
    [userId, `FINFXT Vendor ${tag} ${ts}`, `RCP_${tag}${ts}`]
  );
  for (const [countryCode, region] of destinations) {
    await pool.execute(
      `INSERT INTO vendor_shipping_destinations (vendorId, countryCode, region, isActive)
       VALUES (?, ?, ?, TRUE)`,
      [userId, countryCode, region]
    );
  }
  return userId;
};

const mkProduct = async (vendorId, price, tag) => {
  const [r] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, 'finfxt', 1000, ?, 0, 'approved')`,
    [`FINFXT ${tag} ${ts}`, '/uploads/test.png', price, vendorId]
  );
  return r.insertId;
};

/** Drive the real quote endpoint with a minimal req/res double. */
const quote = async (body) => {
  const controller = await import('../controllers/internationalCheckoutController.js');
  let status = 200;
  let json = null;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { json = payload; return this; },
  };
  await controller.getShippingOptions({ body }, res);
  return { status, body: json };
};

/** Server-authoritative booked shipping (order-creation path). */
const book = async ({ destinationCountry, subtotal, items = [{ productId: 1, qty: 1 }] }) => {
  const { getChargeableShippingGHS } = await import('../Services/shippingService.js');
  return getChargeableShippingGHS({ destinationCountry, items, subtotal });
};

/** Drive the real order-creation controller with a minimal req/res double. */
const placeOrder = async ({ products, address, notes = MARK }) => {
  const { addOrderItems } = await import('../controllers/orderController.js');
  let status = 200;
  let body = null;
  const req = {
    user: { id: state.customer, role: 'customer' },
    body: {
      items: products.map((product) => ({ product, quantity: 1 })),
      shippingAddress: address,
      paymentMethod: 'pending',
      notes,
    },
  };
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await addOrderItems(req, res);
  return { status, body, orderId: body?.order?.id ?? null };
};

/** Drive the real order-update controller (address sync / guards). */
const putOrder = async (orderId, body, user = { id: state.customer, role: 'customer' }) => {
  const { updateOrder } = await import('../controllers/orderController.js');
  let status = 200;
  let json = null;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { json = payload; return this; },
  };
  await updateOrder({ params: { id: String(orderId) }, user, body }, res);
  return { status, body: json };
};

/** mysql2 hands JSON columns back as objects (tests run against MySQL). */
const asObj = (value) =>
  (typeof value === 'string' ? JSON.parse(value) : value);

const orderRow = async (orderId) => {
  const [[row]] = await pool.execute(
    `SELECT id, shippingCost, totalAmount, tax, discount, paymentStatus, paymentReference,
            shippingAddress, items, notes
       FROM orders WHERE id = ?`,
    [orderId]
  );
  return row;
};

before(async () => {
  if (!runOk) return;

  state.customer = await mkUser('customer', 'customer');
  state.vendorA = await mkVendor('a', [['GB', null], ['GH', null]]);
  state.vendorB = await mkVendor('b', [['GB', null], ['GH', null]]);
  state.vendorC = await mkVendor('c', [['GH', null]]);
  state.prodA = await mkProduct(state.vendorA, 100.0, 'A');
  state.prodB = await mkProduct(state.vendorB, 50.0, 'B');
  state.prodC = await mkProduct(state.vendorC, 75.0, 'C');

  const [[gbRate]] = await pool.execute(
    `SELECT id FROM shipping_rates
      WHERE originCountry='GH' AND destinationCountry='GB' AND vendorId IS NULL
      ORDER BY id LIMIT 1`
  );
  state.gbRateId = gbRate?.id ?? null;

  const [[ghsGbp]] = await pool.execute(
    `SELECT id, rate, effectiveDate FROM exchange_rates
      WHERE baseCurrency='GHS' AND targetCurrency='GBP' ORDER BY effectiveDate DESC LIMIT 1`
  );
  state.ghsGbpRow = ghsGbp ?? null;
});

after(async () => {
  if (!runOk || !pool) return;
  try {
    for (const t of [
      'authenticity_certificates', 'escrow_allocations', 'return_requests',
      'buyback_requests', 'order_vendor_marks', 'vendor_order_fulfillment',
      'vendor_order_items', 'order_items', 'stock_moves', 'financial_events',
    ]) {
      await cleanup(t, `DELETE FROM ${t} WHERE orderId IN (SELECT id FROM orders WHERE notes LIKE ?)`, [`${MARK}%`]);
    }
    await cleanup('orders', `DELETE FROM orders WHERE notes LIKE ?`, [`${MARK}%`]);
    await cleanup('product', `DELETE FROM product WHERE id IN (?, ?, ?)`,
      [state.prodA, state.prodB, state.prodC]);
    for (const v of [state.vendorA, state.vendorB, state.vendorC].filter(Boolean)) {
      await cleanup('vsd', `DELETE FROM vendor_shipping_destinations WHERE vendorId = ?`, [v]);
      await cleanup('vendors', `DELETE FROM vendors WHERE userId = ?`, [v]);
    }
    const userIds = [state.customer, state.vendorA, state.vendorB, state.vendorC].filter(Boolean);
    if (userIds.length) {
      await cleanup('users', `DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
    }
    // Any rate/row this suite moved is restored to its original value.
    if (state.ghsGbpRow) {
      await cleanup('fx', `DELETE FROM exchange_rates WHERE baseCurrency='GHS' AND targetCurrency='GBP'`, []);
      await pool.execute(
        `INSERT INTO exchange_rates (baseCurrency, targetCurrency, rate, source, effectiveDate)
         VALUES ('GHS', 'GBP', ?, 'manual', ?)`,
        [state.ghsGbpRow.rate, state.ghsGbpRow.effectiveDate]
      ).catch((err) => console.warn(` finFxThreshold fx restore skipped: ${err.message}`));
    }
    // Drop the suite-owned scratch schema last.
    if (runSchema) {
      try {
        const mysql = (await import('mysql2/promise')).default;
        const conn = await mysql.createConnection({
          host: process.env.DB_HOST,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD || '',
          port: process.env.DB_PORT || 3306,
        });
        await conn.query(`DROP DATABASE IF EXISTS \`${SCRATCH}\``);
        await conn.end();
      } catch (err) {
        console.warn(` finFxThreshold scratch drop skipped: ${err.message}`);
      }
    }
  } finally {
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// 1. Schema / migration agreement (F-6)
// ===========================================================================
describe('F-6: schema, migration and runtime queries agree', () => {
  const dump = readFileSync(path.join(REPO_ROOT, 'branding_house.sql'), 'utf8');

  test('the canonical schema creates exchange_rates (dump-only installs get FX)', () => {
    assert.match(dump, /CREATE TABLE IF NOT EXISTS exchange_rates \(/,
      'branding_house.sql must create exchange_rates — otherwise a database built from the canonical schema cannot quote international shipping');
    for (const col of ['baseCurrency', 'targetCurrency', 'rate', 'source', 'effectiveDate']) {
      assert.ok(dump.includes(col), `exchange_rates.${col} must be in the canonical schema`);
    }
    assert.match(dump, /UNIQUE KEY uq_exchange_rate \(baseCurrency, targetCurrency, effectiveDate\)/,
      'the schema must keep the uniqueness that makes rate lookups deterministic');
  });

  test('the canonical schema creates the shipping tables the runtime queries', () => {
    for (const t of ['shipping_carriers', 'shipping_rates', 'vendor_shipping_destinations']) {
      assert.match(dump, new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`),
        `branding_house.sql must create ${t}`);
    }
  });

  test('dump DDL and migration DDL define the same columns', () => {
    // The two sources must not drift: parse the migration file's CREATE for
    // exchange_rates and require every column it declares to exist in the dump.
    const migration = read('../migrateExchangeRates.js');
    const ddl = migration.match(/CREATE TABLE IF NOT EXISTS exchange_rates \(([\s\S]*?)\)\s*ENGINE=/);
    assert.ok(ddl, 'migrateExchangeRates.js must keep its CREATE TABLE');
    const columns = [...ddl[1].matchAll(/^\s*([A-Za-z]+)\s+(?:INT|CHAR|VARCHAR|DATE|DECIMAL|TIMESTAMP)/gm)]
      .map((m) => m[1]);
    assert.ok(columns.length >= 6, 'expected the exchange_rates column set');
    for (const col of columns) {
      assert.ok(new RegExp(`\\b${col}\\b`).test(dump),
        `exchange_rates.${col} exists in the migration but not in branding_house.sql`);
    }
    assert.ok(!/DROP TABLE/i.test(migration.split('const down')[0]),
      'the up() migration must never drop existing data');
  });

  test('both migrations are wired into the db:migrate chain, in order', () => {
    const scripts = JSON.parse(read('../package.json')).scripts;
    const chain = scripts['db:migrate'];
    const idxExchange = chain.indexOf('migrateExchangeRates.js');
    const idxShipping = chain.indexOf('migrateShippingCarriersRates.js');
    const idxVsd = chain.indexOf('migrateVendorShippingDestinations.js');
    assert.ok(idxExchange > 0, 'migrateExchangeRates.js must be in db:migrate');
    assert.ok(idxShipping > idxExchange, 'shipping tables must be created after exchange_rates');
    assert.ok(idxVsd > idxShipping, 'vendor destinations must follow the shipping tables');
    assert.ok(chain.indexOf('migrateTermsVersion.js') < idxExchange,
      'migrations must keep their historical ordering (append, never reorder)');
  });

  test('seeding is seed-once: a repeated migration cannot restack or shadow rates', () => {
    const fx = read('../migrateExchangeRates.js');
    assert.match(fx, /SELECT COUNT\(\*\) AS n FROM exchange_rates/,
      'exchange_rates seeding must be guarded by a row count');
    assert.match(fx, /seeding skipped/, 'a re-run must report that it seeded nothing');
    // Re-inserting on a later date would add a row dated TODAY, which every
    // lookup (`effectiveDate <= today ORDER BY DESC`) would pick over the
    // operator's curated row — a silent repricing.
    assert.ok(!/INSERT IGNORE INTO exchange_rates[\s\S]{0,400}const today = new Date\(\)/.test(fx),
      'seed values must not be re-dated to the day of the re-run');

    const rates = read('../migrateShippingCarriersRates.js');
    assert.match(rates, /WHERE vendorId IS NULL/,
      'shipping_rates seeding must be guarded by the platform row count');
    assert.match(rates, /seeding skipped/, 'a re-run must report that it seeded nothing');
    // shipping_rates has no unique key on the lane, so INSERT IGNORE cannot
    // dedupe: without the count guard every run stacked 6 more rows.
    assert.ok(!/UNIQUE KEY[^;]*\(originCountry, destinationCountry/i.test(dump),
      'shipping_rates still has no lane unique key — the count guard is load-bearing');
  });

  test('the quote path never falls back when the migration is missing', () => {
    const svc = read('../Services/shippingService.js');
    // The static fallback must be reachable only from the "no rows for this
    // lane" branch; a missing table must map to SHIPPING_TABLES_MISSING.
    assert.match(svc, /isMissingTableError/);
    assert.match(svc, /SHIPPING_TABLES_MISSING/);
    const fallbackCall = svc.match(/if \(rates\.length === 0\) \{[\s\S]{0,200}?getFallbackOptions/);
    assert.ok(fallbackCall, 'the fallback is only used when the tables exist but hold no rows');
  });
});

test('live schema: exchange_rates exists with the columns the queries read', { skip: !runOk }, async () => {
  const [cols] = await pool.query(
    `SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'exchange_rates'`
  );
  const have = new Set(cols.map((/** @type {any} */ r) => String(r.c).toLowerCase()));
  for (const c of ['basecurrency', 'targetcurrency', 'rate', 'source', 'effectivedate']) {
    assert.ok(have.has(c), `exchange_rates.${c} missing on this database`);
  }
  const [idx] = await pool.query(
    `SELECT index_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'exchange_rates'`
  );
  assert.ok(idx.length > 0, 'exchange_rates must be indexed for rate lookups');
});

// ===========================================================================
// 2. Executed migration: clean database, then repeated (F-6 / reqs 1-4)
// ===========================================================================
describe('F-6: the migration runs on a clean MySQL database and is re-runnable', () => {
  const runChain = async (dbName) => {
    const scripts = JSON.parse(read('../package.json')).scripts['db:migrate'];
    const steps = scripts.split('&&').map((s) => s.trim()).filter(Boolean);
    for (const step of steps) {
      const [bin, ...args] = step.split(/\s+/);
      assert.equal(bin, 'node', `unexpected step: ${step}`);
      await execFileAsync(process.execPath, args, {
        cwd: BACKEND_ROOT,
        env: {
          ...process.env,
          DB_NAME: dbName,
          DB_HOST: process.env.DB_HOST,
          DB_PORT: process.env.DB_PORT,
          DB_USER: process.env.DB_USER,
          DB_PASSWORD: process.env.DB_PASSWORD || '',
          DB_SSL: process.env.DB_SSL ?? '',
          REDIS_URL: '',
          EMAIL_DISABLED: '1',
        },
        timeout: 240000,
      });
    }
    return steps.length;
  };

  const createSchemaFromDump = async (dbName) => {
    const mysql = (await import('mysql2/promise')).default;
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT || 3306,
      multipleStatements: true,
    });
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await conn.query(`CREATE DATABASE \`${dbName}\``);
      // The dump hardcodes branding_house (setupDB.js relies on it); a
      // disposable staging schema is created by retargeting that name — the
      // exact thing `npm run db:setup` does for the canonical name.
      const sql = readFileSync(path.join(REPO_ROOT, 'branding_house.sql'), 'utf8')
        .split('branding_house').join(dbName);
      await conn.query(sql);
    } finally {
      await conn.end();
    }
  };

  const showCreate = async (dbName, table) => {
    const mysql = (await import('mysql2/promise')).default;
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT || 3306,
      database: dbName,
    });
    try {
      const [[row]] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
      // AUTO_INCREMENT advances as rows are seeded; the space it leaves
      // behind is not a structural difference, so compare structure.
      return JSON.stringify(row)
        .replace(/AUTO_INCREMENT=\d+/g, '')
        .replace(/\s+/g, ' ');
    } finally {
      await conn.end();
    }
  };

  const counts = async (dbName, table) => {
    const mysql = (await import('mysql2/promise')).default;
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT || 3306,
      database: dbName,
    });
    try {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      return Number(row.n);
    } finally {
      await conn.end();
    }
  };

  test('fresh schema + full db:migrate chain creates and seeds the FX tables', { skip: !runSchema, timeout: 600000 }, async () => {
    await createSchemaFromDump(SCRATCH);
    const beforeDump = await showCreate(SCRATCH, 'exchange_rates');

    const steps = await runChain(SCRATCH);
    assert.ok(steps >= 20, `expected the full migration chain, got ${steps} steps`);

    // The schema exists now: the missing-table probes later in this file run
    // against it (set before the assertions below so they still run if one fails).
    scratchReady = true;

    assert.equal(await counts(SCRATCH, 'exchange_rates'), 5, 'seeded FX rows expected');
    assert.equal(await counts(SCRATCH, 'shipping_carriers'), 5, 'seeded carriers expected');
    assert.equal(await counts(SCRATCH, 'shipping_rates'), 6, 'seeded platform rates expected');

    // Existing-schema fixture: the migration must not have restructured the
    // table the dump already provided (no duplicate/second definition).
    const afterDump = await showCreate(SCRATCH, 'exchange_rates');
    assert.equal(afterDump, beforeDump,
      'migrateExchangeRates must be additive: the dump-created table must be untouched');
  });

  test('running the full chain a second time changes nothing (idempotent)', { skip: !runSchema, timeout: 600000 }, async () => {
    const before = {
      exchange: await counts(SCRATCH, 'exchange_rates'),
      rates: await counts(SCRATCH, 'shipping_rates'),
      carriers: await counts(SCRATCH, 'shipping_carriers'),
      vsd: await counts(SCRATCH, 'vendor_shipping_destinations'),
    };
    await runChain(SCRATCH);
    const after = {
      exchange: await counts(SCRATCH, 'exchange_rates'),
      rates: await counts(SCRATCH, 'shipping_rates'),
      carriers: await counts(SCRATCH, 'shipping_carriers'),
      vsd: await counts(SCRATCH, 'vendor_shipping_destinations'),
    };
    assert.deepEqual(after, before,
      `repeated migration must not stack rows (was ${JSON.stringify(before)}, now ${JSON.stringify(after)})`);
  });
});

// ===========================================================================
// 3. FX lookup semantics (F-6 reqs 5-9)
// ===========================================================================
describe('F-6: exchange-rate lookup is explicit, distinguishable and fail-closed', () => {
  test('direct rate lookup returns the seeded row', { skip: !runOk }, async () => {
    const { getExchangeRate } = await import('../Services/shippingService.js');
    const rate = await getExchangeRate('GHS', 'GBP');
    assert.equal(typeof rate, 'number');
    assert.ok(rate > 0 && rate < 1, `expected the seeded GHS->GBP rate, got ${rate}`);
    assert.notEqual(rate, 1, 'a cross-currency pair must never resolve to parity by accident');
  });

  test('inverse lookup derives GBP->GHS from the GHS->GBP seed', { skip: !runOk }, async () => {
    const { getExchangeRate, getExchangeRateWithInverse } = await import('../Services/shippingService.js');
    const direct = await getExchangeRate('GHS', 'GBP');
    const inverse = await getExchangeRateWithInverse('GBP', 'GHS');
    assert.ok(inverse !== null, 'inverse derivation must be supported');
    assert.ok(Math.abs(inverse - 1 / direct) < 1e-9,
      `expected 1/${direct}, got ${inverse}`);
  });

  test('an unsupported currency pair is null (no invented rate)', { skip: !runOk }, async () => {
    const { getExchangeRate, getExchangeRateWithInverse } = await import('../Services/shippingService.js');
    assert.equal(await getExchangeRate('GHS', 'JPY'), null);
    assert.equal(await getExchangeRateWithInverse('JPY', 'GHS'), null);
  });

  test('a missing rate row fails the quote AND the booking with 502, never parity', { skip: !runOk }, async () => {
    const original = { rate: state.ghsGbpRow?.rate, effectiveDate: state.ghsGbpRow?.effectiveDate };
    try {
      await pool.execute(`DELETE FROM exchange_rates WHERE baseCurrency='GHS' AND targetCurrency='GBP'`);

      const q = await quote({ countryCode: 'GB', subtotal: 100 });
      assert.equal(q.status, 502, `quote must fail closed, got ${q.status}`);
      assert.equal(q.body.code, 'SHIPPING_FX_UNAVAILABLE');
      assert.equal(q.body.supported, false);

      const b = await book({ destinationCountry: 'GB', subtotal: 100 });
      assert.equal(b.ok, false, 'booking must refuse instead of converting at parity');
      assert.equal(b.code, 'SHIPPING_FX_UNAVAILABLE');
      assert.equal(b.status, 502);
    } finally {
      await pool.execute(
        `INSERT INTO exchange_rates (baseCurrency, targetCurrency, rate, source, effectiveDate)
         VALUES ('GHS', 'GBP', ?, 'manual', ?)`,
        [original.rate, original.effectiveDate]
      );
    }
  });

  test('an invalid stored rate (0) fails closed rather than zeroing or defaulting', { skip: !runOk }, async () => {
    const original = { rate: state.ghsGbpRow?.rate, effectiveDate: state.ghsGbpRow?.effectiveDate };
    try {
      await pool.execute(
        `UPDATE exchange_rates SET rate = 0 WHERE baseCurrency='GHS' AND targetCurrency='GBP'`
      );
      const q = await quote({ countryCode: 'GB', subtotal: 100 });
      assert.equal(q.status, 502);
      assert.equal(q.body.code, 'SHIPPING_FX_UNAVAILABLE');

      const b = await book({ destinationCountry: 'GB', subtotal: 100 });
      assert.equal(b.ok, false);
      assert.equal(b.code, 'SHIPPING_FX_UNAVAILABLE');
    } finally {
      await pool.execute(
        `UPDATE exchange_rates SET rate = ? WHERE baseCurrency='GHS' AND targetCurrency='GBP'`,
        [original.rate]
      );
    }
  });

  test('a stale rate still quotes (availability first) but is flagged, not hidden', { skip: !runOk }, async () => {
    const original = state.ghsGbpRow?.effectiveDate;
    try {
      await pool.execute(
        `UPDATE exchange_rates SET effectiveDate = DATE_SUB(CURDATE(), INTERVAL 200 DAY)
          WHERE baseCurrency='GHS' AND targetCurrency='GBP'`
      );
      const q = await quote({ countryCode: 'GB', subtotal: 100 });
      assert.equal(q.status, 200, 'a stale rate is a warning, not an outage');
      assert.ok(Array.isArray(q.body.warnings));
      assert.ok(q.body.warnings.includes('STALE_EXCHANGE_RATE'),
        `expected a staleness warning, got ${JSON.stringify(q.body.warnings)}`);

      const b = await book({ destinationCountry: 'GB', subtotal: 100 });
      assert.equal(b.ok, true);
      assert.equal(b.staleRate, true, 'the booking path must flag the stale rate too');
    } finally {
      await pool.execute(
        `UPDATE exchange_rates SET effectiveDate = ? WHERE baseCurrency='GHS' AND targetCurrency='GBP'`,
        [original]
      );
    }
  });

  test('an unsupported rate row currency fails closed on the quote path', { skip: !runOk }, async () => {
    // A JPY-denominated row on the GH lane: there is no JPY<->GHS seed, so
    // neither quoting nor booking may fall back to 1:1.
    let inserted = null;
    try {
      const [[carrier]] = await pool.execute(
        `SELECT id FROM shipping_carriers WHERE code='local_gh' LIMIT 1`
      );
      const [r] = await pool.execute(
        `INSERT INTO shipping_rates
           (carrierId, vendorId, originCountry, destinationCountry, destinationRegion, serviceLevel,
            minWeightKg, maxWeightKg, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax,
            currency, effectiveFrom, isActive)
         VALUES (?, NULL, 'GH', 'GH', NULL, 'standard', 0, 30, 500, 0, 5000, 2, 5, 'JPY', ?, TRUE)`,
        [carrier.id, new Date().toISOString().split('T')[0]]
      );
      inserted = r.insertId;

      const q = await quote({ countryCode: 'GH', subtotal: 100 });
      assert.equal(q.status, 502, `unsupported pair must fail closed, got ${q.status}`);
      assert.equal(q.body.code, 'SHIPPING_FX_UNAVAILABLE');

      const b = await book({ destinationCountry: 'GH', subtotal: 100 });
      assert.equal(b.ok, false);
      assert.equal(b.code, 'SHIPPING_FX_UNAVAILABLE');
    } finally {
      if (inserted) await pool.execute(`DELETE FROM shipping_rates WHERE id = ?`, [inserted]);
    }
  });
});

// ===========================================================================
// 4. Missing tables (F-6 reqs 5, 8, 9) — both paths, explicit and leak-free
// ===========================================================================
describe('F-6: a missing migration is explicit on BOTH paths, never a fake success', () => {
  // The probe renames ONE table aside in the suite-owned scratch schema,
  // exercises the real quote endpoint and the real booking service, restores
  // the table in a finally, and reports what happened. Running it in a
  // subprocess keeps the window invisible to the other suites that share the
  // main test database.
  const runProbe = async (table) => {
    assert.ok(scratchReady, 'the migration block must run first (it owns the scratch schema)');
    const probe = path.join(__dirname, 'helpers', 'intlMissingTableProbe.mjs');
    const { stdout } = await execFileAsync(process.execPath, [probe, table], {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        DB_NAME: SCRATCH,
        REDIS_URL: '',
        EMAIL_DISABLED: '1',
      },
      timeout: 120000,
    });
    const line = stdout.split('\n').find((l) => l.startsWith('PROBE_RESULT '));
    assert.ok(line, `probe produced no result line:\n${stdout}`);
    return JSON.parse(line.slice('PROBE_RESULT '.length));
  };

  const expectMissing = async (table) => {
    const out = await runProbe(table);
    assert.equal(out.restored, true, `${table} must be restored after the probe`);

    assert.equal(out.quote.status, 503, `${table}: quote must refuse, got ${out.quote.status}`);
    assert.equal(out.quote.body.code, 'SHIPPING_TABLES_MISSING');
    assert.equal(out.quote.body.supported, false);
    assert.deepEqual(out.quote.body.options, [],
      `${table}: no options may be quoted without the migration`);

    assert.equal(out.booking.ok, false, `${table}: booking must refuse`);
    assert.equal(out.booking.code, 'SHIPPING_TABLES_MISSING');
    assert.equal(out.booking.status, 503);

    // req: database errors must not reach the customer.
    const raw = JSON.stringify(out.quote.body) + JSON.stringify(out.booking);
    for (const leak of ['ER_NO_SUCH_TABLE', "doesn't exist", 'SELECT ', SCRATCH]) {
      assert.ok(!raw.includes(leak), `${table}: response leaked "${leak}" -> ${raw}`);
    }
  };

  test('missing exchange_rates table -> 503 SHIPPING_TABLES_MISSING on both paths', { skip: !runSchema }, async () => {
    await expectMissing('exchange_rates');
  });

  test('missing shipping_rates table -> 503, not the static fallback table', { skip: !runSchema }, async () => {
    await expectMissing('shipping_rates');
  });

  test('missing vendor_shipping_destinations table -> 503 on the vendor-eligible path', { skip: !runSchema }, async () => {
    const out = await runProbe('vendor_shipping_destinations');
    // The controller-level quote (no vendor named in the cart) does not touch
    // the table — that is fine. The vendor-eligible branch must refuse.
    assert.equal(out.vendorQuote.status, 503,
      `vendor-eligible quote must refuse, got ${out.vendorQuote.status}`);
    assert.equal(out.vendorQuote.body.code, 'SHIPPING_TABLES_MISSING');
    assert.equal(out.vendorQuote.body.supported, false);
    assert.deepEqual(out.vendorQuote.body.options, []);
    // req: database errors must not reach the customer.
    const raw = JSON.stringify(out.vendorQuote.body);
    for (const leak of ['ER_NO_SUCH_TABLE', "doesn't exist", 'SELECT ', SCRATCH]) {
      assert.ok(!raw.includes(leak), `vendor-eligible quote leaked "${leak}" -> ${raw}`);
    }
    // checkVendorDestination itself must reject rather than answer `false`
    // (a false would be reported as "this vendor does not ship to GB", which
    // blames the vendor for the operator's missing migration).
    assert.ok(out.eligibility, 'eligibility probe missing');
    assert.equal(out.eligibility.ok, false, 'eligibility must raise, not answer');
    assert.equal(out.eligibility.code, 'ER_NO_SUCH_TABLE');
  });

  test('the missing-table mapping is shared by quote and booking (no divergence)', () => {
    const svc = read('../Services/shippingService.js');
    assert.match(svc, /logMissingTable\(err\);[\s\S]{0,200}?tablesMissingResult\(destinationCountry, currency\)/,
      'the quote path must map a missing table itself, before the controller sees it');
    assert.match(svc, /isMissingTableError\(err\)[\s\S]{0,300}?SHIPPING_TABLES_MISSING/);
    const ctrl = read('../controllers/internationalCheckoutController.js');
    assert.match(ctrl, /isMissingTableError\(error\)/,
      'the controller must also map a missing table (defense in depth)');
    assert.match(ctrl, /SHIPPING_QUOTE_FAILED/,
      'any other failure must be a generic code, never driver text');
  });
});

// ===========================================================================
// 5. F-7: quote and booking apply ONE rule in ONE currency
// ===========================================================================
describe('F-7: free-shipping threshold is compared in GHS everywhere', () => {
  test('the quote reports the threshold it actually compared (GHS + source)', { skip: !runOk }, async () => {
    const q = await quote({ countryCode: 'GB', subtotal: 100 });
    assert.equal(q.status, 200);
    const opt = q.body.options.find((/** @type {any} */ o) => o.serviceLevel === 'standard')
      ?? q.body.options[0];
    assert.equal(opt.rateCurrency, 'GBP', 'the source currency must be explicit');
    assert.equal(opt.freeThreshold, 100, 'stored threshold is in the rate currency');
    assert.ok(opt.freeThresholdGHS > 1000,
      `the compared threshold must be the GHS figure, got ${opt.freeThresholdGHS}`);
    assert.ok(Math.abs(opt.freeThresholdGHS - 100 / 0.054) < 0.01,
      `expected 100 GBP in GHS, got ${opt.freeThresholdGHS}`);
  });

  test('F-7 regression: a GHS subtotal is never compared raw with a GBP threshold', { skip: !runOk }, async () => {
    // If the quote path regresses to `subtotal >= freeThreshold`, 100 >= 100
    // (GBP) would report free shipping while order creation charges 222.22 GHS.
    const q = await quote({ countryCode: 'GB', subtotal: 100 });
    const opt = q.body.options[0];
    assert.equal(opt.isFree, false, '100 GHS is NOT above a 100 GBP threshold');
    assert.ok(opt.amountGHS > 0, 'shipping must still be quoted in GHS');

    // Same trap one order of magnitude later: 1800 GHS clears a raw "100"
    // threshold but is far below 100 GBP (~1851.85 GHS).
    const q2 = await quote({ countryCode: 'GB', subtotal: 1800 });
    assert.equal(q2.body.options[0].isFree, false,
      '1800 GHS must not trip a threshold that is denominated in GBP');
    assert.ok(q2.body.options[0].freeThresholdGHS > 1800,
      'the compared threshold must exceed the subtotal that failed');
  });

  test('quote isFree always equals booking isFree (sweep across the boundary)', { skip: !runOk }, async () => {
    const q0 = await quote({ countryCode: 'GB', subtotal: 10000 });
    const thresholdGHS = q0.body.options[0].freeThresholdGHS;
    const sweep = [100, 900, 1800, thresholdGHS - 0.01, thresholdGHS, thresholdGHS + 0.01, 5000];
    for (const subtotal of sweep) {
      const q = await quote({ countryCode: 'GB', subtotal });
      const b = await book({ destinationCountry: 'GB', subtotal });
      const quoteOpt = q.body.options[0];
      assert.equal(typeof b.ok, 'boolean');
      assert.equal(quoteOpt.isFree, b.isFree,
        `disagree at subtotal=${subtotal}: quote=${quoteOpt.isFree} booking=${b.isFree}`);
      assert.equal(quoteOpt.amountGHS, b.amountGHS,
        `amount mismatch at subtotal=${subtotal}: quote=${quoteOpt.amountGHS} booking=${b.amountGHS}`);
    }
  });

  test('threshold boundary: below / exactly at / above', { skip: !runOk }, async () => {
    const q = await quote({ countryCode: 'GB', subtotal: 1 });
    const thresholdGHS = q.body.options[0].freeThresholdGHS;

    const below = await quote({ countryCode: 'GB', subtotal: thresholdGHS - 0.01 });
    const at = await quote({ countryCode: 'GB', subtotal: thresholdGHS });
    const above = await quote({ countryCode: 'GB', subtotal: thresholdGHS + 0.01 });
    assert.equal(below.body.options[0].isFree, false, 'just below must be chargeable');
    assert.equal(at.body.options[0].isFree, true, 'exactly at the threshold must be free');
    assert.equal(above.body.options[0].isFree, true, 'above the threshold must be free');

    const bookAt = await book({ destinationCountry: 'GB', subtotal: thresholdGHS });
    const bookBelow = await book({ destinationCountry: 'GB', subtotal: thresholdGHS - 0.01 });
    assert.equal(bookAt.isFree, true, 'booking must agree at the boundary');
    assert.equal(bookBelow.isFree, false, 'booking must agree below the boundary');
  });

  test('the static-fallback lane converts its display-currency threshold to GHS too', { skip: !runOk }, async () => {
    // Force the "tables exist, no rows for this lane" branch — the only place
    // the documented fallback table is allowed to answer. Its numbers are in
    // the destination DISPLAY currency (CAD for CA) and must be converted to
    // GHS before they are compared with the GHS subtotal.
    const [saved] = await pool.execute(`SELECT * FROM shipping_rates WHERE destinationCountry='CA'`);
    assert.ok(saved.length > 0, 'expected seeded CA rows to restore afterwards');
    const cols = Object.keys(saved[0]);
    const restoreRows = async () => {
      await pool.execute(`DELETE FROM shipping_rates WHERE destinationCountry='CA'`);
      for (const row of saved) {
        await pool.execute(
          `INSERT INTO shipping_rates (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => row[c])
        );
      }
    };
    try {
      await pool.execute(`DELETE FROM shipping_rates WHERE destinationCountry='CA'`);

      const q = await quote({ countryCode: 'CA', subtotal: 100 });
      assert.equal(q.status, 200, JSON.stringify(q.body));
      const opt = q.body.options[0];
      assert.equal(opt.carrier, 'platform_default', 'fallback lane expected');
      assert.equal(opt.rateCurrency, 'CAD', 'the fallback table is in the display currency');
      assert.equal(opt.amount, 20, 'display figure unchanged');
      assert.ok(Math.abs(opt.freeThresholdGHS - 180 / 0.092) < 0.01,
        `fallback threshold must be converted to GHS, got ${opt.freeThresholdGHS}`);
      assert.equal(opt.isFree, false, '100 GHS must not clear a CAD threshold');

      const b = await book({ destinationCountry: 'CA', subtotal: 100 });
      assert.equal(b.ok, true, JSON.stringify(b));
      assert.equal(b.isFree, opt.isFree, 'fallback quote and booking must agree');
      assert.equal(b.amountGHS, opt.amountGHS, 'fallback amounts must agree to the pesewa');

      const atThreshold = opt.freeThresholdGHS;
      const qFree = await quote({ countryCode: 'CA', subtotal: atThreshold });
      const bFree = await book({ destinationCountry: 'CA', subtotal: atThreshold });
      assert.equal(qFree.body.options[0].isFree, true, 'free exactly at the converted threshold');
      assert.equal(bFree.isFree, true, 'booking agrees at the converted threshold');
    } finally {
      await restoreRows();
    }
  });

  test('domestic Ghana is unchanged (GH₵15, free at 200 GHS)', { skip: !runOk }, async () => {
    const q = await quote({ countryCode: 'GH', subtotal: 100 });
    assert.equal(q.status, 200);
    const opt = q.body.options[0];
    assert.equal(opt.rateCurrency, 'GHS');
    assert.equal(opt.freeThreshold, 200);
    assert.equal(opt.freeThresholdGHS, 200, 'no conversion for the charge currency itself');
    assert.equal(opt.isFree, false);
    assert.equal(opt.amount, 15);
    assert.equal(opt.amountGHS, 15);

    const b = await book({ destinationCountry: 'GH', subtotal: 100 });
    assert.equal(b.ok, true);
    assert.equal(b.amountGHS, 15);
    assert.equal(b.isFree, false);

    const free = await quote({ countryCode: 'GH', subtotal: 200 });
    assert.equal(free.body.options[0].isFree, true, 'GH threshold boundary is unchanged');
    const freeBook = await book({ destinationCountry: 'GH', subtotal: 200 });
    assert.equal(freeBook.isFree, true);
  });

  test('display currency never leaks into the comparison', { skip: !runOk }, async () => {
    // GB display amounts stay in GBP; the compared figures are GHS.
    const q = await quote({ countryCode: 'GB', subtotal: 100 });
    const opt = q.body.options[0];
    assert.equal(opt.currency, 'GBP', 'display currency is unchanged');
    assert.equal(opt.amount, 12, 'display amount is the GBP figure');
    assert.equal(opt.amountGHS, 222.22, 'charge figure is the GHS figure');
    assert.equal(q.body.chargeCurrency, 'GHS');
  });
});

// ===========================================================================
// 6. Server-authoritative persistence: quote == booked shippingCost == total
// ===========================================================================
describe('F-7: booked shippingCost and totalAmount match the quote exactly', () => {
  test('GB order books the quoted GHS shipping and derives the total from it', { skip: !runOk }, async () => {
    const q = await quote({ countryCode: 'GB', subtotal: 100 });
    const quoteGHS = q.body.options[0].amountGHS;

    const created = await placeOrder({ products: [state.prodA], address: addrGB });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const row = await orderRow(created.orderId);

    assert.equal(Number(row.shippingCost), quoteGHS,
      `persisted shippingCost ${row.shippingCost} must equal the quoted ${quoteGHS}`);
    // subtotal 100 + tax 15 + shipping 222.22 - discount 0
    assert.equal(Number(row.tax), 15);
    assert.equal(Number(row.totalAmount), 337.22, 'exact persisted totalAmount');
    assert.equal(
      Number(row.totalAmount),
      Math.round((100 + Number(row.tax) + Number(row.shippingCost) - Number(row.discount)) * 100) / 100,
      'totalAmount must be subtotal + tax + shipping - discount'
    );
    assert.equal(q.body.chargeCurrency, 'GHS');
  });

  test('domestic GH order keeps the flat GH₵15 and the shared total math', { skip: !runOk }, async () => {
    const created = await placeOrder({ products: [state.prodA], address: addrGH });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const row = await orderRow(created.orderId);
    assert.equal(Number(row.shippingCost), 15);
    assert.equal(Number(row.totalAmount), 130, 'subtotal 100 + tax 15 + shipping 15');
  });

  test('mixed-vendor cart is charged ONCE (no double-counted thresholds)', { skip: !runOk }, async () => {
    const q = await quote({ countryCode: 'GB', subtotal: 150 });
    const quoteGHS = q.body.options[0].amountGHS;

    const created = await placeOrder({ products: [state.prodA, state.prodB], address: addrGB });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const row = await orderRow(created.orderId);

    assert.equal(Number(row.shippingCost), quoteGHS,
      'one cart, one shipping charge, identical to the quote');
    assert.notEqual(Number(row.shippingCost), quoteGHS * 2, 'shipping must not be summed per vendor');
    // subtotal 150 -> tax 22.50 -> total 150 + 22.50 + 222.22
    assert.equal(Number(row.tax), 22.5);
    assert.equal(Number(row.totalAmount), 394.72, 'exact persisted totalAmount');
  });

  test('a vendor that does not ship to GB blocks the order (server-side)', { skip: !runOk }, async () => {
    const created = await placeOrder({ products: [state.prodC], address: addrGB });
    assert.equal(created.status, 400, JSON.stringify(created.body));
    assert.equal(created.body.code, 'VENDOR_DOES_NOT_SHIP');
    assert.equal(created.orderId, null);
  });

  test('unsupported destination still fails closed before any money math', { skip: !runOk }, async () => {
    const created = await placeOrder({
      products: [state.prodA],
      address: { ...addrGB, countryCode: 'FR' },
    });
    assert.equal(created.status, 400);
    assert.equal(created.body.code, 'UNSUPPORTED_DESTINATION');
  });
});

// ===========================================================================
// 7. Address changes: before payment recalculates, after payment is frozen
// ===========================================================================
describe('F-7: address changes recalculate shipping before payment and freeze after', () => {
  test('address change before payment re-books shipping and total', { skip: !runOk }, async () => {
    const created = await placeOrder({ products: [state.prodA], address: addrGH });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const before = await orderRow(created.orderId);
    assert.equal(Number(before.shippingCost), 15);

    const updated = await putOrder(created.orderId, { shippingAddress: addrGB });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));

    const after = await orderRow(created.orderId);
    const q = await quote({ countryCode: 'GB', subtotal: 100 });
    assert.equal(Number(after.shippingCost), q.body.options[0].amountGHS,
      'the recalculated shipping must equal the fresh quote');
    assert.equal(Number(after.shippingCost), 222.22);
    assert.equal(Number(after.totalAmount), 337.22, 'totalAmount recalculated with the new shipping');
  });

  test('destination change after payment initialization is refused', { skip: !runOk }, async () => {
    const created = await placeOrder({ products: [state.prodA], address: addrGB });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const orderId = created.orderId;

    // Attach the one payment reference an owner may set (charge initiated).
    const ref = await putOrder(orderId, { paymentReference: `FINFXT-REF-${ts}` });
    assert.equal(ref.status, 200, JSON.stringify(ref.body));

    const blocked = await putOrder(orderId, { shippingAddress: addrUS });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.code, 'ADDRESS_CHANGE_AFTER_CHARGE');

    const row = await orderRow(orderId);
    const [[addr]] = await pool.execute(`SELECT shippingAddress FROM orders WHERE id = ?`, [orderId]);
    const stored = asObj(addr.shippingAddress);
    assert.equal(stored.countryCode, 'GB', 'destination must be unchanged after charge init');
    assert.equal(Number(row.shippingCost), 222.22, 'shipping must be unchanged after charge init');
  });

  test('same-country edit after charge init recomputes to the identical figure', { skip: !runOk }, async () => {
    const created = await placeOrder({ products: [state.prodA], address: addrGB });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const orderId = created.orderId;
    await putOrder(orderId, { paymentReference: `FINFXT-REF2-${ts}` });

    const res = await putOrder(orderId, { shippingAddress: { ...addrGB, city: 'Manchester' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await orderRow(orderId);
    assert.equal(Number(row.shippingCost), 222.22, 'same destination: identical shipping');
    assert.equal(Number(row.totalAmount), 337.22, 'same destination: identical total');
  });

  test('address change on a paid order is refused (snapshot immutable)', { skip: !runOk }, async () => {
    const created = await placeOrder({ products: [state.prodA], address: addrGB });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const orderId = created.orderId;
    await pool.execute(`UPDATE orders SET paymentStatus='paid' WHERE id = ?`, [orderId]);

    const blocked = await putOrder(orderId, { shippingAddress: addrUS });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.code, 'PAID_SNAPSHOT_IMMUTABLE');

    const [[addr]] = await pool.execute(`SELECT shippingAddress FROM orders WHERE id = ?`, [orderId]);
    assert.equal(asObj(addr.shippingAddress).countryCode, 'GB');
  });
});

// ===========================================================================
// 8. Frontend contract: failures block payment, server stays authoritative
// ===========================================================================
describe('frontend contract: unavailable rates / unsupported destinations block payment', () => {
  const checkout = readFileSync(
    path.join(REPO_ROOT, 'src', 'Pages', 'CheckoutPage', 'checkout.tsx'), 'utf8'
  );

  test('the quote failure message comes from the server (never a client guess)', () => {
    assert.match(checkout, /err\?\.response\?\.data\?\.message \|\| 'Shipping not available to this destination'/,
      'checkout must surface the server code/message for 502/503 quotes');
  });

  test('payment stays disabled until the destination resolves supported:true', () => {
    assert.match(checkout, /shippingEligibility\?\.supported !== true/,
      'an unresolved or failed quote must block the Pay button');
    assert.match(checkout, /setShippingEligibility\(\{ supported: false, message \}\)/,
      'a failed quote must be recorded as unsupported, not ignored');
  });

  test('the payable amount is the server total, not a client shipping guess', () => {
    assert.match(checkout, /resolvePayableTotal\(/,
      'payable total must be resolved through the server-authoritative helper');
    assert.ok(/serverOrder/.test(checkout),
      'the server order (with its booked shipping) drives the charge');
  });

  test('the quote request sends the GHS subtotal and the destination', () => {
    const call = checkout.match(/\/api\/checkout\/international\/shipping-options', \{[\s\S]{0,300}?\}\)/);
    assert.ok(call, 'shipping-options request not found');
    assert.match(call[0], /countryCode: destinationCode/);
    assert.match(call[0], /subtotal,/);
  });
});
