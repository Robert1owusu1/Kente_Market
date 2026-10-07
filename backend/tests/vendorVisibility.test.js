// FILE LOCATION: backend/tests/vendorVisibility.test.js
// DESCRIPTION: N-6 — suspending a vendor did not hide their products.
//
// Two independent reasons it failed, and the fixtures below reproduce both:
//
//   1. The guard was written as `if (!approvalStatus && !vendorId)`, but the
//      PUBLIC controller always passes approvalStatus='approved'
//      (publicApprovalFilter defaults every non-admin caller to it). So the
//      guard was skipped on exactly the path it was written for, and applied
//      to the admin view instead — inverted.
//   2. Three queries never went through findAll at all: the museum showcase,
//      campaign product lists, and getCategories. And `count()` had no vendors
//      join, so pagination totals disagreed with the rows actually returned.
//
// The exploit being tested is deliberately NOT a pending product — those were
// already filtered by approvalStatus. It is a fully APPROVED product whose
// VENDOR was then suspended: approval is a property of the product, status is
// a property of the vendor, and only the join notices the difference.
//
// `OR p.vendorId IS NULL` matters because fixtures and platform stock have no
// vendor, and the join is a LEFT JOIN — a WHERE on the right-hand table turns
// it back into an INNER JOIN and would hide every platform product (the exact
// trap findById already fell into).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
const TOKEN = `VISBIL${ts}`;
const CATEGORY = `viscat${ts}`;
const state = { productIds: [], vendorUserIds: [] };

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const makeVendor = async (status, tag) => {
  const [user] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('Vis', 'Test', ?, 'hashedpass', 'vendor', 1, 1)`,
    [`vis-${tag}-${ts}@test.local`],
  );
  const userId = user.insertId;
  state.vendorUserIds.push(userId);
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode)
     VALUES (?, ?, ?, 'RCP_vis')`,
    [userId, `Vis Vendor ${tag} ${ts}`, status],
  );
  return userId;
};

const makeProduct = async ({
  title,
  vendorId = null, // platform product — the column is nullable on purpose
  approvalStatus = 'approved',
  category = 'vistest',
  rating = 0,
  reviews = 0,
}) => {
  const [res] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, approvalStatus, rating, reviews)
     VALUES (?, '/uploads/vis.png', 40, ?, 5, ?, ?, ?, ?)`,
    [title, category, vendorId, approvalStatus, rating, reviews],
  );
  state.productIds.push(res.insertId);
  return res.insertId;
};

before(async () => {
  if (!dbAvailable || !pool) return;

  state.platformVendor = await makeVendor('approved', 'OK');
  state.suspendedVendor = await makeVendor('suspended', 'SUS');
  state.pendingVendor = await makeVendor('pending', 'PEN');

  // Platform product (vendorId NULL) — must stay visible everywhere public.
  state.platform = await makeProduct({ title: `${TOKEN} platform` });
  // Approved product on an approved vendor — the control.
  state.ok = await makeProduct({ title: `${TOKEN} ok`, vendorId: state.platformVendor });
  // THE EXPLOIT: approved product, suspended vendor. Approval alone hides
  // nothing; only the join does.
  state.laundered = await makeProduct({
    title: `${TOKEN} laundered`,
    vendorId: state.suspendedVendor,
    category: CATEGORY, // a category nobody else has — only reachable if visible
    rating: 5,
    reviews: 999999, // top of the trending ranking if the guard is missing
  });
  // Suspended vendor's product in the moderation queue — moderation must STILL
  // be able to see it, which is the bypass half of the same guard.
  state.queue = await makeProduct({
    title: `${TOKEN} queue`,
    vendorId: state.pendingVendor,
    approvalStatus: 'pending',
  });
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    if (state.productIds.length) {
      await pool.execute(
        `DELETE FROM product WHERE id IN (${state.productIds.map(() => '?').join(',')})`,
        state.productIds,
      );
    }
    if (state.vendorUserIds.length) {
      await pool.execute(
        `DELETE FROM vendors WHERE userId IN (${state.vendorUserIds.map(() => '?').join(',')})`,
        state.vendorUserIds,
      );
      await pool.execute(
        `DELETE FROM users WHERE id IN (${state.vendorUserIds.map(() => '?').join(',')})`,
        state.vendorUserIds,
      );
    }
  } finally {
    await pool.end();
  }
});

describe('N-6: a suspended vendor disappears from the storefront', { skip: !dbAvailable }, () => {
  let Product;

  before(async () => {
    Product = (await import('../models/productModel.js')).default;
  });

  const publicIds = async (extra = {}) => {
    const rows = await Product.findAll({
      search: TOKEN,
      approvalStatus: 'approved',
      limit: 1000,
      ...extra,
    });
    return new Set(rows.map((p) => p.id));
  };

  test('an APPROVED product on a suspended vendor is not listed', async () => {
    const ids = await publicIds();
    assert.ok(!ids.has(state.laundered), 'suspended vendor product leaked into the public listing');
    // Both halves of the invariant, so a test that hid everything would fail.
    assert.ok(ids.has(state.platform), 'platform product (vendorId NULL) must stay visible');
    assert.ok(ids.has(state.ok), 'approved product on an approved vendor must stay visible');
  });

  test('count() agrees with findAll(), not with the raw table', async () => {
    const rows = await Product.findAll({
      search: TOKEN,
      approvalStatus: 'approved',
      limit: 1000,
    });
    const total = await Product.count({ search: TOKEN, approvalStatus: 'approved' });
    assert.equal(
      Number(total),
      rows.length,
      `pagination total ${total} disagrees with the ${rows.length} rows the list returns — hasMore would lie`,
    );
    assert.equal(rows.length, 2, 'expected exactly the platform + approved-vendor products');
  });

  test('count() excludes suspended vendors rather than counting them', async () => {
    const withVendors = await Product.count({ search: TOKEN, approvalStatus: 'approved' });
    const unfiltered = await Product.count({ search: TOKEN, approvalStatus: 'approved', allVendors: true });
    assert.equal(
      Number(withVendors),
      Number(unfiltered) - 1,
      'the suspended vendor product is not being subtracted from the total',
    );
  });

  test('trending excludes it even though it is top-ranked', async () => {
    const trending = await Product.findTrending({ approvalStatus: 'approved', limit: 500 });
    const ids = new Set(trending.map((p) => p.id));
    assert.ok(!ids.has(state.laundered), 'suspended vendor product reached the public trending rail');

    // Negative control: the same query with the guard explicitly bypassed must
    // return it — otherwise the assertion above passes merely because the
    // product is ranked too low to make the cutoff.
    const bypassed = await Product.findTrending({
      approvalStatus: 'approved',
      allVendors: true,
      limit: 500,
    });
    assert.ok(
      new Set(bypassed.map((p) => p.id)).has(state.laundered),
      'the product is not rankable at all — this test is not proving what it claims',
    );
  });

  test('getCategories no longer names a category only a suspended vendor has', async () => {
    const cats = await Product.getCategories('approved');
    assert.ok(!cats.includes(CATEGORY), 'suspended vendor category leaked into the public facet list');
    // Bypass half: the moderation view still gets it.
    const all = await Product.getCategories(null);
    assert.ok(all.includes(CATEGORY), 'moderation must still see every category');
  });

  test('the moderation queue still reaches products of non-approved vendors', async () => {
    const rows = await Product.findAll({ search: TOKEN, approvalStatus: 'pending', limit: 1000 });
    assert.ok(
      new Set(rows.map((p) => p.id)).has(state.queue),
      'the guard hid a product the moderator is supposed to act on',
    );
  });

  test('the admin ?approvalStatus=all view reaches suspended vendors too', async () => {
    const rows = await Product.findAll({
      search: TOKEN,
      allVendors: true,
      limit: 1000,
    });
    const ids = new Set(rows.map((p) => p.id));
    assert.ok(ids.has(state.laundered), 'allVendors bypass is not reaching findAll');
    assert.ok(ids.has(state.queue), 'allVendors should not suppress approval statuses either');
  });
});

// ---------------------------------------------------------------------------
// The paths that never went through findAll
// ---------------------------------------------------------------------------
describe('N-6: every public product query carries the guard', () => {
  const productControllerSrc = read('../controllers/productController.js');
  const campaignControllerSrc = read('../controllers/campaignController.js');
  const productModelSrc = read('../models/productModel.js');

  test('the museum showcase joins vendor status', () => {
    const museum = productControllerSrc.slice(
      productControllerSrc.indexOf('const getMuseumPieces'),
      productControllerSrc.indexOf('const getProducts'),
    );
    assert.match(museum, /LEFT JOIN vendors v/, 'museum query does not join vendors at all');
    assert.match(museum, /v\.status = 'approved'/, 'museum query lost the vendor-visibility guard');
    assert.match(museum, /p\.vendorId IS NULL/, 'museum query would hide platform products');
  });

  test('campaign product lists join vendor status', () => {
    assert.match(campaignControllerSrc, /v\.status = 'approved'/, 'campaign query lost the guard');
    assert.match(campaignControllerSrc, /p\.vendorId IS NULL/, 'campaign query would hide platform products');
  });

  test('findAll, trending, count and getCategories all use the NULL-aware form', () => {
    // Strip line comments first: the findById explanation in this very file
    // quotes `AND v.status = 'approved'` as the thing NOT to do, and a raw
    // substring test matches its own documentation. (Same trap the metrics
    // auth test hit.) The class must exclude \r as well as \n: this file is
    // CRLF end-to-end and `.` does not match line terminators in JS, so a
    // plain /\/\/.*$/ silently leaves the \r-terminated comments untouched.
    const codeOnly = productModelSrc
      .split('\n')
      .map((line) => line.replace(/\/\/[^\r\n]*/, ''))
      .join('\n');

    const occurrences = (codeOnly.match(/v\.status = 'approved' OR p\.vendorId IS NULL/g) || []).length;
    assert.ok(occurrences >= 4, `expected the guard in findAll, trending, count and getCategories, found ${occurrences}`);
    // A bare `AND v.status = 'approved'` anywhere is the inner-join bug.
    assert.ok(
      !/AND v\.status = 'approved'/.test(codeOnly),
      'a non-NULL-aware vendor predicate is back — platform products will vanish',
    );
  });

  test('count() joins vendors at all', () => {
    const countBody = productModelSrc.slice(
      productModelSrc.indexOf('static async count'),
      productModelSrc.indexOf('static async getCategories'),
    );
    assert.match(countBody, /LEFT JOIN vendors v/, 'count() never joins vendors, so totals cannot match findAll');
    assert.match(countBody, /searchPredicate\(connection, options\.search, 'p'\)/,
      'count() must alias the search columns or the joined query is ambiguous');
  });

  test('admin "all" reaches findAll as an explicit bypass', () => {
    assert.match(productControllerSrc, /allVendors: true/, 'the admin all-view was never given a bypass');
  });

  test('suspending a vendor invalidates the product cache', () => {
    // The database fix alone is invisible if the storefront keeps serving the
    // suspended vendor's stock from cache until the TTL expires.
    const vendorControllerSrc = read('../controllers/vendorController.js');
    const body = vendorControllerSrc.slice(
      vendorControllerSrc.indexOf('export const updateVendorStatus'),
      vendorControllerSrc.indexOf('export const', vendorControllerSrc.indexOf('export const updateVendorStatus') + 10),
    );
    assert.match(body, /clearCache\('products'\)/, 'updateVendorStatus does not invalidate the product cache');
    assert.match(vendorControllerSrc, /import \{ clearCache \} from '\.\.\/middleware\/cacheMiddleware\.js'/);
  });
});
