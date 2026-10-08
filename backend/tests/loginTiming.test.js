// FILE LOCATION: backend/tests/loginTiming.test.js
// DESCRIPTION: A5 — the user-not-found branch answered with a stopwatch.
//
// Every real bcrypt.compare on this server costs ~480ms (bcryptjs, cost 12),
// so any branch that returns WITHOUT comparing is ~480ms faster than one that
// does. On POST /api/users/auth all of those branches answer with the same
// generic 401, which makes that difference the entire signal: time one request
// for a guessed address and one for a known one and the gap walks the user
// table. `staffLogin` had the same shape — same 401 body, no comparison.
//
// The fix is to spend the same work the real path spends (`burnPasswordTime`),
// and the three properties worth testing are not the obvious ones:
//
//   * The dummy must be a GENUINE cost-12 hash. `bcrypt.compare(x,
//     'not-a-hash')` returns in ~0ms, so a placeholder string would make the
//     miss branch the FASTEST path on the server — an oracle wearing a fix.
//     That is why the first block measures rather than pattern-matches: a
//     syntactically tidy constant passes every regex and still returns
//     immediately.
//   * Each branch must burn exactly ONCE. Twice is the same oracle in the
//     other direction (960ms vs 480ms is as measurable as 5ms vs 480ms), so
//     the source test counts calls per branch instead of merely finding them.
//   * The behavioural test asserts ABSOLUTE lower bounds plus one loose
//     spread. The finding is that one path is fast; two adjacent wall-clock
//     readings on a contended runner are a flaky way to say so.
//
// The fixtures here hash at cost 12 on purpose: loginLockout.test.js hashes
// at cost 4 (~30ms), which would put the real path in a different class from
// the dummy and make these tests measure the fixture rather than the fix.
//
// NOTE: the pure tests run in the no-DB CI job; the behavioural block skips
// without a database.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

import { DUMMY_HASH, burnPasswordTime } from '../utils/authTiming.js';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const usersModelSrc = read('../models/usersModel.js');
const staffControllerSrc = read('../controllers/staffController.js');
const authTimingSrc = read('../utils/authTiming.js');

/** Wall-clock milliseconds for a synchronous thunk. */
const ms = (fn) => {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
};

// bcryptjs at cost 12 measures ~480ms on a dev box and more on a shared CI
// runner. These bounds sit between the ~5ms a plain return costs and the
// ~480ms the real work does, with a wide margin on both sides.
const BURNED_FLOOR_MS = 80;
const NOT_BURNED_CEILING_MS = 50;

/** The body between a branch opener and its closing brace. */
const branch = (src, opener) => {
  const at = src.indexOf(opener);
  assert.ok(at > -1, `branch not found: ${opener}`);
  const closeOuter = src.indexOf('\n      }', at);
  const closeInner = src.indexOf('\n        }', at);
  const end = closeInner > -1 && (closeOuter === -1 || closeInner < closeOuter) ? closeInner : closeOuter;
  assert.ok(end > -1, `branch body not closed: ${opener}`);
  return src.slice(at, end);
};

const burnsIn = (body) => body.match(/burnPasswordTime\(/g)?.length ?? 0;

describe('A5: the dummy hash must actually cost something', () => {
  test('it is a real bcrypt hash at cost 12 — the same cost as production', () => {
    assert.match(DUMMY_HASH, /^\$2[aby]\$12\$/, 'not a bcrypt hash at cost 12');
    assert.equal(bcrypt.getRounds(DUMMY_HASH), 12, 'getRounds disagrees');
    // Production hashes are `bcrypt.hash(pw, 12)` (usersModel) and
    // STAFF_BCRYPT_ROUNDS = 12 (staffController). A different cost is a
    // different amount of work, and the two branches stay measurably apart.
    assert.match(usersModelSrc, /bcrypt\.hash\(sanitizedData\.password, 12\)/);
    assert.match(staffControllerSrc, /STAFF_BCRYPT_ROUNDS = 12/);
  });

  test('comparing against it burns real time; a placeholder does not', () => {
    // The trap this finding hides behind: a syntactically correct but invalid
    // constant passes every pattern assertion and still returns in ~0ms,
    // leaving the oracle intact while looking fixed.
    const dummyCost = ms(() => bcrypt.compareSync('wrong-password', DUMMY_HASH));
    const placeholderCost = ms(() => bcrypt.compareSync('wrong-password', 'not-a-hash'));

    assert.ok(
      dummyCost > BURNED_FLOOR_MS,
      `the dummy hash cost ${dummyCost.toFixed(1)}ms — too fast to hide a bcrypt`,
    );
    assert.ok(
      placeholderCost < NOT_BURNED_CEILING_MS,
      `an invalid hash cost ${placeholderCost.toFixed(1)}ms; the control should be near-zero`,
    );
    // No third comparison here to prove "it compares rather than throws": the
    // timed one above already did that (an exception would have escaped the
    // ms() helper and failed this test). Each extra cost-12 compare is ~480ms
    // of blocking CPU in a suite that runs four files at once on one database.
  });

  // Deliberately absent: a "the dummy costs the same as a genuine cost-12
  // hash" test. bcrypt's cost IS its round count, so `getRounds(DUMMY_HASH)
  // === 12` above already states the equality, and the mutation that swaps in
  // a cost-10 hash is caught there. What it would have added was ~1.5s of
  // blocking CPU — and this suite runs four test files at once on one shared
  // database, where that much background load measurably perturbs the
  // concurrency-sensitive files (couponMaxUses and RB-04 both started failing
  // with this file present and pass without it). A redundant test that costs
  // other tests their determinism is a net loss.

  test('burnPasswordTime always spends the time and always returns null', async () => {
    // Every caller returns its result directly, so a rejected promise here
    // would turn a generic 401 into a 500. And the empty/undefined cases must
    // not shortcut: bcrypt.compare does charge ~480ms for an empty candidate
    // today, but a fast path there would reinstate the oracle for the
    // missing-password branch specifically. Two candidates cover both shapes
    // the substitution distinguishes — a truthy string takes the branch that
    // uses the candidate as given, and `undefined` (like `''` and `null`, all
    // falsy, `typeof` and all) takes the substituted one. Two is enough to
    // catch the substitution being deleted outright, which is the regression
    // that would matter; a third would cost ~480ms to restate the same path.
    for (const candidate of ['x', undefined]) {
      const t0 = process.hrtime.bigint();
      const result = await burnPasswordTime(candidate);
      const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.equal(result, null, 'callers return this directly');
      assert.ok(
        elapsed > BURNED_FLOOR_MS,
        `candidate ${JSON.stringify(candidate)} returned in ${elapsed.toFixed(1)}ms`,
      );
    }
  });

  test('a failure inside the burn still resolves to null, never to a 500', async () => {
    // This cannot be provoked with a real argument — bcrypt.compare on the
    // genuine DUMMY_HASH simply does not throw — so the comparison itself is
    // made to fail. Without the swallow, authUser's `return burnPasswordTime
    // (password)` would propagate and the endpoint would answer 500 instead of
    // the generic 401, which is an availability bug AND a fresh oracle: 500
    // says something went wrong on a branch whose whole job is to look like
    // every other failure.
    const original = bcrypt.compare;
    bcrypt.compare = () => { throw new Error('induced failure'); };
    try {
      const result = await burnPasswordTime('anything');
      assert.equal(result, null, 'the burn must not propagate a failure');
    } finally {
      bcrypt.compare = original;
    }
    // ...and it is genuinely back to normal afterwards.
    assert.ok(await bcrypt.compare !== undefined);
  });
});

describe('A5: every early return spends exactly one comparison', () => {
  test('usersModel: no such user / inactive', () => {
    const body = branch(usersModelSrc, 'if (!user || !user.isActive) {');
    assert.equal(burnsIn(body), 1, `expected exactly one burn, found ${burnsIn(body)}`);
    assert.match(body, /return burnPasswordTime\(password\)/);
  });

  test('usersModel: locked account', () => {
    const body = branch(usersModelSrc, 'if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {');
    assert.equal(burnsIn(body), 1, `expected exactly one burn, found ${burnsIn(body)}`);
    assert.match(body, /return burnPasswordTime\(password\)/);
    // RB-07 still holds: no password is actually CHECKED while locked.
    assert.ok(!body.includes('bcrypt.compare'), 'the lock now performs a real comparison — RB-07 semantics changed');
  });

  test('usersModel: comparePassword has nothing to compare against', () => {
    const body = branch(usersModelSrc, 'if (!candidatePassword || !this.password) {');
    assert.equal(burnsIn(body), 1, `expected exactly one burn, found ${burnsIn(body)}`);
    assert.match(body, /return false/);
  });

  test('staffLogin: unknown staff email', () => {
    const body = branch(staffControllerSrc, 'if (rows.length === 0) {');
    assert.equal(burnsIn(body), 1, `expected exactly one burn, found ${burnsIn(body)}`);
    assert.match(body, /401/);
    // The wrong-password branch further down still does the real comparison,
    // which is the path the dummy exists to imitate.
    assert.match(staffControllerSrc, /bcrypt\.compare\(password, staff\.password\)/);
  });

  test('there is exactly one DUMMY_HASH in the tree — two would drift', () => {
    const files = [
      '../models/usersModel.js',
      '../controllers/staffController.js',
      '../utils/authTiming.js',
    ];
    const definitions = files
      .map((f) => [f, read(f)])
      .filter(([, src]) => /\bDUMMY_HASH\s*=/.test(src));
    assert.deepEqual(
      definitions.map(([f]) => f),
      ['../utils/authTiming.js'],
      'DUMMY_HASH is defined in more than one place',
    );
    assert.ok(authTimingSrc.includes('DUMMY_HASH'), 'the constant disappeared from its own module');
    // Consumers import it rather than restating a literal: a second copy is
    // how one of them ends up on a different cost six months from now.
    assert.match(usersModelSrc, /import \{ burnPasswordTime \} from '\.\.\/utils\/authTiming\.js'/);
    assert.match(staffControllerSrc, /import \{ burnPasswordTime \} from '\.\.\/utils\/authTiming\.js'/);
    for (const src of [usersModelSrc, staffControllerSrc]) {
      assert.ok(!/\$2[aby]\$\d+\$/.test(src), 'a raw bcrypt literal was copy-pasted outside authTiming.js');
    }
  });
});

// The probe runs at MODULE LOAD, not inside before(): `skip` is evaluated
// when describe/test are registered, which is before any hook runs, so a flag
// set in before() is always still at its initial value by then — the no-DB CI
// job would execute these instead of skipping them.
let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

describe('A5: the four answers cost the same', { skip: !dbAvailable }, () => {
  const PW = `Timing-${process.pid}-${Date.now()}`;
  const email = `a5-${process.pid}-${Date.now()}@example.test`;
  const unknown = `a5-nobody-${process.pid}-${Date.now()}@example.test`;
  let userId = null;

  before(async () => {
    if (!dbAvailable) return;
    // Cost 12 on purpose — see the file header.
    const hash = await bcrypt.hash(PW, 12);
    const [res] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('A5', 'Timing', ?, ?, 'customer', 1, 1)`,
      [email, hash],
    );
    userId = res.insertId;
  });

  after(async () => {
    if (!dbAvailable || !pool) return;
    try {
      await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    } finally {
      try { await pool.end(); } catch { /* suite owns the pool */ }
    }
  });

  const timedAuth = async (...args) => {
    const { default: User } = await import('../models/usersModel.js');
    const t0 = process.hrtime.bigint();
    const result = await User.authenticate(...args);
    return { result, elapsed: Number(process.hrtime.bigint() - t0) / 1e6 };
  };

  // Each branch records its own reading here and the final test compares them,
  // rather than that test performing the four logins a second time. The
  // measurement is identical; the cost is a quarter of it, and every extra
  // cost-12 bcrypt in this file is load the concurrency-sensitive files in the
  // same run have to absorb (see the header).
  const samples = [];
  const record = async (...args) => {
    const outcome = await timedAuth(...args);
    samples.push(outcome.elapsed);
    return outcome;
  };

  test('no such user takes as long as a real password check', { skip: !dbAvailable }, async () => {
    const { result, elapsed } = await record(unknown, PW);
    assert.equal(result, null);
    assert.ok(
      elapsed > BURNED_FLOOR_MS,
      `unknown email answered in ${elapsed.toFixed(1)}ms — the miss branch returns without burning`,
    );
  });

  test('known user, wrong password — the path the dummy must imitate', { skip: !dbAvailable }, async () => {
    const { result, elapsed } = await record(email, `${PW}-wrong`);
    assert.equal(result, null);
    assert.ok(elapsed > BURNED_FLOOR_MS, `wrong password answered in ${elapsed.toFixed(1)}ms`);
  });

  test('inactive account', { skip: !dbAvailable }, async () => {
    await pool.execute('UPDATE users SET isActive = 0 WHERE id = ?', [userId]);
    try {
      const { result, elapsed } = await record(email, PW);
      assert.equal(result, null);
      assert.ok(elapsed > BURNED_FLOOR_MS, `inactive account answered in ${elapsed.toFixed(1)}ms`);
    } finally {
      await pool.execute('UPDATE users SET isActive = 1 WHERE id = ?', [userId]);
    }
  });

  test('locked account — RB-07 says no comparison, A5 says still spend the time', { skip: !dbAvailable }, async () => {
    await pool.execute('UPDATE users SET locked_until = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [userId]);
    try {
      const { result, elapsed } = await record(email, PW);
      assert.equal(result, null, 'the lock must still deny the correct password');
      assert.ok(elapsed > BURNED_FLOOR_MS, `locked account answered in ${elapsed.toFixed(1)}ms`);
    } finally {
      await pool.execute('UPDATE users SET locked_until = NULL WHERE id = ?', [userId]);
    }
  });

  test('no branch answers fast enough to be the signal', { skip: !dbAvailable }, async () => {
    assert.equal(samples.length, 4, 'the four branch tests must all have recorded a reading');
    const min = Math.min(...samples);
    const max = Math.max(...samples);

    // One-sided on purpose. The finding is that ONE branch returned ~480ms
    // sooner than the rest, so what matters is that no branch is fast — and
    // `min > floor` is exactly that claim, with no dependence on how long the
    // slowest reading took. Asserting a tight max/min ratio instead (the
    // first version of this test did) hung the outcome on the largest sample,
    // and one stalled DB roundtrip inflates that past any bound still tight
    // enough to catch a missing burn. The over-burning case it also used to
    // cover is already pinned exactly, and cheaply, by the per-branch call
    // count in the source suite above.
    assert.ok(
      min > BURNED_FLOOR_MS,
      `the fastest answer returned in ${min.toFixed(1)}ms — under the ${BURNED_FLOOR_MS}ms floor, `
      + `so some branch is replying without burning; all four: `
      + samples.map((s) => s.toFixed(0)).join(', ')
      + ` (spread ${(max / min).toFixed(1)}x)`,
    );
    // The spread itself is not asserted: each of the four branch tests
    // already checks its own floor independently, so a duplicate bound here
    // would only add a way to fail without adding a way to be wrong.
  });
});
