// FILE LOCATION: backend/tests/storageS3.test.js
// DESCRIPTION: The S3/R2 storage backend (Services/storageService.js) signs
//   requests with a hand-written SigV4 implementation. A subtle signing bug
//   would make every production upload fail with 403, and nothing else in the
//   suite exercises the signature itself. The expected values below were
//   produced by AWS's own signer (@smithy/signature-v4 5.x, uriEscapePath:false
//   as S3 requires) for the same inputs; they are NOT derived from our code.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENV = {
  STORAGE_BACKEND: 's3',
  S3_ENDPOINT: 'https://acct123.r2.cloudflarestorage.com',
  S3_BUCKET: 'kente-prod',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  S3_PATH_STYLE: 'true',
  S3_PUBLIC_BASE_URL: 'https://media.example.test/',
};
const saved = {};
let storage;
const realFetch = globalThis.fetch;

before(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  // storageService picks its backend at import time.
  storage = await import('../Services/storageService.js');
});
after(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const NOW = new Date('2026-10-17T12:34:56Z');
const base = {
  region: 'auto',
  service: 's3',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  now: NOW,
};

describe('S3/R2 SigV4 signature matches AWS reference signer', () => {
  test('PUT object with body', () => {
    const { authorization, amzDate } = storage.signV4({
      ...base,
      method: 'PUT',
      url: 'https://acct123.r2.cloudflarestorage.com/kente-prod/products/12-product-0b9f7a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg',
      payloadHash: sha(Buffer.from('kente-r2-signature-vector')),
    });
    assert.equal(amzDate, '20261017T123456Z');
    assert.equal(
      authorization,
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261017/auto/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=eccdb22341ac3d8c400c7c10562ea745f9fdb8e05717f81ec447615f620deb3d'
    );
  });

  test('DELETE object (empty payload)', () => {
    const { authorization } = storage.signV4({
      ...base,
      method: 'DELETE',
      url: 'https://acct123.r2.cloudflarestorage.com/kente-prod/profiles/7-abc.webp',
      payloadHash: sha(Buffer.alloc(0)),
    });
    assert.match(authorization, /Signature=60020378b18473aa775f364dcca322643e1c45bafd20de64ce38d15914d6a85b$/);
  });
});

describe('S3/R2 putObject request', () => {
  test('uploads to the bucket path and returns the public URL', async () => {
    const tmp = path.join(os.tmpdir(), `s3test-${crypto.randomUUID()}.jpg`);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
    fs.writeFileSync(tmp, jpeg);
    let seen;
    globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response(null, { status: 200 }); };

    const key = 'products/12-product-0b9f7a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg';
    const url = await storage.putObject({ key, sourcePath: tmp });

    assert.equal(url, `https://media.example.test/${key}`);
    assert.equal(seen.url, `https://acct123.r2.cloudflarestorage.com/kente-prod/${key}`);
    assert.equal(seen.init.method, 'PUT');
    assert.equal(seen.init.headers['Content-Type'], 'image/jpeg');
    assert.equal(seen.init.headers['Cache-Control'], 'public, max-age=3600');
    assert.equal(seen.init.headers['x-amz-content-sha256'], sha(jpeg));
    assert.ok(seen.init.signal instanceof AbortSignal, 'request has a deadline');
    assert.equal(fs.existsSync(tmp), false, 'temp file removed after upload');
  });

  test('a failed PUT is an error, never a URL', async () => {
    const tmp = path.join(os.tmpdir(), `s3test-${crypto.randomUUID()}.jpg`);
    fs.writeFileSync(tmp, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]));
    globalThis.fetch = async () => new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 });
    await assert.rejects(
      storage.putObject({ key: 'products/12-product-x.jpg', sourcePath: tmp }),
      /S3 PUT failed \(403\)/
    );
    fs.rmSync(tmp, { force: true });
  });

  test('keys outside the allowed prefixes are refused before any request', async () => {
    globalThis.fetch = async () => assert.fail('no request expected');
    await assert.rejects(storage.deleteObject('tryon-results/x.jpg'), /Unsupported storage key/);
    await assert.rejects(storage.deleteObject('products/../secrets'), /Unsafe storage key|Unsupported storage key/);
  });
});
