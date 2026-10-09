// FILE LOCATION: backend/tests/emailResponseBudget.test.js
// DESCRIPTION: N-20 — a business request must never be held open by the mail
//              server.
//
// The production incident: advancing an order to `shipped`/`arrived` wrote the
// row successfully but never answered the browser. The handler awaited a
// customer notification and an SMTP send BEFORE `res.json(...)`, nodemailer's
// stock budgets are 2 MINUTES to connect / 30 s for the greeting / 10 minutes
// of socket idle, and the SPA aborts at 15 s (fetchBaseQuery `timeout:
// 15000`). RTK therefore answered `{ status: 'TIMEOUT_ERROR', data: undefined }`
// — no body to quote — the UI showed a bare "Failed to update order status",
// and the order WAS updated. Firefox recorded the POST as status 0 with the
// toast arriving ~15 s later.
//
// Three assertions, each of which fails if the fix is reverted:
//   (a) behavioural: a mail server that accepts the connection and never
//       speaks must not stall the caller (stock greetingTimeout = 30 s);
//   (b) the configured caps all sit inside the client's 15 s budget;
//   (c) source guard: the vendor status handler answers before it notifies;
//   (d) source guard: NO handler anywhere sequences its response on a send —
//       the ten N-20-class sites (the old "nine" missed one) are all
//       detached, checked over the whole backend tree, with a floor on the
//       detached count so deleting the sends cannot fake a pass either.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sendEmailSafely, createTransporter } from '../utils/emailService.js';

const CLIENT_BUDGET_MS = 15000; // fetchBaseQuery timeout in src/slices/apiSlice.ts

// A black-hole SMTP endpoint: completes the TCP handshake, then never emits a
// 220 greeting. This is what a filtered/blocked relay looks like from inside
// the process, and it is what production was doing for 30 s (or 120 s on a
// refused connect) per send.
const sockets = new Set();
let blackhole = null;

const closeBlackhole = async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (blackhole) {
    const server = blackhole;
    blackhole = null;
    await new Promise((resolve) => server.close(resolve));
  }
};

after(closeBlackhole);

describe('N-20: outbound mail cannot hold a request open', () => {
  test('a silent SMTP server is abandoned inside the client budget', { timeout: 10000 }, async () => {
    // emailEnabled() must report true or the send short-circuits and proves
    // nothing; pin every switch it consults rather than inheriting a .env.
    process.env.EMAIL_HOST = '127.0.0.1';
    process.env.EMAIL_USER = 'probe@example.test';
    process.env.EMAIL_PASSWORD = 'not-a-real-password';
    process.env.ENABLE_EMAIL = 'true';
    delete process.env.EMAIL_DISABLED;
    delete process.env.EMAIL_SERVICE;

    try {
      blackhole = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
      process.env.EMAIL_PORT = String(blackhole.address().port);

      const startedAt = Date.now();
      const delivered = await sendEmailSafely(
        'customer@example.test',
        'N-20 timeout probe',
        '<p>probe</p>',
      );
      const elapsed = Date.now() - startedAt;

      // sendEmailSafely never throws: a stalled relay must degrade to false.
      assert.equal(delivered, false, 'a silent SMTP server must not be reported as sent');
      assert.ok(
        elapsed < 8000,
        `sendEmailSafely waited ${elapsed}ms for a server that never spoke — ` +
          'the greeting timeout is no longer bounded (stock value: 30000ms)',
      );
    } finally {
      await closeBlackhole();
    }
  });

  test('every SMTP stage is capped inside the 15s client budget', () => {
    const { options } = createTransporter();
    for (const key of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
      const value = options[key];
      assert.equal(typeof value, 'number', `${key} is not configured (nodemailer default would apply)`);
      assert.ok(
        value > 0 && value <= CLIENT_BUDGET_MS,
        `${key}=${value}ms can exceed the SPA's ${CLIENT_BUDGET_MS}ms abort budget`,
      );
    }
  });

  test('the vendor status handler responds before it notifies', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../controllers/vendorOrderController.js', import.meta.url)),
      'utf8',
    );
    assert.deepEqual(
      respondsBeforeNotifying(source),
      { ok: true },
      'updateVendorOrderStatus must send its response before awaiting ' +
        'Notification.create / sendOrderStatusEmail — otherwise a slow mail ' +
        'server eats the client timeout and a committed write is reported as a failure',
    );
    // Self-test the matcher: a source that notifies first must be rejected, so
    // a broken extractor cannot make the assertion pass vacuously.
    assert.deepEqual(
      respondsBeforeNotifying(
        'await Notification.create({});\n' +
          'await sendOrderStatusEmail(1, {});\n' +
          'res.json({ message: "Order status updated" });',
      ),
      { ok: false, reason: 'notification runs before the response' },
    );
    // …and one that responds but still awaits the notification inline.
    assert.deepEqual(
      respondsBeforeNotifying(
        'res.json({ message: "Order status updated" });\n' +
          'await Notification.create({});\n' +
          'await sendOrderStatusEmail(1, {});',
      ),
      { ok: false, reason: 'notification is still awaited by the handler' },
    );
  });

  test('no handler sequences its response on an email send (the N-20-class sites)', () => {
    // Whole-tree scan of controllers + routes: any `await send*(…)` there is
    // a handler holding its response open on mail. Exactly one offender is
    // allowed — vendorOrderController's post-response detached block, which
    // the behavioural test above proves answers first. The pattern takes
    // `send[A-Za-z]*`, not `send*Email`, because one of the ten sites is
    // `sendPasswordResetConfirmation`, which has no `Email` suffix and is
    // exactly the name a suffix-scoped grep would miss (the old "nine" tally
    // did).
    const offenders = awaitSitesInTree();
    const unexpected = offenders.filter(
      (site) => !site.startsWith('controllers/vendorOrderController.js'),
    );
    assert.deepEqual(
      unexpected,
      [],
      'a handler awaits an email send before responding — SMTP can still eat ' +
        'the SPA 15 s budget and report a committed write as a failure',
    );
    assert.ok(
      offenders.length <= 1,
      `vendorOrderController's detached block grew extra awaits: ${offenders.join(', ')}`,
    );

    // Deletion cannot fake this pass: the detached sends themselves must
    // still exist. The tree currently holds 13 `void send*(…)` sites across
    // the three files (9 + 2 + 2) — ten of them are the N-20-class sites
    // this finding is about, the rest were detached earlier. If one is ever
    // legitimately REMOVED, lower this consciously, the way a changed
    // invariant should be changed.
    const detached =
      countDetached('../controllers/userController.js') +
      countDetached('../controllers/orderController.js') +
      countDetached('../routes/paymentRoutes.js');
    assert.ok(
      detached >= 10,
      `only ${detached} detached send sites remain across the three files — ` +
        'the sends were deleted rather than detached',
    );

    // Self-test the matcher so a broken regex cannot pass vacuously.
    assert.deepEqual(collectAwaited('await sendOrderStatusEmail(1, {});'), [0]);
    assert.deepEqual(collectAwaited('const info = await transporter.sendMail(o);'), [0]);
    assert.deepEqual(collectAwaited('void sendOTPEmail(1, 2, 3).catch(() => {});'), []);
    assert.deepEqual(collectAwaited('res.json({ message: "done" });'), []);
  });
});

/**
 * Locates the success response of updateVendorOrderStatus and checks that no
 * notification step precedes it. Returns { ok: true } when the ordering is
 * safe, otherwise { ok: false, reason }.
 */
function respondsBeforeNotifying(source) {
  const respondAt = source.indexOf('res.json({ message: "Order status updated"');
  if (respondAt < 0) return { ok: false, reason: 'success response not found' };

  const notifyAt = source.indexOf('await Notification.create(');
  const emailAt = source.indexOf('await sendOrderStatusEmail(');
  if (notifyAt < 0 || emailAt < 0) return { ok: false, reason: 'notification step not found' };

  if (notifyAt < respondAt || emailAt < respondAt) {
    return { ok: false, reason: 'notification runs before the response' };
  }
  // Ordering alone is not enough: the block must be detached (fire-and-forget)
  // rather than awaited by the handler.
  if (!source.slice(respondAt, notifyAt).includes('void (async () => {')) {
    return { ok: false, reason: 'notification is still awaited by the handler' };
  }
  return { ok: true };
}

// `await` of any send-shaped call — `sendOrderStatusEmail`, bare `sendOTP`,
// or an inlined `transporter.sendMail` (a likely way to try to silence this
// guard while keeping the await).
const SEND_AWAIT_RE = /\bawait\s+[\w.$]*send[A-Za-z]*\s*\(/;

/** 0-based indexes of lines in `source` that await a send. */
function collectAwaited(source) {
  const hits = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (SEND_AWAIT_RE.test(line)) hits.push(i);
  });
  return hits;
}

/** `dir/relative/path.js:line` for every awaited send under controllers/ + routes/. */
function awaitSitesInTree() {
  const sites = [];
  for (const dir of ['controllers', 'routes']) {
    const root = fileURLToPath(new URL(`../${dir}/`, import.meta.url));
    for (const entry of readdirSync(root, { recursive: true })) {
      const abs = join(root, String(entry));
      if (!abs.endsWith('.js')) continue;
      for (const i of collectAwaited(readFileSync(abs, 'utf8'))) {
        sites.push(`${dir}/${entry}:${i + 1}`);
      }
    }
  }
  return sites.sort();
}

/** Count of fire-and-forget `void send*(…)` sites in one file. */
function countDetached(relative) {
  const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
  return (source.match(/\bvoid\s+send[A-Za-z]*\s*\(/g) || []).length;
}
