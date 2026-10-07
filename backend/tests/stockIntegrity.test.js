// FILE LOCATION: backend/tests/stockIntegrity.test.js
// DESCRIPTION: I3 — there was no CHECK constraint on stock anywhere in the
//              schema, and the four *absolute* stock writers accepted any
//              integer. `parseInt(-5) || 0` is `-5`, so a negative inventory
//              count persisted and the public projection
//              (`Math.max(0, onHand)`) then hid it from buyers.
//
// What this proves, in layers, from cheapest to most expensive:
//   1. The clamp itself (pure unit — always runs).
//   2. Every absolute writer routes through it, and none of the old
//      `parseInt(x) || 0` shapes survive (source guards — always run).
//   3. The guarded *arithmetic* writers kept their `stock >= ?` — the clamp
//      must not have replaced the thing that makes oversell impossible.
//   4. The schema ships the constraint in BOTH the dump and the migration,
//      in the right order (source guards — always run).
//   5. The engine actually refuses a negative row (DB-gated; honestly skipped
//      on engines that parse CHECK without enforcing it).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { toNonNegativeInt } from '../utils/nonNegativeInt.js';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const productModelSrc = read('../models/productModel.js');
const vendorControllerSrc = read('../controllers/vendorController.js');
const reservationSrc = read('../Services/reservationService.js');
const orderControllerSrc = read('../controllers/orderController.js');
const schemaSyncSrc = read('../migrateSchemaSync.js');
const dumpSrc = readFileSync(fileURLToPath(new URL('../../branding_house.sql', import.meta.url)), 'utf8');

const FIXTURE_TITLE = `I3 negative-stock fixture ${Date.now()}`;
const createdIds = [];

after(async () => {
  if (!dbAvailable) return;
  for (const id of createdIds) {
    await pool.execute('DELETE FROM product WHERE id = ?', [id]).catch(() => {});
  }
  // Without this the file's process never drains — node:test waits on the
  // live connection and the suite hangs instead of finishing.
  await pool?.end?.().catch?.(() => {});
});

// ---------------------------------------------------------------------------
// 1. The clamp
// ---------------------------------------------------------------------------
describe('I3: toNonNegativeInt', () => {
  test('refuses to go below zero', () => {
    for (const value of [-1, -5, '-5', -0.5, -999999]) {
      assert.equal(toNonNegativeInt(value), 0, `${value} must clamp to 0`);
    }
  });

  test('keeps the old `parseInt(x) || 0` NaN behaviour', () => {
    // Callers already relied on garbage becoming 0. Tightening that to a
    // 400 would change responses for every client that sends '' — clamping
    // removes the capability without touching the contract.
    for (const value of [undefined, null, '', 'abc', Number.NaN, {}]) {
      assert.equal(toNonNegativeInt(value), 0, `${String(value)} must become 0`);
    }
  });

  test('always returns a non-negative integer', () => {
    for (const value of [-3, 0, 1, '7', '7.9', 42.6, '', null, undefined, 'x']) {
      const result = toNonNegativeInt(value);
      assert.ok(Number.isInteger(result), `${String(value)} → ${result} is not an integer`);
      assert.ok(result >= 0, `${String(value)} → ${result} is negative`);
    }
  });

  test('preserves legitimate stock values exactly', () => {
    assert.equal(toNonNegativeInt(0), 0, 'zero stock is meaningful (oversell tests rely on it)');
    assert.equal(toNonNegativeInt(10), 10);
    assert.equal(toNonNegativeInt('10'), 10);
    assert.equal(toNonNegativeInt(1000), 1000);
  });
});

// ---------------------------------------------------------------------------
// 2. Every absolute writer is wired to it
// ---------------------------------------------------------------------------
describe('I3: absolute stock writers route through the clamp', () => {
  test('no writer still does `parseInt(x) || 0` on an inventory counter', () => {
    const survivors = [
      ['productModel create', productModelSrc, /parseInt\(productData\.stock\)\s*\|\|\s*0/],
      ['productModel update', productModelSrc, /parseInt\(updateData\[key\]\)\s*\|\|\s*0/],
      ['vendorController create', vendorControllerSrc, /parseInt\(stock\)\s*\|\|\s*0/],
      ['vendorController update', vendorControllerSrc, /parseInt\(req\.body\[key\]\)\s*\|\|\s*0/],
      ['productModel lowStockThreshold', productModelSrc, /parseInt\(productData\.lowStockThreshold\)\s*\|\|\s*0/],
      ['vendorController lowStockThreshold', vendorControllerSrc, /parseInt\(lowStockThreshold\)\s*\|\|\s*0/],
    ];
    for (const [where, src, pattern] of survivors) {
      assert.ok(!pattern.test(src), `${where} still writes a raw parseInt — negative stock can persist`);
    }
  });

  test('both files import and call the clamp', () => {
    for (const [name, src] of [
      ['models/productModel.js', productModelSrc],
      ['controllers/vendorController.js', vendorControllerSrc],
    ]) {
      assert.match(src, /import\s*\{\s*toNonNegativeInt\s*\}\s+from/, `${name} does not import the clamp`);
      assert.ok(
        (src.match(/toNonNegativeInt\(/g) || []).length >= 2,
        `${name} should clamp every absolute counter it writes (stock + lowStockThreshold)`,
      );
    }
  });

  test('the clamp lives in exactly one shared module', () => {
    // A copy of this logic in each controller is how the four writers drifted
    // apart in the first place.
    const definitionSites = [
      read('../utils/nonNegativeInt.js'),
      productModelSrc,
      vendorControllerSrc,
    ].filter((src) => /export const toNonNegativeInt/.test(src));
    assert.equal(definitionSites.length, 1, 'toNonNegativeInt must be defined once, not re-declared per file');
  });
});

// ---------------------------------------------------------------------------
// 3. The guarded arithmetic writers are untouched
// ---------------------------------------------------------------------------
describe('I3: oversell guards survived the change', () => {
  test('relative stock writes keep their `stock >= ?` condition', () => {
    // The clamp only governs absolute writes. If someone "simplifies" a
    // relative write into an absolute one, or drops the guard, oversell
    // comes straight back — so assert both shapes are present.
    for (const [name, src] of [
      ['Services/reservationService.js', reservationSrc],
      ['controllers/orderController.js', orderControllerSrc],
    ]) {
      assert.match(src, /stock = stock - \?/, `${name} lost the decrement`);
      assert.match(src, /AND stock >= \?/, `${name} lost the stock >= ? oversell guard`);
    }
  });

  test('the clamp is not used to justify removing an oversell guard', () => {
    // `toNonNegativeInt` must never appear inside a WHERE clause — a clamp
    // applied to the *bound parameter* would let the guard pass while the
    // stored value went negative again.
    for (const src of [reservationSrc, orderControllerSrc]) {
      assert.ok(!/WHERE[\s\S]{0,400}?toNonNegativeInt/.test(src), 'the clamp leaked into a WHERE guard');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The schema ships the constraint, dump and migration agreeing
// ---------------------------------------------------------------------------
describe('I3: DB-level backstop', () => {
  test('fresh installs declare CHECK (stock >= 0)', () => {
    assert.match(
      dumpSrc,
      /CONSTRAINT chk_product_stock_nonneg CHECK \(stock >= 0\)/,
      'branding_house.sql is missing the stock CHECK — fresh installs would diverge from migrated ones (N-11 again)',
    );
  });

  test('the migration adds the same constraint by the same name', () => {
    assert.match(schemaSyncSrc, /ADD CONSTRAINT chk_product_stock_nonneg CHECK \(stock >= 0\)/);
    assert.ok(
      dumpSrc.includes('chk_product_stock_nonneg') && schemaSyncSrc.includes('chk_product_stock_nonneg'),
      'dump and migration constraint names must match, or information_schema probes silently miss',
    );
  });

  test('legacy negative rows are cleaned BEFORE the ALTER', () => {
    const cleanup = schemaSyncSrc.indexOf('UPDATE product SET stock = 0 WHERE stock < 0');
    const alter = schemaSyncSrc.indexOf('ADD CONSTRAINT chk_product_stock_nonneg');
    assert.ok(cleanup !== -1, 'no pre-cleanup statement — a legacy negative row aborts the chain');
    assert.ok(alter !== -1, 'no ADD CONSTRAINT');
    // MySQL validates existing rows on ALTER. This script is the LAST entry in
    // the &&-chained `db:migrate`, so a failed ALTER aborts everything after
    // it and leaves a partial schema — the N-5 failure mode, newly caused here.
    assert.ok(cleanup < alter, 'cleanup must run before the ALTER');
  });

  test('the constraint probe keeps re-runs idempotent', () => {
    assert.match(schemaSyncSrc, /information_schema\.TABLE_CONSTRAINTS/);
    assert.match(schemaSyncSrc, /hasCheckConstraint\('product', 'chk_product_stock_nonneg'\)/);
  });

  test('a refused constraint warns loudly instead of killing the chain', () => {
    // TiDB parses CHECK without enforcing it; some managed MySQL variants
    // reject ADD CONSTRAINT outright. Exiting non-zero here would break
    // `db:migrate` on engines where the constraint never did anything.
    assert.match(schemaSyncSrc, /console\.warn\(/, 'a refused ADD CONSTRAINT is being swallowed silently');
    assert.match(schemaSyncSrc, /not added/);
    assert.match(schemaSyncSrc, /nonNegativeInt\.js/, 'the warning must say where the real defence is');
  });

  test('stock_moves.delta is deliberately NOT constrained', () => {
    // It is a signed ledger entry — clamping it would corrupt stock history.
    assert.ok(
      !/chk_product_stock_delta|CHECK \(delta/.test(dumpSrc),
      'the signed stock-moves ledger must stay signed',
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The engine, for real
// ---------------------------------------------------------------------------
describe('I3: the constraint holds against a live database', { skip: !dbAvailable }, () => {
  test('a negative stock insert is rejected', async (t) => {
    let insertedId = null;
    try {
      const [result] = await pool.execute(
        `INSERT INTO product (title, img, price, category, stock, approvalStatus)
         VALUES (?, '/uploads/i3.png', 10, 'test', -1, 'approved')`,
        [`${FIXTURE_TITLE} direct`],
      );
      insertedId = result.insertId;
    } catch (err) {
      assert.match(
        err.message,
        /check constraint|constraint .*violat|chk_product_stock_nonneg/i,
        `insert failed for an unrelated reason: ${err.message}`,
      );
      return;
    }

    await pool.execute('DELETE FROM product WHERE id = ?', [insertedId]);
    // Reached only on engines that parse CHECK without enforcing it (TiDB).
    // Recorded honestly rather than asserted away: on this engine the
    // application clamp is the ONLY defence.
    t.skip('engine parses but does not enforce CHECK — application clamp in utils/nonNegativeInt.js is the sole defence here');
  });

  test('the admin create writer clamps a negative stock to 0', async () => {
    const Product = (await import('../models/productModel.js')).default;
    const created = await Product.create({
      title: `${FIXTURE_TITLE} create`,
      img: '/uploads/i3.png',
      price: '25',
      stock: -5,
      category: 'test',
      approvalStatus: 'approved',
    });
    createdIds.push(created.id);
    assert.equal(Number(created.stock), 0, `Product.create stored stock=${created.stock} from input -5`);
  });

  test('the update writer clamps a negative stock to 0', async () => {
    const Product = (await import('../models/productModel.js')).default;
    const created = await Product.create({
      title: `${FIXTURE_TITLE} update`,
      img: '/uploads/i3.png',
      price: '25',
      stock: 4,
      category: 'test',
      approvalStatus: 'approved',
    });
    createdIds.push(created.id);
    const updated = await Product.update(created.id, { stock: -3 });
    assert.equal(Number(updated.stock), 0, `Product.update stored stock=${updated.stock} from input -3`);
  });

  test('update still accepts a legitimate restock', async () => {
    const Product = (await import('../models/productModel.js')).default;
    const created = await Product.create({
      title: `${FIXTURE_TITLE} restock`,
      img: '/uploads/i3.png',
      price: '25',
      stock: 1,
      category: 'test',
      approvalStatus: 'approved',
    });
    createdIds.push(created.id);
    const updated = await Product.update(created.id, { stock: 0 });
    assert.equal(Number(updated.stock), 0, 'zero stock must survive (oversell tests depend on it)');
    const restocked = await Product.update(created.id, { stock: 7 });
    assert.equal(Number(restocked.stock), 7, 'a positive restock must pass through unchanged');
  });
});
