// FILE LOCATION: backend/tests/staffManagementGate.test.js
// DESCRIPTION: `manage_staff` is now wired to the staff routes — with the
//              grant ceiling that is the only reason the wiring is safe.
//
// Two changes are pinned here, from both directions:
//
//   1. ROUTING — GET/POST/PUT/DELETE /api/vendors/staff moved from
//      `protect, vendor` (owner-only) to
//      `vendorOrStaff + requireVendorPermission('manage_staff')`. The old
//      posture made the permission grantable but inert (§8's "delegation
//      costs nothing" item): an owner could tick "Manage staff" and nothing
//      happened. Owners and admins still pass unconditionally — asserted as
//      a regression, because breaking them would take staff management away
//      from the only account that never needed a permission.
//
//   2. THE CEILING — what previously made that wiring dangerous is now
//      refused in the controller: a STAFF caller may never grant a
//      permission they do not hold (they can reach their OWN row through
//      PUT, so without this the route is a ladder to view_earnings), and
//      may never ADD `manage_staff` (delegation of delegation is
//      owner-only, or one stolen manager key mints managers forever —
//      keeping the key on a row that already holds it is allowed, so an
//      ordinary edit never silently demotes a manager).
//
// Without the ceiling the old owner-only pin was correct — this file is the
// proof that the ceiling exists in behaviour, not just in source (the
// source half lives in storefrontPermission.test.js).
//
// Also pins the removal of `reply_reviews` from VALID_PERMISSIONS: no route
// consumes it (there is no reply endpoint), so it was a checkbox that
// granted nothing. normalizePermissions must now drop it from any payload.
//
// NOTE: DB-backed; inserts then cleans up. Skips without MySQL.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// staffRoutes imports the rate limiters; with REDIS_URL set, the client
// connects during module evaluation and the open socket keeps the event
// loop alive forever (same pin as oauthStateGate). Empty string, not
// `delete` — rateLimitMiddleware re-runs dotenv.config() and only leaves
// alone a key that still exists.
process.env.REDIS_URL = '';
process.env.EMAIL_DISABLED = '1';
process.env.JWT_SECRET ||= 'staff-gate-secret-for-tests-only-not-a-key';
process.env.FRONTEND_URL ||= 'http://localhost:5173';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const jwt = (await import('jsonwebtoken')).default;
const express = (await import('express')).default;
const cookieParser = (await import('cookie-parser')).default;
const staffRoutes = (await import('../routes/staffRoutes.js')).default;
const { VALID_PERMISSIONS, normalizePermissions } = await import('../controllers/staffController.js');
const { startServer } = await import('./helpers/httpHarness.js');

const RUN_ID = `mg-${Date.now()}`;
const createdStaffIds = [];
const userIds = [];
let server = null;
let ids = {};

const ownerToken = (userId) =>
  jwt.sign({ id: userId, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
const staffToken = (staffId, vendorUserId) =>
  jwt.sign({ id: staffId, vendorId: vendorUserId, role: 'vendor_staff', tv: 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

const call = async (method, path, token, body) => {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Cookie: `jwt=${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
};

describe('manage_staff: wired routes + the grant ceiling', { skip: !dbAvailable }, () => {
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/vendors/staff', staffRoutes);
    // requireVendorPermission signals refusal by throwing after setting the
    // status — the router itself has no error handler (the real server's
    // does), so one is mounted here exactly like oauthStateGate's.
    app.use((err, req, res, next) => {
      const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
      res.status(status).json({ message: err.message });
    });
    server = await startServer(app);

    // Owner + approved store (the store status matters: vendorOrStaff
    // refuses a non-approved owner, C5).
    const [owner] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion)
       VALUES ('Manage', 'StaffGate', ?, 'not-a-real-password', 'vendor', 1, 1, 0)`,
      [`${RUN_ID}-owner@test.local`],
    );
    ids.owner = owner.insertId;
    userIds.push(ids.owner);
    await pool.execute(
      `INSERT INTO vendors (userId, businessName, status, recipientCode)
       VALUES (?, ?, 'approved', 'RCP_mg')`,
      [ids.owner, `MG Store ${ids.owner}`],
    );

    // manager holds manage_staff (+ one ordinary permission to grant)
    const [mgr] = await pool.execute(
      `INSERT INTO vendor_staff (vendorId, name, email, password, permissions)
       VALUES (?, 'MG Manager', ?, 'not-a-real-password', ?)`,
      [ids.owner, `${RUN_ID}-manager@test.local`,
       JSON.stringify({ manage_staff: true, manage_orders: true })],
    );
    ids.manager = mgr.insertId;
    createdStaffIds.push(ids.manager);

    // clerk holds neither manage_staff nor anything worth escalating to
    const [clerk] = await pool.execute(
      `INSERT INTO vendor_staff (vendorId, name, email, password, permissions)
       VALUES (?, 'MG Clerk', ?, 'not-a-real-password', ?)`,
      [ids.owner, `${RUN_ID}-clerk@test.local`,
       JSON.stringify({ manage_orders: true })],
    );
    ids.clerk = clerk.insertId;
    createdStaffIds.push(ids.clerk);
  });

  after(async () => {
    if (server) await server.close();
    if (pool) {
      try {
        if (createdStaffIds.length) {
          await pool.execute(`DELETE FROM vendor_staff WHERE id IN (${createdStaffIds.map(() => '?').join(',')})`, createdStaffIds);
        }
        await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [ids.owner]);
        if (userIds.length) {
          await pool.execute(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
        }
      } catch (e) {
        console.error('staffManagementGate cleanup:', e.message);
      }
      try { await pool.end(); } catch { /* already closed */ }
    }
    try {
      const { getRedisClient } = await import('../utils/redisClient.js');
      const redis = getRedisClient();
      if (redis) {
        await Promise.race([
          redis.quit().catch(() => Promise.resolve()),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        redis.disconnect();
      }
    } catch { /* Redis not configured — nothing to close */ }
  });

  test('the owner still manages staff — wiring changes nothing for them', async () => {
    const r = await call('GET', '/api/vendors/staff', ownerToken(ids.owner));
    assert.equal(r.status, 200, `owner lost staff management: ${JSON.stringify(r.json)}`);
    assert.ok(Array.isArray(r.json));
  });

  test('unauthenticated → 401, no data', async () => {
    const r = await call('GET', '/api/vendors/staff');
    assert.equal(r.status, 401);
  });

  test('a staff member WITHOUT manage_staff is refused the list', async () => {
    const r = await call('GET', '/api/vendors/staff', staffToken(ids.clerk, ids.owner));
    assert.equal(r.status, 403, `clerk reached the staff list: ${JSON.stringify(r.json)}`);
    assert.match(r.json.message, /manage_staff/);
  });

  test('a staff member WITH manage_staff is admitted — delegation works', async () => {
    const r = await call('GET', '/api/vendors/staff', staffToken(ids.manager, ids.owner));
    assert.equal(r.status, 200, `manager refused: ${JSON.stringify(r.json)}`);
    assert.ok(Array.isArray(r.json));
  });

  test('manager creates staff with a permission THEY hold → 201', async () => {
    const r = await call('POST', '/api/vendors/staff', staffToken(ids.manager, ids.owner), {
      name: 'MG Grantee',
      email: `${RUN_ID}-grantee@test.local`,
      password: 'Passw0rd123',
      permissions: { manage_orders: true },
    });
    assert.equal(r.status, 201, `legitimate grant refused: ${JSON.stringify(r.json)}`);
    createdStaffIds.push(r.json.staff.id);
    assert.equal(r.json.staff.permissions.manage_orders, true);
  });

  test('manager creates staff with a permission they do NOT hold → 403 (no climbing)', async () => {
    const r = await call('POST', '/api/vendors/staff', staffToken(ids.manager, ids.owner), {
      name: 'MG Escalated',
      email: `${RUN_ID}-escalated@test.local`,
      password: 'Passw0rd123',
      permissions: { view_earnings: true },
    });
    assert.equal(r.status, 403, `a manager minted earnings access: ${JSON.stringify(r.json)}`);
    assert.match(r.json.message, /cannot grant/i);
  });

  test('manager cannot mint another manager → 403 (manage_staff is owner-only)', async () => {
    const r = await call('POST', '/api/vendors/staff', staffToken(ids.manager, ids.owner), {
      name: 'MG Chain',
      email: `${RUN_ID}-chain@test.local`,
      password: 'Passw0rd123',
      permissions: { manage_staff: true, manage_orders: true },
    });
    assert.equal(r.status, 403, `manage_staff was delegated: ${JSON.stringify(r.json)}`);
    assert.match(r.json.message, /store owner/);
  });

  test('manager escalating their OWN row through PUT → 403 (the original objection)', async () => {
    // This is the exact vector the old owner-only pin warned about: the
    // manager's own row is inside their vendor, so PUT reaches it. Pure
    // escalation (no manage_staff in the payload) so the assertion lands on
    // the subset rule; the owner-only rule is pinned by the mint-a-manager
    // test above.
    const r = await call('PUT', `/api/vendors/staff/${ids.manager}`, staffToken(ids.manager, ids.owner), {
      permissions: { manage_orders: true, view_earnings: true },
    });
    assert.equal(r.status, 403, `a manager self-granted view_earnings: ${JSON.stringify(r.json)}`);
    assert.match(r.json.message, /cannot grant/i);
    assert.match(r.json.message, /view_earnings/);
  });

  test('manager editing own row within their grant → 200', async () => {
    const r = await call('PUT', `/api/vendors/staff/${ids.manager}`, staffToken(ids.manager, ids.owner), {
      permissions: { manage_staff: true, manage_orders: true },
    });
    assert.equal(r.status, 200, `subset edit refused: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.staff.permissions.manage_orders, true);
  });

  test('owner grants manage_staff and view_earnings freely → 201 (ceiling is staff-only)', async () => {
    const r = await call('POST', '/api/vendors/staff', ownerToken(ids.owner), {
      name: 'MG Delegated',
      email: `${RUN_ID}-delegated@test.local`,
      password: 'Passw0rd123',
      permissions: { manage_staff: true, view_earnings: true },
    });
    assert.equal(r.status, 201, `owner grant refused: ${JSON.stringify(r.json)}`);
    createdStaffIds.push(r.json.staff.id);
    assert.equal(r.json.staff.permissions.manage_staff, true);
    assert.equal(r.json.staff.permissions.view_earnings, true);
  });

  test('reply_reviews is gone from the grantable set and dropped from payloads', () => {
    assert.ok(!VALID_PERMISSIONS.includes('reply_reviews'),
      'reply_reviews is still grantable although no route consumes it');
    const normalized = normalizePermissions({ reply_reviews: true, manage_orders: true });
    assert.ok(!('reply_reviews' in normalized),
      'normalizePermissions kept a permission outside VALID_PERMISSIONS');
    assert.equal(normalized.manage_orders, true);
  });
});
