// FILE LOCATION: backend/tests/platformRevenue.test.js
// DESCRIPTION: Platform-earnings report (Services/platformRevenueService.js).
//   Pure range-normalisation tests + DB-backed aggregation inside a rolled-back
//   transaction (nothing is committed). Uses a year-2000 window so fixtures can
//   never collide with real data in the window being summed.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const { normalizeRange, getPlatformRevenueReport } = await import('../Services/platformRevenueService.js');

describe('normalizeRange — window handling (pure)', () => {
  test('defaults to a 30-day window ending today', () => {
    const r = normalizeRange();
    assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.to, /^\d{4}-\d{2}-\d{2}$/);
    const days = (new Date(r.to) - new Date(r.from)) / 86400000;
    assert.equal(days, 29); // 30 inclusive days
  });

  test('honours an explicit valid range', () => {
    assert.deepEqual(normalizeRange({ from: '2026-10-01', to: '2026-10-15' }), { from: '2026-10-01', to: '2026-10-15' });
  });

  test('clamps a reversed range to a single day', () => {
    assert.deepEqual(normalizeRange({ from: '2026-10-20', to: '2026-10-01' }), { from: '2026-10-01', to: '2026-10-01' });
  });

  test('ignores malformed dates and falls back to defaults', () => {
    const r = normalizeRange({ from: 'nonsense', to: '13/13/2026' });
    assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.to, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// --- DB-backed aggregation (rolled back) ---------------------------------
let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

after(async () => { if (pool) await pool.end().catch(() => {}); });

describe('platform revenue aggregation (rolled-back transaction)', { skip: !dbAvailable }, () => {
  test('sums platform-product net + commission; splits held vs released', async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const ts = '2000-06-15 12:00:00';
      const win = { from: '2000-06-01', to: '2000-06-30' };

      // Platform-product income: gross 500 + refund -120 => net 380.
      await conn.query(
        `INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source, created_at)
         VALUES (NULL, 500, 500, 0, 'platform_product', ?)`, [ts]);
      await conn.query(
        `INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source, created_at)
         VALUES (NULL, -120, -120, 0, 'refund', ?)`, [ts]);

      // Commission: use an order that has no existing allocations so the unique
      // (orderId, vendorId, allocationType) key is free. Skip if none/empty DB.
      const [[freeOrder]] = await conn.query(
        `SELECT o.id FROM orders o
         LEFT JOIN escrow_allocations e ON e.orderId = o.id
         WHERE e.id IS NULL LIMIT 1`);
      const [[someUser]] = await conn.query(`SELECT id FROM users LIMIT 1`);

      let expectBooked = 0, expectReleased = 0, expectHeld = 0;
      if (freeOrder && someUser) {
        await conn.query(
          `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType, created_at)
           VALUES (?, ?, 1000, 0.1, 80, 920, 'available', 'standard', ?)`, [freeOrder.id, someUser.id, ts]);
        await conn.query(
          `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType, created_at)
           VALUES (?, ?, 1000, 0.1, 50, 950, 'held', 'advance', ?)`, [freeOrder.id, someUser.id, ts]);
        expectBooked = 130; expectReleased = 80; expectHeld = 50;
      }

      const { summary, series } = await getPlatformRevenueReport(win, conn);

      assert.equal(summary.platformProductGross, 500);
      assert.equal(summary.platformProductRefunds, 120);
      assert.equal(summary.platformProductNet, 380);
      assert.equal(summary.commissionBooked, expectBooked);
      assert.equal(summary.commissionReleased, expectReleased);
      assert.equal(summary.commissionHeld, expectHeld);
      assert.equal(summary.totalBooked, 380 + expectBooked);
      assert.equal(summary.totalReleased, 380 + expectReleased);

      // One active day, totals consistent.
      assert.equal(series.length, 1);
      assert.equal(series[0].date, '2000-06-15');
      assert.equal(series[0].platformProduct, 380);
      assert.equal(series[0].commission, expectBooked);
      assert.equal(series[0].total, 380 + expectBooked);
    } finally {
      await conn.rollback();
      conn.release();
    }
  });
});
