// FILE LOCATION: backend/tests/profileUploadStorage.test.js
// DESCRIPTION: STORE-1 — profile pictures were written with multer.diskStorage
//   straight into backend/uploads/profiles, bypassing storageService, so with
//   STORAGE_BACKEND=s3 on a host without a persistent disk every profile
//   picture vanished on redeploy. This drives the real route in S3 mode
//   against a fake S3 endpoint on loopback (nothing leaves the machine):
//   upload → object PUT under profiles/, user row holds the object URL, nothing
//   written to uploads/profiles; replace → old object DELETEd; DELETE route →
//   object removed, column cleared; forged image → 400, nothing stored.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';
process.env.JWT_SECRET ||= 'profile-upload-secret-for-tests-only';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilesDir = path.join(backendDir, 'uploads', 'profiles');
const TS = `${Date.now()}`;
/** @type {Array<{ method: string, url: string, bytes: number }>} */
const s3Calls = [];
const objects = new Map();
let s3 = null;
let api = null;
let userId = 0;
let cookie = '';

const listProfilesDir = () => (fs.existsSync(profilesDir) ? new Set(fs.readdirSync(profilesDir)) : new Set());

describe('profile pictures go through storageService (STORE-1)', { skip: !dbAvailable && 'no database' }, () => {
  /** @type {Set<string>} */
  let localBefore;

  before(async () => {
    // Fake S3: records PUT/DELETE/HEAD, keeps objects in memory.
    s3 = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        s3Calls.push({ method: req.method, url: req.url, bytes: body.length, auth: String(req.headers.authorization || '') });
        if (req.method === 'PUT') { objects.set(req.url, body); res.writeHead(200); return res.end(); }
        if (req.method === 'DELETE') { const had = objects.delete(req.url); res.writeHead(had ? 204 : 404); return res.end(); }
        res.writeHead(objects.has(req.url) ? 200 : 404); res.end();
      });
    });
    await new Promise((r) => s3.listen(0, '127.0.0.1', r));
    const { port } = s3.address();
    // storageService reads STORAGE_BACKEND at import time: set before importing the route.
    Object.assign(process.env, {
      STORAGE_BACKEND: 's3', S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_BUCKET: 'kente-test',
      S3_ACCESS_KEY_ID: 'test-access-key', S3_SECRET_ACCESS_KEY: 'test-secret-key', S3_REGION: 'auto', S3_PATH_STYLE: 'true',
      S3_PUBLIC_BASE_URL: 'https://cdn.example.test/kente',
    });

    const [u] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('Pic', 'Test', ?, 'x', 'customer', 1, 1)`, [`pic-${TS}@example.test`]
    );
    userId = u.insertId;
    const { signUserToken } = await import('../utils/generateToken.js');
    cookie = `jwt=${signUserToken({ id: userId, role: 'customer', tokenVersion: 0 })}`;

    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const profileRoutes = (await import('../routes/profileRoutes.js')).default;
    const { startServer } = await import('./helpers/httpHarness.js');
    const app = express();
    app.use(cookieParser());
    app.use('/api/profile', profileRoutes);
    app.use((err, req, res, next) => res.status(400).json({ message: err.message })); // multer filter errors
    api = await startServer(app);
    localBefore = listProfilesDir();
  });

  after(async () => {
    if (api) await api.close();
    if (s3) await new Promise((r) => s3.close(r));
    if (pool) {
      await pool.execute(`DELETE FROM users WHERE id = ?`, [userId]).catch(() => {});
      await pool.end().catch(() => {});
    }
  });

  const png = async () => (await import('sharp')).default({
    create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 120, b: 40 } },
  }).png().toBuffer();

  const uploadPicture = async (bytes, name = 'me.png', type = 'image/png') => {
    const form = new FormData();
    form.append('profilePicture', new Blob([bytes], { type }), name);
    const res = await fetch(`${api.baseUrl}/api/profile/upload`, { method: 'POST', headers: { cookie }, body: form });
    return { status: res.status, body: await res.json() };
  };
  const stored = async () => (await pool.execute(`SELECT profile_picture FROM users WHERE id = ?`, [userId]))[0][0].profile_picture;

  test('upload stores the object in S3 under profiles/ and saves its public URL', async () => {
    const r = await uploadPicture(await png(), 'holiday.PNGX.png');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.profilePicture, /^https:\/\/cdn\.example\.test\/kente\/profiles\/profile_[0-9a-f-]{36}\.png$/);
    assert.equal(await stored(), r.body.profilePicture);
    const put = s3Calls.filter((c) => c.method === 'PUT');
    assert.equal(put.length, 1);
    assert.match(put[0].url, /^\/kente-test\/profiles\/profile_[0-9a-f-]{36}\.png$/);
    assert.ok(put[0].bytes > 0);
    assert.match(put[0].auth, /^AWS4-HMAC-SHA256 Credential=test-access-key\//, 'request is SigV4-signed');
    assert.deepEqual(listProfilesDir(), localBefore, 'nothing written to backend/uploads/profiles');
  });

  test('replacing the picture deletes the previous object after the new one is saved', async () => {
    const first = await stored();
    const r = await uploadPicture(await png());
    assert.equal(r.status, 200);
    const firstKey = `/kente-test/profiles/${first.split('/').pop()}`;
    const del = s3Calls.filter((c) => c.method === 'DELETE');
    assert.deepEqual(del.map((c) => c.url), [firstKey]);
    assert.equal(objects.has(firstKey), false);
    assert.equal(await stored(), r.body.profilePicture);
  });

  test('a forged image (text bytes named .png) is rejected and nothing is stored', async () => {
    const before = s3Calls.length;
    const current = await stored();
    const r = await uploadPicture(Buffer.from('<?php echo "not an image"; ?>'.repeat(4)));
    assert.equal(r.status, 400);
    assert.equal(s3Calls.length, before, 'no S3 call');
    assert.equal(await stored(), current);
  });

  test('DELETE removes the object and clears the column', async () => {
    const current = await stored();
    const res = await fetch(`${api.baseUrl}/api/profile/picture`, { method: 'DELETE', headers: { cookie } });
    assert.equal(res.status, 200);
    const key = `/kente-test/profiles/${current.split('/').pop()}`;
    assert.equal(s3Calls.at(-1).method, 'DELETE');
    assert.equal(s3Calls.at(-1).url, key);
    assert.equal(await stored(), null);
  });
});
