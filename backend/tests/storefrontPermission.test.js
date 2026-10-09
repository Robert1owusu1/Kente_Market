// FILE LOCATION: backend/tests/storefrontPermission.test.js
// DESCRIPTION: A8 — the one mutating vendor route with no permission behind it.
//
// Every other write under `/api/vendors` sat behind
// `requireVendorPermission(...)`. `PUT /api/vendors/profile` did not: it went
// straight from `vendorOrStaff` to the handler. Since `requireVendorPermission`
// passes any vendor OWNER unconditionally, the check exists to constrain
// STAFF — and a staff account with a completely empty permission object could
// still rename the store, move its `/store/:slug` URL, and rewrite the logo,
// cover image, weaver story and social links that the public storefront page
// renders. That is the whole storefront, reauthored by the lowest-privilege
// role in the system.
//
// The fix needed three coordinated pieces, because the permission has to exist
// in three places before it can mean anything:
//   1. VALID_PERMISSIONS (staffController) — normalizePermissions iterates this
//      list, so a key absent here is silently dropped from every stored record.
//   2. The route chain (vendorRoutes) — where the check is actually enforced.
//   3. ALL_PERMISSIONS + permLabels (VendorStaff.tsx) — where the vendor ever
//      gets the chance to grant it.
//
// The last three tests below are the ones that matter most: they parse every
// mounted route rather than hard-coding the one this finding touched, so the
// next `router.route(...).put(vendorOrStaff, handler)` added without a
// permission fails here instead of shipping.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { requireVendorPermission } = await import('../middleware/authMiddleware.js');

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const staffControllerSrc = read('../controllers/staffController.js');
const vendorRoutesSrc = read('../routes/vendorRoutes.js');
const customRequestSrc = read('../routes/customRequestRoutes.js');
const staffRoutesSrc = read('../routes/staffRoutes.js');
const staffUiSrc = read('../../src/Pages/Vendor/VendorStaff.tsx');

// `requireVendorPermission` is fully synchronous and signals refusal by
// THROWING after setting res.statusCode — so this has to catch, not await.
// Awaiting would surface the refusal as an unhandled rejection instead of as
// the assertion this file is here to make.
const callPermission = (permission, { user, staff } = {}) => {
  const middleware = requireVendorPermission(permission);
  const req = { user, staff };
  let status = 200;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  let nextCalled = false;
  try {
    middleware(req, res, () => { nextCalled = true; });
  } catch (error) {
    return { nextCalled, status, error: error.message };
  }
  return { nextCalled, status, error: null };
};

const storeFrontStaff = (permissions) => ({
  user: { id: 77, role: 'vendor' },
  staff: { id: 5, permissions },
});

describe('A8: manage_storefront gates the public storefront write', () => {
  test('a staff member with NO permissions is refused', () => {
    const r = callPermission('manage_storefront', storeFrontStaff({}));
    assert.equal(r.nextCalled, false, 'an empty permission object reached updateVendorProfile');
    assert.equal(r.status, 403);
    assert.match(r.error, /manage_storefront/);
  });

  test('a legacy staff record that predates the key is refused', () => {
    // normalizePermissions rewrites records to a complete key set on save, but
    // rows created before this fix carry only the original eight keys. A
    // missing key must read as "not granted", never as "granted".
    const legacy = storeFrontStaff({
      manage_orders: true,
      view_customers: true,
      manage_inventory: true,
      view_earnings: true,
      manage_products: true,
      manage_coupons: true,
      reply_reviews: true,
      manage_staff: true,
    });
    const r = callPermission('manage_storefront', legacy);
    assert.equal(r.nextCalled, false, 'a staff member with every OLD permission could edit the storefront');
    assert.equal(r.status, 403);
  });

  test('a staff member holding the permission is admitted', () => {
    const r = callPermission('manage_storefront', storeFrontStaff({ manage_storefront: true }));
    assert.equal(r.error, null, `granted staff refused: ${r.error}`);
    assert.equal(r.nextCalled, true);
  });

  test('the vendor owner is admitted — the check constrains staff, not owners', () => {
    const r = callPermission('manage_storefront', { user: { id: 1, role: 'vendor' } });
    assert.equal(r.error, null, `owner refused: ${r.error}`);
    assert.equal(r.nextCalled, true);
  });

  test('an admin is admitted', () => {
    const r = callPermission('manage_storefront', { user: { id: 1, role: 'admin' } });
    assert.equal(r.nextCalled, true, `admin refused: ${r.error}`);
  });

  test('a non-vendor still cannot pass', () => {
    const r = callPermission('manage_storefront', { user: { id: 9, role: 'customer' } });
    assert.equal(r.nextCalled, false);
    assert.equal(r.status, 403);
    assert.match(r.error, /Not authorized/);
  });
});

// ---------------------------------------------------------------------------
// The three places a permission has to exist
// ---------------------------------------------------------------------------
describe('A8: the permission exists everywhere it has to', () => {
  test('VALID_PERMISSIONS contains manage_storefront', () => {
    const listSrc = staffControllerSrc.slice(
      staffControllerSrc.indexOf('const VALID_PERMISSIONS = ['),
      staffControllerSrc.indexOf('];', staffControllerSrc.indexOf('const VALID_PERMISSIONS = [')) + 2,
    );
    assert.match(listSrc, /'manage_storefront'/);
  });

  test('normalizePermissions derives from VALID_PERMISSIONS, not a second copy', () => {
    // If this ever hard-codes its own array, adding a permission to
    // VALID_PERMISSIONS will not store it and every grant will be discarded.
    const normalizeSrc = staffControllerSrc.slice(
      staffControllerSrc.indexOf('const normalizePermissions'),
      staffControllerSrc.indexOf('const STAFF_MAX_FAILED'),
    );
    assert.match(normalizeSrc, /for \(const perm of VALID_PERMISSIONS\)/);
    assert.ok(!/for \(const perm of \[/.test(normalizeSrc), 'normalizePermissions hard-codes its own list');
  });

  test('the frontend offers the permission with a label a vendor can read', () => {
    assert.match(staffUiSrc, /'manage_storefront'/, 'VendorStaff ALL_PERMISSIONS omits it');
    assert.match(staffUiSrc, /manage_storefront: '/, 'VendorStaff permLabels omits it — an unlabelled checkbox');
  });

  test('every backend permission is both listed and labelled in the UI', () => {
    const listSrc = staffControllerSrc.slice(
      staffControllerSrc.indexOf('const VALID_PERMISSIONS = ['),
      staffControllerSrc.indexOf('];', staffControllerSrc.indexOf('const VALID_PERMISSIONS = [')),
    );
    const backendPerms = [...listSrc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(backendPerms.includes('manage_storefront'), 'parse failed');

    const uiListSrc = staffUiSrc.slice(
      staffUiSrc.indexOf('const ALL_PERMISSIONS = ['),
      staffUiSrc.indexOf('];', staffUiSrc.indexOf('const ALL_PERMISSIONS = [')),
    );
    const uiPerms = new Set([...uiListSrc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

    const labelsSrc = staffUiSrc.slice(
      staffUiSrc.indexOf('const permLabels'),
      staffUiSrc.indexOf('const statusBadge'),
    );

    for (const perm of backendPerms) {
      assert.ok(uiPerms.has(perm), `"${perm}" is grantable in the API but not offered in the UI`);
      assert.match(labelsSrc, new RegExp(`${perm}:`), `"${perm}" has no label in the UI`);
    }
  });
});

// ---------------------------------------------------------------------------
// Systemic: parse the routes instead of hard-coding this finding's one
// ---------------------------------------------------------------------------
/**
 * Every `router.route(...).METHOD(...)` line that carries `vendorOrStaff`.
 * Splitting on ',' is safe here because handler arguments never contain a
 * comma — `requireVendorPermission('x')` and `validate(productPriceSchema)`
 * are both comma-free.
 */
const parseVendorRoutes = (src) =>
  src
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('router.route(') && line.includes('vendorOrStaff'))
    .map((line) => {
      const methodMatch = line.match(/\.(get|post|put|delete)\(/);
      assert.ok(methodMatch, `no HTTP method on: ${line}`);
      const open = line.indexOf('(', methodMatch.index);
      const inner = line.slice(open + 1, line.lastIndexOf(')'));
      const parts = inner.split(',').map((p) => p.trim());
      const permPart = parts.find((p) => p.startsWith('requireVendorPermission(')) || '';
      const permMatch = permPart.match(/'([a-z_]+)'/);
      return {
        line,
        method: methodMatch[1],
        hasVendorOrStaff: parts[0] === 'vendorOrStaff',
        permission: permMatch ? permMatch[1] : null,
      };
    });

const backendPermissions = (() => {
  const listSrc = staffControllerSrc.slice(
    staffControllerSrc.indexOf('const VALID_PERMISSIONS = ['),
    staffControllerSrc.indexOf('];', staffControllerSrc.indexOf('const VALID_PERMISSIONS = [')),
  );
  return [...listSrc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
})();

describe('A8: no vendor route silently skips the permission layer', () => {
  const routes = [
    ...parseVendorRoutes(vendorRoutesSrc),
    ...parseVendorRoutes(customRequestSrc),
  ];

  test('the parser actually found routes', () => {
    assert.ok(routes.length >= 15, `only parsed ${routes.length} vendorOrStaff routes`);
    assert.ok(routes.some((r) => r.permission === 'manage_storefront'), 'the fixed route was not parsed');
  });

  test('every MUTATING vendorOrStaff route carries a permission', () => {
    const ungated = routes.filter((r) => r.method !== 'get' && !r.permission);
    assert.deepEqual(
      ungated.map((r) => r.line),
      [],
      'these write routes run with no permission check at all',
    );
  });

  test('every permission a route asks for is one staff can actually be granted', () => {
    const unknown = routes
      .filter((r) => r.permission && !backendPermissions.includes(r.permission))
      .map((r) => `${r.permission} (${r.line})`);
    assert.deepEqual(unknown, [], 'a route demands a permission that does not exist, so staff can never hold it');
  });

  test('PUT /api/vendors/profile specifically is gated', () => {
    const profile = routes.find((r) => r.line.includes("'/profile'"));
    assert.ok(profile, '/profile route not found');
    assert.equal(profile.method, 'put');
    assert.equal(profile.permission, 'manage_storefront');
    assert.ok(profile.hasVendorOrStaff, 'the profile route lost vendorOrStaff');
  });

  test('GET routes are read-only by inspection, not by assumption', () => {
    // `/me` and `/reviews` are the only ungated reads. Both return only the
    // caller's own data (or reviews that are public anyway) — recorded here so
    // that widening this exemption is a deliberate edit rather than an
    // unnoticed one.
    const ungatedReads = routes
      .filter((r) => r.method === 'get' && !r.permission)
      .map((r) => r.line);
    assert.ok(
      ungatedReads.every((l) => l.includes("'/me'") || l.includes("'/reviews'")),
      `new ungated read route: ${ungatedReads.join(' | ')}`,
    );
  });

  test('staff management is gated by manage_staff, and the grant ceiling is what makes that safe', () => {
    // This used to pin staffRoutes as owner-only, because wiring the
    // grantable `manage_staff` there would have let a staff member reach
    // updateStaff on their OWN row and rewrite their permission set
    // (granting themselves view_earnings). The wiring is now done — with
    // the ceiling that answers that exact objection: grantCeiling refuses
    // any permission the caller does not hold, and refuses to ADD
    // manage_staff (owner-only promotion; keeping it on a row that has it
    // stays allowed so edits never silently demote). Both halves must
    // stay: routes without the ceiling is the escalation, the ceiling
    // without the routes is theatre.
    assert.ok(staffRoutesSrc.includes('vendorOrStaff'), 'staffRoutes lost vendorOrStaff — delegation no longer works');
    assert.ok(
      staffRoutesSrc.includes("requireVendorPermission('manage_staff')"),
      'staffRoutes is no longer gated by manage_staff',
    );
    assert.ok(!staffRoutesSrc.includes('protect, vendor'), 'staffRoutes fell back to the owner-only pair');
    const gated = staffRoutesSrc.match(/requireVendorPermission\('manage_staff'\)/g) || [];
    assert.equal(gated.length, 4, `all four staff routes must carry the gate, found ${gated.length}`);

    const ceilingSrc = staffControllerSrc.slice(
      staffControllerSrc.indexOf('const grantCeiling'),
      staffControllerSrc.indexOf('// @desc    Create a staff account'),
    );
    assert.ok(ceilingSrc.length > 0, 'grantCeiling is missing from staffController');
    assert.match(ceilingSrc, /!req\.staff/, 'grantCeiling no longer bypasses owners/admins');
    assert.match(ceilingSrc, /req\.staff\.permissions\[p\]/, 'grantCeiling no longer checks what the caller holds');
    assert.match(ceilingSrc, /manage_staff/, 'grantCeiling no longer protects manage_staff itself');

    // ...and BOTH write paths consult it (create AND update — update is the
    // self-grant vector, since staff can edit their own row). Matched by
    // prefix because update passes the target row's current permissions as
    // a third argument.
    const calls = staffControllerSrc.match(/grantCeiling\(req, permissions/g) || [];
    assert.equal(calls.length, 2, `grantCeiling must guard both create and update, found ${calls.length} call(s)`);
  });
});
