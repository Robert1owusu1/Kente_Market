// FILE LOCATION: backend/tests/migrationSafety.test.js
// DESCRIPTION: N-5 — `npm run db:migrate` is a 21-script `&&` chain with no
//              transaction and no per-row try/catch, so one bad row exited
//              non-zero and skipped every remaining migration, leaving the
//              schema half-applied. Plus N-5b: the vendor_order_items backfill
//              had no idempotency guard at all.
//
// Why the failure classification is the heart of this: `&&` has exactly two
// outcomes, run or stop. So a migration error must be sorted into
//   * STRUCTURAL (table missing, column wrong, connection gone) -> the schema
//     really is incomplete -> rethrow, stop, let the operator see it; and
//   * ROW (one order's JSON won't insert) -> the schema is fine, only data is
//     short -> skip it, keep the chain moving, report it loudly.
// Conflating the two is what made a single malformed order able to abort 21
// migrations.
//
// These are source + unit assertions rather than an executed run: actually
// running `db:migrate` here would rewrite the schema of whatever database the
// suite points at. The live end-to-end proof is CI's `db:setup` job, which
// runs the entire chain against a fresh MySQL 8.4 container on every push.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

// Importing these modules runs nothing (the main guard checks import.meta.url)
// but it DOES create the shared connection pool — so it must be closed below,
// or the test process hangs waiting on it.
const { default: pool } = await import('../config/db.js');
const { isFatalConnectionError } = await import('../migrateOrderItems.js');
const { isFatalConnectionError: isFatalVendor } = await import('../migrateVendorOrderItems.js');

const BACKFILLS = [
  ['migrateOrderItems.js', read('../migrateOrderItems.js')],
  ['migrateVendorOrderItems.js', read('../migrateVendorOrderItems.js')],
];

after(() => pool.end().catch(() => {}));

// ---------------------------------------------------------------------------
// N-5: failure classification
// ---------------------------------------------------------------------------
describe('N-5: a row failure cannot be mistaken for a structural one', () => {
  test('a lost connection is fatal in both migrations', () => {
    // The one case where carrying on is pointless: nothing after this script
    // can run anyway, so the chain must stop with a non-zero exit.
    for (const err of [
      { code: 'ECONNRESET' },
      { code: 'ETIMEDOUT' },
      { code: 'EPIPE' },
      { code: 'PROTOCOL_CONNECTION_LOOST' },
    ]) {
      assert.equal(isFatalConnectionError(err), true, `${err.code} must be fatal`);
      assert.equal(isFatalVendor(err), true, `${err.code} must be fatal (vendor)`);
    }
  });

  test('an ordinary data error is NOT fatal', () => {
    for (const err of [
      { code: 'ER_BAD_NULL_ERROR', message: "Column 'img' cannot be null" },
      { code: 'ER_DUP_ENTRY', message: 'Duplicate entry' },
      { code: 'ER_DATA_TOO_LONG', message: 'Data too long for column' },
      { code: 'ER_TRUNCATED_WRONG_VALUE', message: 'Incorrect value' },
      new Error('ungrouped but survivable'),
      undefined,
      null,
    ]) {
      assert.equal(isFatalConnectionError(err), false, `${err?.code || err} must not stop the chain`);
      assert.equal(isFatalVendor(err), false, `${err?.code || err} must not stop the chain (vendor)`);
    }
  });

  test('both migrations export the same classifier', () => {
    // Two subtly different classifiers would mean one script still aborts the
    // chain for the error the other tolerates.
    for (const [name, src] of BACKFILLS) {
      assert.match(src, /export const isFatalConnectionError/, `${name} does not export the classifier`);
      assert.match(src, /if \(isFatalConnectionError\(rowErr\)\) throw rowErr;/, `${name} does not rethrow fatal errors`);
    }
  });
});

// ---------------------------------------------------------------------------
// N-5: transaction
// ---------------------------------------------------------------------------
describe('N-5: backfills run inside a transaction', () => {
  for (const [name, src] of BACKFILLS) {
    test(`${name} wraps its batch loop`, () => {
      const begin = src.indexOf('connection.beginTransaction()');
      const commit = src.indexOf('connection.commit()');
      const rollback = src.indexOf('connection.rollback()');
      const loop = src.indexOf('while (true) {');

      assert.ok(begin !== -1, `${name} never begins a transaction`);
      assert.ok(commit !== -1, `${name} never commits`);
      assert.ok(rollback !== -1, `${name} never rolls back`);
      assert.ok(begin < loop, 'the transaction must open before the loop');
      assert.ok(loop < commit, 'the transaction must commit after the loop');
    });

    test(`${name} rolls back and rethrows on a fatal error`, () => {
      // Without this a fatal error would leave the connection handed back to
      // the pool still inside an open transaction.
      const rollbackAt = src.indexOf('connection.rollback()');
      const rethrowAt = src.indexOf('throw fatalErr;', rollbackAt);
      assert.ok(rethrowAt !== -1, `${name} swallows the fatal error after rolling back`);
      assert.match(src, /catch \(fatalErr\) \{[\s\S]*?rollback\(\)[\s\S]*?throw fatalErr;/);
    });
  }
});

// ---------------------------------------------------------------------------
// N-5: per-row isolation
// ---------------------------------------------------------------------------
describe('N-5: one bad order no longer aborts the chain', () => {
  for (const [name, src] of BACKFILLS) {
    test(`${name} isolates each order`, () => {
      assert.match(src, /for \(const order of orders\) \{\s*try \{/, `${name} has no per-order try`);
      assert.match(src, /rowsFailed\+\+/, `${name} does not count row failures`);
      assert.match(src, /failedOrderIds\.push\(order\.id\)/, `${name} does not name the failed orders`);
    });

    test(`${name} reports a partial backfill loudly instead of quietly succeeding`, () => {
      assert.match(src, /console\.error\(` {2,3}\S* backfilled PARTIALLY/, `${name} has no partial-failure report`);
      // The failure must be visible as an error, not a success line.
      assert.match(src, /if \(rowsFailed > 0\) \{[\s\S]*?console\.error\([\s\S]*?\} else \{\s*console\.log\(`✅/);
    });

    test(`${name} keeps the success message when everything worked`, () => {
      assert.match(src, /console\.log\(`✅ \S+ backfilled: \$\{\w+\} items inserted`\)/);
    });
  }
});

// ---------------------------------------------------------------------------
// N-5b: re-run safety
// ---------------------------------------------------------------------------
describe('N-5b: re-running db:migrate cannot duplicate vendor order lines', () => {
  test('the vendor backfill skips when the table already has rows', () => {
    const [, src] = BACKFILLS.find(([name]) => name === 'migrateVendorOrderItems.js');
    assert.match(src, /SELECT COUNT\(\*\) as c FROM vendor_order_items/, 'no idempotency guard');
    assert.match(src, /already has \$\{existing\.c\} rows, skipping backfill/);
    // The guard must precede the loop, or it guards nothing.
    assert.ok(
      src.indexOf('skipping backfill') < src.indexOf('while (true) {'),
      'the guard runs after the backfill loop instead of before it',
    );
  });

  test('the guard sits after the CREATE TABLE so a fresh database still backfills', () => {
    const [, src] = BACKFILLS.find(([name]) => name === 'migrateVendorOrderItems.js');
    assert.ok(src.indexOf('CREATE TABLE IF NOT EXISTS vendor_order_items') < src.indexOf('skipping backfill'),
      'the guard would run before the table exists');
  });

  test('the order_items backfill keeps its existing guard', () => {
    const [, src] = BACKFILLS.find(([name]) => name === 'migrateOrderItems.js');
    assert.match(src, /SELECT COUNT\(\*\) as c FROM order_items/);
  });

  test('vendor_order_items has no unique key that would make INSERT IGNORE dedupe', () => {
    // Documented so nobody assumes IGNORE is doing the work. If a unique index
    // on (orderId, productId, …) is ever added, this assertion should be
    // inverted — but until then the COUNT guard is the ONLY thing preventing
    // duplicate payout lines, and it must stay.
    const dump = readFileSync(fileURLToPath(new URL('../../branding_house.sql', import.meta.url)), 'utf8');
    assert.ok(!/UNIQUE[^;]*vendor_order_items/i.test(dump),
      'a unique key now exists — revisit whether the count guard is still needed');
  });

  test('both migrations are still wired into the db:migrate chain', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const chain = pkg.scripts['db:migrate'];
    assert.match(chain, /node migrateOrderItems\.js/);
    assert.match(chain, /node migrateVendorOrderItems\.js/);
    // Order matters: schema-sync runs last so it can patch whatever the
    // earlier scripts created (N-11).
    assert.ok(chain.indexOf('migrateVendorOrderItems.js') < chain.indexOf('migrateSchemaSync.js'),
      'schema sync must remain the last script in the chain');
  });
});

// ---------------------------------------------------------------------------
// R2: the refundable-balance decrement is conditional
// ---------------------------------------------------------------------------
describe('R2: refundedAmount cannot be pushed past totalAmount', () => {
  const returnControllerSrc = read('../controllers/returnController.js');

  test('the increment carries the guard in its WHERE clause', () => {
    const statement = returnControllerSrc.match(/UPDATE orders\s+SET refundedAmount = refundedAmount \+ \?[\s\S]*?`/);
    assert.ok(statement, 'refundedAmount increment not found');
    assert.match(statement[0], /refundedAmount \+ \? <= totalAmount/,
      'the write is unconditional — a check-then-act on a money column');
    assert.ok(statement[0].includes('updated_at = CURRENT_TIMESTAMP'),
      'the increment must still bump updated_at');
  });

  test('the bind parameters appear twice (amount, id, amount)', () => {
    // The second `amount` is what makes `refundedAmount + ? <= totalAmount`
    // compare against the NEW value, not the old one.
    const params = returnControllerSrc.match(/refundedAmount = refundedAmount \+ \?[\s\S]*?\[([^\]]*)\]/);
    assert.ok(params, 'could not locate the increment parameters');
    const binds = params[1].split(',').map((s) => s.trim()).filter(Boolean);
    assert.equal(binds.length, 3, `expected [amount, orderId, amount], got [${binds}]`);
    assert.equal(binds[0], binds[2], 'the guard must be compared against the same amount being added');
  });

  test('a refused increment is an error, not a swallowed warning', () => {
    // Money has already moved by this point (Paystack succeeded above), so the
    // response must still succeed — but the mismatch has to be impossible to
    // miss, because the reconciler keys off this column.
    assert.match(returnControllerSrc, /affectedRows === 0/, 'the refusal is not checked');
    assert.match(returnControllerSrc, /MANUAL RECONCILIATION REQUIRED/, 'the refusal is not reported loudly');
    assert.ok(
      !/refundedAmount = refundedAmount \+ \?[^`]*`\s*\)\.catch\(\(\) => \{\}\)/.test(returnControllerSrc),
      'the increment is back to being silently swallowed',
    );
  });

  test('refundedAmount has exactly one writer in application code', () => {
    // Two writers would reintroduce the check-then-act across two code paths.
    const writers = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'tests') continue;
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const body = readFileSync(full, 'utf8');
          // `+ ?` (a bind placeholder) is what distinguishes an executable
          // statement from the ops runbook sentence in escrowService.js that
          // tells a human to run `... + <amount>` by hand.
          if (/UPDATE orders[\s\S]{0,200}?refundedAmount = refundedAmount \+ \?/.test(body)) {
            writers.push(entry.name);
          }
        }
      }
    };
    walk(fileURLToPath(new URL('..', import.meta.url)));
    assert.deepEqual(writers.sort(), ['returnController.js'],
      `unexpected refundedAmount writers: ${writers.join(', ')}`);
  });
});
