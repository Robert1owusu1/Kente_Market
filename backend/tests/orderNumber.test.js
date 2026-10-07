// FILE LOCATION: backend/tests/orderNumber.test.js
// DESCRIPTION: N-18 regression — order numbers must stay unique even when two
//              orders are created inside the SAME millisecond.
//
// HISTORY: `orders.orderNumber` is UNIQUE (branding_house.sql), but both
//   checkout paths minted it from `Date.now()` (epoch ms). Under 20-way
//   concurrency in tests/couponMaxUses.test.js the loser of that race threw
//   ER_DUP_ENTRY and the customer got a 500 (stock and coupon slot were rolled
//   back correctly, but the basket was lost). Seen twice in CI, 2/8 runs
//   locally, before the fix.
//
// The frozen-clock test below is the proof that would have caught it: with
// `Date.now()` pinned to a single value, uniqueness can only come from the
// helper's entropy — the old implementation produced 2000 identical strings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { newOrderNumber } from '../utils/orderNumber.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const readSource = (rel) => fs.readFileSync(path.join(backendRoot, rel), 'utf8');

// Every source line that mints an order number, for the sweep below.
const orderNumberMints = () => {
  const dirs = ['controllers', 'Services', 'models', 'routes', 'utils'];
  const hits = [];
  for (const dir of dirs) {
    const abs = path.join(backendRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true })) {
      const file = path.join(abs, entry);
      if (!file.endsWith('.js') || !fs.statSync(file).isFile()) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/orderNumber\s*:/.test(line) && /Date\.now\(\)/.test(line)) {
          hits.push(`${path.relative(backendRoot, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
  return hits;
};

describe('N-18: order numbers are collision-proof', () => {
  test('checkout mints ORD numbers through the helper, never Date.now()', () => {
    const src = readSource('controllers/orderController.js');
    assert.match(
      src,
      /newOrderNumber\(\s*["']ORD["']\s*\)/,
      'checkout must build its order number with newOrderNumber("ORD")'
    );
    assert.doesNotMatch(
      src,
      /orderNumber\s*:\s*["'`]ORD-["'`]\s*\+\s*Date\.now\(\)|orderNumber\s*:\s*[`"']ORD-\$\{Date\.now\(\)\}/,
      'a bare millisecond timestamp reintroduces the same-millisecond collision (N-18)'
    );
  });

  test('custom-request checkout mints CUS numbers through the helper too', () => {
    const src = readSource('controllers/customRequestController.js');
    assert.match(
      src,
      /newOrderNumber\(\s*["']CUS["']\s*\)/,
      'custom orders must build their order number with newOrderNumber("CUS")'
    );
  });

  test('no backend source mints an orderNumber from Date.now()', () => {
    assert.deepEqual(
      orderNumberMints(),
      [],
      'orders.orderNumber is UNIQUE — a millisecond timestamp is not unique under concurrency'
    );
  });

  test('uniqueness holds even when the clock is frozen (the original bug)', () => {
    const realNow = Date.now;
    const samples = [];
    try {
      // Pin the clock so every call sees the identical timestamp: only the
      // helper's entropy can keep these apart. The pre-fix implementation
      // returned the same string for every one of them.
      Date.now = () => 1791330964942;
      for (let i = 0; i < 2000; i += 1) samples.push(newOrderNumber('ORD'));
    } finally {
      Date.now = realNow;
    }

    assert.equal(new Set(samples).size, samples.length, 'frozen-clock collisions must be impossible');
    assert.ok(
      samples.every((s) => s.startsWith('ORD-1791330964942-')),
      'timestamp prefix must still be present for readable, sortable numbers'
    );
  });

  test('format stays inside the VARCHAR(100) column and keeps its prefix', () => {
    for (const prefix of ['ORD', 'CUS']) {
      const n = newOrderNumber(prefix);
      assert.match(n, new RegExp(`^${prefix}-\\d{10,}-[0-9a-f]{8}$`), `unexpected shape: ${n}`);
      assert.ok(n.length <= 100, `orderNumber must fit VARCHAR(100): ${n}`);
    }
  });

  test('20000 rapid-fire numbers never repeat', () => {
    const samples = new Set();
    for (let i = 0; i < 20000; i += 1) samples.add(newOrderNumber('ORD'));
    assert.equal(samples.size, 20000, 'no collisions across 20000 consecutive numbers');
  });
});
