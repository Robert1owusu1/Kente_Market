#!/usr/bin/env node
// FILE LOCATION: backend/scripts/staging-smoke.mjs
// DESCRIPTION: Read-only post-deploy smoke test for a hosted environment.
//   Sends only GETs and requests that the server must REJECT (unsigned webhook,
//   foreign-origin POST, forged token) — nothing is created, paid or emailed.
//
//   node scripts/staging-smoke.mjs --web=https://<frontend-origin> [--api=https://<api-origin>]
//
//   --web  the public frontend origin (requests go through its /api rewrite)
//   --api  the backend's own origin, if different (health, direct-origin checks)
//   --allow-http  permit http:// origins (local rehearsal only)
// Exit code 1 if any check fails.

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const web = String(args.get('web') || '').replace(/\/+$/, '');
const api = String(args.get('api') || web).replace(/\/+$/, '');
const allowHttp = Boolean(args.get('allow-http'));
if (!web) {
  console.error('usage: node scripts/staging-smoke.mjs --web=https://<frontend-origin> [--api=https://<api-origin>]');
  process.exit(2);
}
for (const o of [web, api]) {
  if (!/^https:\/\//.test(o) && !(allowHttp && /^http:\/\//.test(o))) {
    console.error(`refusing non-https origin ${o} (use --allow-http for a local rehearsal)`);
    process.exit(2);
  }
}

const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push(['PASS', name, detail || '']);
  } catch (err) {
    results.push(['FAIL', name, err.message]);
  }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const get = (url, headers = {}) => fetch(url, { headers, redirect: 'manual' });

await check('backend readiness (/health/ready)', async () => {
  const r = await get(`${api}/health/ready`);
  const body = await r.json().catch(() => ({}));
  expect(r.status === 200 && body.db === 'ok', `status ${r.status}, db=${body.db}`);
  return `db ${body.db}`;
});

await check('API reachable through the frontend origin (rewrite)', async () => {
  const r = await get(`${web}/api/products?limit=1`);
  expect(r.status === 200, `status ${r.status}`);
  expect((r.headers.get('content-type') || '').includes('application/json'), 'not JSON — rewrite missing?');
});

await check('SPA served with fallback (deep link)', async () => {
  const r = await get(`${web}/product/1`);
  expect(r.status === 200 && (r.headers.get('content-type') || '').includes('text/html'), `status ${r.status}`);
});

await check('CORS allows the frontend origin', async () => {
  const r = await get(`${api}/api/products?limit=1`, { Origin: web });
  expect(r.headers.get('access-control-allow-origin') === web, `ACAO=${r.headers.get('access-control-allow-origin')}`);
  expect(r.headers.get('access-control-allow-credentials') === 'true', 'credentials not allowed');
});

await check('CORS refuses a foreign origin', async () => {
  const r = await get(`${api}/api/products?limit=1`, { Origin: 'https://evil.example' });
  expect(!r.headers.get('access-control-allow-origin'), `ACAO=${r.headers.get('access-control-allow-origin')}`);
});

await check('foreign-origin state change rejected (CSRF layer 1)', async () => {
  const r = await fetch(`${api}/api/users/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}',
  });
  expect(r.status === 403, `status ${r.status}`);
});

await check('security headers', async () => {
  const r = await get(`${api}/api/products?limit=1`);
  const missing = ['strict-transport-security', 'x-content-type-options', 'content-security-policy', 'referrer-policy']
    .filter((h) => !r.headers.get(h));
  expect(missing.length === 0 || (allowHttp && missing.join() === 'strict-transport-security'), `missing ${missing.join(', ')}`);
  expect(!r.headers.get('x-powered-by'), 'x-powered-by exposed');
});

await check('CSRF token cookie is Secure and SameSite', async () => {
  const r = await get(`${web}/api/auth/csrf-token`);
  const cookie = (r.headers.getSetCookie?.() || []).find((c) => c.startsWith('csrf_token=')) || '';
  expect(r.status === 200 && cookie, `status ${r.status}, cookie ${cookie ? 'set' : 'missing'}`);
  expect(/;\s*SameSite=/i.test(cookie), 'no SameSite');
  expect(allowHttp || /;\s*Secure/i.test(cookie), 'cookie not Secure');
});

await check('unsigned Paystack webhook rejected', async () => {
  const r = await fetch(`${api}/api/payments/paystack-webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'f'.repeat(128) },
    body: JSON.stringify({ event: 'charge.success', data: { reference: `smoke-${Date.now()}`, amount: 100, currency: 'GHS' } }),
  });
  expect(r.status === 400, `status ${r.status}`);
});

await check('forged session token rejected', async () => {
  const forged = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"id":1,"tv":0}').toString('base64url')}.`;
  const r = await get(`${api}/api/users/profile`, { Cookie: `jwt=${forged}` });
  expect(r.status === 401, `status ${r.status}`);
});

await check('metrics not public', async () => {
  const r = await get(`${api}/metrics`);
  expect(r.status === 401 || r.status === 403 || r.status === 404, `status ${r.status}`);
});

await check('uploads path traversal refused', async () => {
  const r = await get(`${api}/uploads/%2e%2e/%2e%2e/package.json`);
  expect(r.status === 404 || r.status === 400 || r.status === 403, `status ${r.status}`);
  const text = await r.text();
  expect(!text.includes('"dependencies"'), 'package.json content returned');
});

await check('admin API refuses anonymous callers', async () => {
  const r = await get(`${api}/api/admin/payouts/unresolved`);
  expect(r.status === 401, `status ${r.status}`);
});

const width = Math.max(...results.map(([, n]) => n.length));
for (const [level, name, detail] of results) console.log(`${level}  ${name.padEnd(width)}  ${detail}`);
const fails = results.filter(([l]) => l === 'FAIL').length;
console.log(`\n${fails ? `${fails} FAILED` : 'all passed'} (${results.length} checks; web ${new URL(web).host}, api ${new URL(api).host})`);
process.exit(fails ? 1 : 0);
