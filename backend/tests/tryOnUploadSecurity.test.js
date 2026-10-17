// FILE LOCATION: backend/tests/tryOnUploadSecurity.test.js
// DESCRIPTION: Byte-level security suite for the AI Try-On upload pipeline.
//
// Covers the pipeline that tryOnSsrf.test.js's URL half does not: what
// happens to the BYTES of an uploaded photo. Every case here is synthetic —
// images are generated with sharp or hand-built headers, never real photos.
// Pure — no database, runs in the no-DB CI job.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AxiosError } from 'axios';

import {
  decodeInlineDataUri,
  assertSafeImageBuffer,
  sanitizeImageBuffer,
  readLocalCatalogImage,
  toGarmentCategory,
  sanitizeGarmentName,
  TryOnInputError,
  MAX_INLINE_IMAGE_BYTES,
  MAX_OUTPUT_LONG_EDGE,
} from '../utils/tryOnImage.js';
import { getTryOnConfig } from '../Services/tryOn/config.js';
import resultStore, { resultDir } from '../Services/tryOn/resultStore.js';
import { errorHandeler } from '../middleware/errorMiddleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Synthetic image builders
// ---------------------------------------------------------------------------
const solidPng = async (width = 64, height = 64) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();

const solidJpeg = (width = 64, height = 64) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 30, b: 200 } } })
    .jpeg()
    .toBuffer();

const asDataUri = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

/** PNG whose IHDR header claims impossible dimensions (a decompression-bomb
 *  shape: the header is what a decoder trusts before it allocates). */
const pngHeaderClaiming = (width, height) => {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); // IHDR length
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};

const rejects = async (fn, pattern) => {
  try {
    await fn();
  } catch (err) {
    if (pattern) assert.match(err.message, pattern, `wrong error: ${err.message}`);
    assert.ok(
      err instanceof TryOnInputError,
      `expected a TryOnInputError (400-safe), got ${err.name}: ${err.message}`,
    );
    return err;
  }
  throw new assert.AssertionError({ message: 'expected a rejection, but the call succeeded' });
};

// ---------------------------------------------------------------------------
// 1. data: URI parsing — only exact, bounded, base64 image data passes
// ---------------------------------------------------------------------------
describe('try-on inline image: strict data: URI decoding', () => {
  test('a real png and a real jpeg round-trip', async () => {
    const png = decodeInlineDataUri(asDataUri(await solidPng()));
    assert.equal(png.subarray(0, 4).toString('hex'), '89504e47');
    const jpeg = decodeInlineDataUri(asDataUri(await solidJpeg(), 'image/jpeg'));
    assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8');
  });

  test('non-image data URIs are refused', async () => {
    await rejects(() => decodeInlineDataUri('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), /png, jpeg or webp/);
    await rejects(() => decodeInlineDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), /png, jpeg or webp/);
    await rejects(() => decodeInlineDataUri('data:image/gif;base64,R0lGODlhAQABAAAAACw='), /png, jpeg or webp/);
    await rejects(() => decodeInlineDataUri('data:image/png,notbase64atall'), /png, jpeg or webp/);
    await rejects(() => decodeInlineDataUri('https://cdn.example.com/x.png'), /data: URI/);
  });

  test('malformed base64 inside an allowed header is refused', async () => {
    await rejects(() => decodeInlineDataUri('data:image/png;base64,not base64!'), /png, jpeg or webp|base64/);
    // Charset passes the regex but padding is wrong (length % 4 !== 0).
    await rejects(() => decodeInlineDataUri('data:image/png;base64,AAAAA'), /valid base64/);
    await rejects(() => decodeInlineDataUri('data:image/png;base64,'), /png, jpeg or webp|base64/);
  });

  test('oversized payloads are refused before any decode', async () => {
    const oversize = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3) + 8)}`;
    await rejects(() => decodeInlineDataUri(oversize), /5MB inline image limit/);
  });

  test('non-strings are refused', async () => {
    await rejects(() => decodeInlineDataUri(null), /required/);
    await rejects(() => decodeInlineDataUri(undefined), /required/);
    await rejects(() => decodeInlineDataUri(42), /required/);
  });
});

// ---------------------------------------------------------------------------
// 2. Content validation — the declared type is never trusted
// ---------------------------------------------------------------------------
describe('try-on inline image: magic bytes and dimension caps', () => {
  test('a non-image renamed to .png (PDF magic) is refused on content', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'.repeat(4), 'binary');
    await rejects(() => sanitizeImageBuffer(pdf, 'modelImage'), /not a valid jpeg, png or webp/);
  });

  test('spoofed MIME type: jpeg bytes declared as png are handled by content', async () => {
    // The declared subtype says png, the bytes are jpeg. Content wins: the
    // result must be a re-encoded JPEG, proving the sniffer read the bytes.
    const jpeg = await solidJpeg();
    const out = await sanitizeImageBuffer(jpeg, 'modelImage');
    assert.ok(out.dataUri.startsWith('data:image/jpeg;base64,'), 'output must be jpeg');
  });

  test('a truncated image is refused with a safe message', async () => {
    const jpeg = await solidJpeg(256, 256);
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length * 0.5));
    await rejects(() => sanitizeImageBuffer(truncated, 'modelImage'), /could not be processed/);
  });

  test('a decompression-bomb header (60000x60000) is refused before decode', async () => {
    await rejects(() => sanitizeImageBuffer(pngHeaderClaiming(60000, 60000), 'modelImage'), /60000x60000|too many pixels/);
    await rejects(() => assertSafeImageBuffer(pngHeaderClaiming(9000, 100), 'modelImage'), /8192px limit/);
  });

  test('a header claiming 40MP+ inside the per-side limit is refused', async () => {
    // 7000x7000 = 49MP: each side is under 8192 but the product is over the
    // pixel cap — the check that actually bounds decode memory.
    await rejects(() => assertSafeImageBuffer(pngHeaderClaiming(7000, 7000), 'modelImage'), /too many pixels/);
  });

  test('SVG is not accepted anywhere in the pipeline', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await rejects(() => sanitizeImageBuffer(svg, 'modelImage'), /not a valid jpeg, png or webp/);
  });
});

// ---------------------------------------------------------------------------
// 3. Re-encoding: metadata stripping, orientation, downscaling
// ---------------------------------------------------------------------------
describe('try-on inline image: sanitizing output', () => {
  test('EXIF (incl. GPS-bearing segments) is stripped from the output', async () => {
    const withExif = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 120, b: 60 } },
    })
      .jpeg()
      .withExif({
        IFD0: { Copyright: 'KenteTest', Make: 'TestCam' },
        IFD2: { UserComment: 'GPSTESTDATA' },
        IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
      })
      .toBuffer();
  assert.match(withExif.toString('latin1'), /GPS|EXIF/i, 'builder must produce an EXIF-bearing input');

    const out = await sanitizeImageBuffer(withExif, 'modelImage');
    const raw = Buffer.from(out.dataUri.split(',')[1], 'base64');
    assert.equal(raw[0], 0xff, 'output must be a real JPEG');
    assert.equal(raw[1], 0xd8);
    // No APP1 (0xFFE1 = EXIF/ICC marker) segment may survive the re-encode.
    let sawApp1 = false;
    for (let i = 0; i < raw.length - 1; i++) {
      if (raw[i] === 0xff && raw[i + 1] === 0xe1) { sawApp1 = true; break; }
    }
    assert.ok(!sawApp1, 'EXIF APP1 segment survived the re-encode');
    assert.ok(!raw.toString('latin1').includes('GPS'), 'GPS data survived the re-encode');
  });

  test('EXIF orientation is applied to pixels before the metadata is dropped', async () => {
    // 2x3 image with orientation 6 (rotate 90° CW): after .rotate() the
    // pixels must be 3x2, otherwise portrait photos come out sideways the
    // moment their orientation tag is stripped.
    const oriented = await sharp({
      create: { width: 2, height: 3, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await sanitizeImageBuffer(oriented, 'modelImage');
    assert.equal(out.width, 3, 'orientation was not applied to the pixels');
    assert.equal(out.height, 2);
  });

  test('oversized images are downscaled to the output long-edge cap', async () => {
    const big = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .png()
      .toBuffer();
    const out = await sanitizeImageBuffer(big, 'modelImage');
    assert.ok(out.width <= MAX_OUTPUT_LONG_EDGE && out.height <= MAX_OUTPUT_LONG_EDGE,
      `output ${out.width}x${out.height} exceeds the long-edge cap`);
    assert.equal(out.width, MAX_OUTPUT_LONG_EDGE, 'inside-fit resize should hit the cap exactly');
  });

  test('small valid images are accepted unchanged in size class (camera + room uploads)', async () => {
    const png = await solidPng(640, 480);
    const out = await sanitizeImageBuffer(png, 'modelImage');
    assert.ok(out.dataUri.startsWith('data:image/jpeg;base64,'));
    assert.equal(out.width, 640);
    assert.equal(out.height, 480);
    assert.ok(out.bytes > 0);
  });

  test('webp input is accepted and re-encoded to jpeg', async () => {
    const webp = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .webp()
      .toBuffer();
    const out = await sanitizeImageBuffer(webp, 'modelImage');
    assert.ok(out.dataUri.startsWith('data:image/jpeg;base64,'));
    assert.equal(out.format, 'webp', 'sniffed source format should be reported');
  });
});

// ---------------------------------------------------------------------------
// 4. Catalog garment files: local reads are contained, never traversal
// ---------------------------------------------------------------------------
describe('try-on catalog garment: local file resolution', () => {
  test('a real catalog image under /images is read and sanitized', async () => {
    const buf = await readLocalCatalogImage('/images/image2.jpeg');
    assert.ok(buf.length > 0);
    const out = await sanitizeImageBuffer(buf, 'productImage');
    assert.ok(out.dataUri.startsWith('data:image/jpeg;base64,'));
  });

  test('path traversal is refused', async () => {
    for (const p of [
      '/uploads/../.env',
      '/uploads/products/../../server.js',
      '/images/../../backend/.env',
      '/uploads/products/..%2F..%2F.env',
      '/images/./image2.jpeg',
    ]) {
      await rejects(() => readLocalCatalogImage(p), /cannot be used|not supported/);
    }
  });

  test('non-image and unknown extensions are refused even inside allowed dirs', async () => {
    await rejects(() => readLocalCatalogImage('/uploads/products/payload.svg'), /not supported|cannot be used/);
    await rejects(() => readLocalCatalogImage('/uploads/products/payload.exe'), /not supported|cannot be used/);
    await rejects(() => readLocalCatalogImage('/uploads/references/x.txt'), /not supported|cannot be used/);
  });

  test('arbitrary directories under /uploads are refused (only products/references)', async () => {
    await rejects(() => readLocalCatalogImage('/uploads/avatars/x.jpg'), /cannot be used/);
    await rejects(() => readLocalCatalogImage('/other/x.jpg'), /cannot be used/);
  });

  test('a missing file answers with a safe, generic message', async () => {
    const err = await rejects(
      () => readLocalCatalogImage('/uploads/products/does-not-exist-1234.jpg'),
      /could not be found/,
    );
    assert.ok(!err.message.includes(__dirname), 'error must not leak server paths');
    assert.ok(!err.message.includes('/uploads'), 'error must not echo the resolved path');
  });
});

// ---------------------------------------------------------------------------
// 5. Server-derived text fields
// ---------------------------------------------------------------------------
describe('try-on catalog garment: server-derived text', () => {
  test('categories map to the provider enum, client strings cannot inject', () => {
    assert.equal(toGarmentCategory('Kente Skirts'), 'lower_body');
    assert.equal(toGarmentCategory('Evening Gown'), 'dresses');
    assert.equal(toGarmentCategory('Kente Wraps'), 'upper_body');
    assert.equal(toGarmentCategory('Kente Headwraps'), 'upper_body');
    assert.equal(toGarmentCategory(''), 'upper_body');
    assert.equal(toGarmentCategory('Double Weaving'), 'upper_body', 'live catalog categories are weaving techniques');
    // Anything else — including hostile text — collapses into one of four
    // literal values; nothing user-shaped is forwarded.
    assert.equal(toGarmentCategory('"; drop table products; --'), 'upper_body');
    assert.equal(toGarmentCategory('<script>alert(1)</script>'), 'upper_body');
  });

  test('garment names are whitespace-collapsed and length-bounded', () => {
    assert.equal(sanitizeGarmentName('  Adweneasa   Royal  '), 'Adweneasa Royal');
    assert.equal(sanitizeGarmentName(undefined), 'Authentic Kente cloth');
    assert.ok(sanitizeGarmentName('x'.repeat(1000)).length <= 120);
  });
});

// ---------------------------------------------------------------------------
// 6. Concurrency accounting (cost bound)
// ---------------------------------------------------------------------------
describe('try-on cost-control configuration', () => {
  // The caps are enforced against ai_tryon_jobs (behaviour: tryOnGenerateFlow
  // and tryOnJobRepository suites); here: a typo cannot loosen them unboundedly.
  const withVars = (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return fn(); } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  test('defaults are sane', () => {
    withVars({ AI_TRYON_MAX_ACTIVE_PER_USER: '', AI_TRYON_MAX_ACTIVE_GLOBAL: '', AI_TRYON_JOB_TIMEOUT_MINUTES: '', AI_TRYON_RESULT_TTL_HOURS: '' }, () => {
      const c = getTryOnConfig();
      assert.equal(c.maxActivePerUser, 2);
      assert.equal(c.maxActiveGlobal, 8);
      assert.equal(c.jobTimeoutMinutes, 10);
      assert.equal(c.resultTtlHours, 24);
    });
  });

  test('out-of-range or junk values fall back to the defaults', () => {
    withVars({ AI_TRYON_MAX_ACTIVE_PER_USER: '5000', AI_TRYON_MAX_ACTIVE_GLOBAL: '-1', AI_TRYON_JOB_TIMEOUT_MINUTES: '600', AI_TRYON_RESULT_TTL_HOURS: 'forever' }, () => {
      const c = getTryOnConfig();
      assert.equal(c.maxActivePerUser, 2);
      assert.equal(c.maxActiveGlobal, 8);
      assert.equal(c.jobTimeoutMinutes, 10);
      assert.equal(c.resultTtlHours, 24);
    });
  });
});

// ---------------------------------------------------------------------------
// 6b. Private result storage (real filesystem, temp directory)
// ---------------------------------------------------------------------------
describe('try-on private result store', () => {
  const ID = '00000000-0000-4000-8000-000000000001';
  let tmpRoot;
  let savedDir;

  test('results are written outside /uploads, owner-only file mode, atomically', async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tryon-store-'));
    savedDir = process.env.AI_TRYON_RESULT_DIR;
    process.env.AI_TRYON_RESULT_DIR = tmpRoot;
    try {
      const key = await resultStore.put(ID, Buffer.from('jpeg-bytes'));
      assert.equal(key, `${ID}.jpg`);
      const full = path.join(resultDir(), key);
      assert.equal((fs.statSync(full).mode & 0o777), 0o600);
      assert.deepEqual(fs.readdirSync(tmpRoot), [key], 'no temp file may be left behind');
      assert.equal((await resultStore.read(ID)).toString(), 'jpeg-bytes');
      await resultStore.remove(ID);
      assert.equal(await resultStore.read(ID), null);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      if (savedDir === undefined) delete process.env.AI_TRYON_RESULT_DIR; else process.env.AI_TRYON_RESULT_DIR = savedDir;
    }
  });

  test('the default directory is not under the publicly served uploads folder', () => {
    const saved = process.env.AI_TRYON_RESULT_DIR;
    delete process.env.AI_TRYON_RESULT_DIR;
    try {
      assert.ok(!resultDir().split(path.sep).includes('uploads'), resultDir());
    } finally {
      if (saved !== undefined) process.env.AI_TRYON_RESULT_DIR = saved;
    }
  });

  test('job ids that are not UUIDs can never become a path', async () => {
    for (const bad of ['../../etc/passwd', 'a/b', '', '00000000-0000-4000-8000-00000000000g']) {
      await assert.rejects(() => resultStore.put(bad, Buffer.from('x')), /invalid try-on job id/);
      await assert.rejects(() => resultStore.read(bad), /invalid try-on job id/);
    }
  });

  test('sweep removes stale temp files and orphan results, keeps live and fresh ones', async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tryon-sweep-'));
    savedDir = process.env.AI_TRYON_RESULT_DIR;
    process.env.AI_TRYON_RESULT_DIR = tmpRoot;
    const LIVE = '00000000-0000-4000-8000-0000000000a1';
    const ORPHAN = '00000000-0000-4000-8000-0000000000a2';
    const FRESH_ORPHAN = '00000000-0000-4000-8000-0000000000a3';
    try {
      const old = new Date(Date.now() - 60 * 60 * 1000);
      for (const name of [`${LIVE}.jpg`, `${ORPHAN}.jpg`, `${ORPHAN}.jpg.1.2.tmp`]) {
        fs.writeFileSync(path.join(tmpRoot, name), 'x');
        fs.utimesSync(path.join(tmpRoot, name), old, old);
      }
      fs.writeFileSync(path.join(tmpRoot, `${FRESH_ORPHAN}.jpg`), 'x'); // just written, row not committed yet
      const removed = await resultStore.sweep(async (ids) => new Set(ids.filter((i) => i === LIVE)));
      assert.equal(removed, 2);
      assert.deepEqual(fs.readdirSync(tmpRoot).sort(), [`${LIVE}.jpg`, `${FRESH_ORPHAN}.jpg`].sort());
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      if (savedDir === undefined) delete process.env.AI_TRYON_RESULT_DIR; else process.env.AI_TRYON_RESULT_DIR = savedDir;
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Oversized JSON: the wire-level limit answers 413, not 500
// ---------------------------------------------------------------------------
describe('oversized request bodies', () => {
  test('body-parser entity-too-large errors surface as 413 with a safe message', () => {
    // Shape produced by http-errors (what body-parser throws): expose is set.
    const err = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true, type: 'entity.too.large' });
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        assert.equal(this.statusCode, 413, 'oversized body must be a 413');
        assert.equal(payload.message, 'request entity too large');
        return this;
      },
    };
    errorHandeler(err, { method: 'POST', originalUrl: '/api/tryon/jobs' }, res, () => {});
  });

  // An unhandled provider error must stay a generic 500: AxiosError carries
  // the UPSTREAM status (a Paystack 401 for a bad key), which the SPA would
  // read as "your session expired" and log the customer out.
  for (const upstream of [401, 403, 404, 400]) {
    test(`an AxiosError with upstream ${upstream} answers 500, not ${upstream}`, () => {
      const err = new AxiosError(`Request failed with status code ${upstream}`, 'ERR_BAD_REQUEST',
        undefined, undefined, { status: upstream, statusText: '', headers: {}, config: {}, data: {} });
      assert.equal(err.status, upstream, 'fixture: axios exposes the upstream status');
      let sent;
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { sent = payload; return this; },
      };
      errorHandeler(err, { method: 'POST', originalUrl: '/api/payments/initialize' }, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(sent.message, 'An error occurred');
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Route wiring: the paid route carries its dedicated limiter
// ---------------------------------------------------------------------------
describe('try-on route wiring', () => {
  const routes = () => readFileSync(fileURLToPath(new URL('../routes/tryOnRoutes.js', import.meta.url)), 'utf8');
  const lineFor = (needle) => routes().split('\n').find((l) => l.includes(needle)) || '';

  test('POST /jobs is mounted behind protect + the try-on limiter', () => {
    const line = lineFor('router.post("/jobs"');
    assert.match(line, /protect/, 'job creation is unauthenticated');
    assert.match(line, /tryOnGenerateLimiter/, 'job creation has no dedicated rate limit');
    assert.match(line, /apiLimiter/, 'job creation bypasses the general API limiter');
    assert.ok(line.indexOf('protect') < line.indexOf('tryOnGenerateLimiter'),
      'the limiter runs before authentication, so it cannot key on the user');
  });

  test('job status and result routes require authentication', () => {
    assert.match(lineFor('router.get("/jobs/:id"'), /protect/);
    assert.match(lineFor('router.get("/jobs/:id/result"'), /protect/);
  });

  test('the old unbound generate/status routes are gone', () => {
    assert.ok(!routes().includes('"/generate"'));
    assert.ok(!routes().includes('"/status/:id"'));
  });

  test('the webhook is mounted with a raw body parser before the JSON parser', () => {
    const server = readFileSync(fileURLToPath(new URL('../server.js', import.meta.url)), 'utf8');
    const hook = server.indexOf("'/api/tryon/webhooks/:provider'");
    const json = server.indexOf('app.use(express.json(');
    assert.ok(hook > -1 && json > -1);
    assert.ok(hook < json, 'the JSON parser would consume (and size-limit) the signed body first');
    assert.match(server.slice(hook, hook + 200), /express\.raw\(/);
  });
});
