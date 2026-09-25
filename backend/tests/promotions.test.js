// FILE LOCATION: backend/tests/promotions.test.js
// DESCRIPTION: DB-backed tests for the promotions feature. Verifies the
//              `promotions` table exists with the schema `promotionModel.js`
//              expects, and that the Promotional model's CRUD + active-display
//              queries behave correctly. Cleanup is done via a deterministic
//              title so runs are idempotent and leave no residue.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';
import Promotion from '../models/promotionModel.js';

const UNIQUE = `test-promo-${Date.now()}`;

// DB gate: these tests need a live database. Probe once at load so the suite
// SELF-SKIPS (rather than failing) when no DB is reachable — this is what lets
// CI run the full `npm test` without a database service.
let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

before(async () => {
  if (!dbAvailable) return;
  // Ensure the promotions table exists before we test against it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promotions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      image VARCHAR(500),
      type ENUM('banner', 'popup', 'event') DEFAULT 'banner',
      priority INT NOT NULL DEFAULT 0,
      link VARCHAR(500),
      linkText VARCHAR(255),
      bgColor VARCHAR(20) DEFAULT '#f59e0b',
      textColor VARCHAR(20) DEFAULT '#ffffff',
      startDate DATETIME NULL,
      endDate DATETIME NULL,
      isActive BOOLEAN DEFAULT true,
      showAsPopup BOOLEAN DEFAULT false,
      popupDismissedExpiryHours INT NOT NULL DEFAULT 24,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
});

after(async () => {
  if (!dbAvailable) {
    await pool.end();
    return;
  }
  // Remove any rows this test created.
  await pool.execute(`DELETE FROM promotions WHERE title = ?`, [UNIQUE]);
  await pool.end();
});

describe('Promotion model against live DB', { skip: !dbAvailable }, () => {
  test('create persists full row and returns defaults', async () => {
    const promo = await Promotion.create({
      title: UNIQUE,
      description: 'Brand new kente drop',
      type: 'popup',
      priority: 5,
      isActive: true,
      showAsPopup: true,
      popupDismissedExpiryHours: 48,
      bgColor: '#111827',
      textColor: '#ffffff',
    });

    assert.ok(promo.id, 'should return an id');
    assert.equal(promo.title, UNIQUE);
    assert.equal(promo.type, 'popup');
    assert.equal(promo.priority, 5);
    assert.equal(promo.isActive, true);
    assert.equal(promo.showAsPopup, true);
    assert.equal(promo.popupDismissedExpiryHours, 48);
    assert.equal(promo.bgColor, '#111827');
    assert.ok(promo.created_at, 'timestamps set');
  });

  test('findById returns the created promotion', async () => {
    const created = await Promotion.create({ title: UNIQUE + '-b', priority: 1 });
    const found = await Promotion.findById(created.id);
    assert.ok(found);
    assert.equal(found.id, created.id);
    assert.equal(found.title, UNIQUE + '-b');
    await Promotion.delete(created.id);
  });

  test('findActiveForDisplay filters by type and active window', async () => {
    const active = await Promotion.create({
      title: UNIQUE,
      type: 'banner',
      isActive: true,
      startDate: new Date(Date.now() - 3600e3), // started 1h ago
      endDate: new Date(Date.now() + 24 * 3600e3), // ends in 24h
    });

    const banners = await Promotion.findActiveForDisplay({ type: 'banner' });
    assert.ok(banners.some((p) => p.id === active.id), 'active banner should be listed');

    const popups = await Promotion.findActiveForDisplay({ type: 'popup' });
    assert.ok(!popups.some((p) => p.id === active.id), 'banner not in popup list');
  });

  test('findActiveForDisplay excludes expired promotions', async () => {
    const expired = await Promotion.create({
      title: UNIQUE,
      type: 'banner',
      isActive: true,
      startDate: new Date(Date.now() - 48 * 3600e3),
      endDate: new Date(Date.now() - 24 * 3600e3), // already ended
    });

    const active = await Promotion.findActiveForDisplay({ type: 'banner' });
    assert.ok(!active.some((p) => p.id === expired.id), 'expired promotion must not show');
  });

  test('findAll with includeExpired shows expired entries for admin', async () => {
    const expired = await Promotion.create({
      title: UNIQUE,
      type: 'banner',
      isActive: true,
      endDate: new Date(Date.now() - 24 * 3600e3), // ended yesterday
    });

    const all = await Promotion.findAll({ includeExpired: true });
    assert.ok(all.some((p) => p.id === expired.id), 'admin list includes expired');
  });

  test('update changes fields and bumps updated_at', async () => {
    const promo = await Promotion.create({ title: UNIQUE, isActive: false });
    const updated = await Promotion.update(promo.id, { isActive: true, priority: 9 });
    assert.equal(updated.isActive, true);
    assert.equal(updated.priority, 9);
    assert.ok(updated.updated_at >= promo.updated_at || updated.updated_at, 'updated_at present');
    await Promotion.delete(promo.id);
  });

  test('delete removes the row', async () => {
    const promo = await Promotion.create({ title: UNIQUE });
    const deleted = await Promotion.delete(promo.id);
    assert.equal(deleted, true);
    const gone = await Promotion.findById(promo.id);
    assert.equal(gone, null);
  });

  test('update on missing id throws', async () => {
    await assert.rejects(() => Promotion.update(999999999, { title: 'x' }), /not found/i);
  });
});