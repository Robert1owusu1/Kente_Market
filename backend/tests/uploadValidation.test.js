// FILE LOCATION: backend/tests/uploadValidation.test.js
// DESCRIPTION: Pure unit tests (no DB) for the image magic-byte validator and
//              the local storage adapter seam.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sniffImage, validateImageFile, MAX_IMAGE_DIMENSION } from '../utils/imageValidator.js';
import { putObject, deleteObject } from '../Services/storageService.js';

const tmpFile = (name, buffer) => {
  const p = path.join(os.tmpdir(), `kente-test-${Date.now()}-${name}`);
  fs.writeFileSync(p, buffer);
  return p;
};

const buildPng = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write('IHDR', 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

const buildJpeg = (w, h) => {
  const b = Buffer.alloc(24);
  b.writeUInt8(0xff, 0); b.writeUInt8(0xd8, 1);
  b.writeUInt8(0xff, 2); b.writeUInt8(0xc0, 3); // SOF0
  b.writeUInt16BE(17, 4); // length
  b.writeUInt8(8, 6);     // precision
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  b.writeUInt8(1, 11);    // components
  return b;
};

const buildGif = (w, h) => {
  const b = Buffer.alloc(14);
  b.write('GIF89a', 0);
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};

const buildWebp = (w, h) => {
  // RIFF....WEBP + VP8X (extended) with canvas width/height.
  const b = Buffer.alloc(30);
  b.write('RIFF', 0);
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8);
  b.write('VP8X', 12);
  b.writeUInt32LE(10, 16);
  b.writeUInt32LE(0, 20);          // flags
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};

describe('imageValidator magic-byte sniffing', () => {
  test('accepts real PNG/GIF/JPEG/WebP headers with correct dimensions', () => {
    assert.deepEqual(sniffImage(buildPng(640, 480)), { format: 'png', width: 640, height: 480 });
    assert.deepEqual(sniffImage(buildGif(100, 50)), { format: 'gif', width: 100, height: 50 });
    assert.deepEqual(sniffImage(buildJpeg(800, 600)), { format: 'jpeg', width: 800, height: 600 });
    assert.deepEqual(sniffImage(buildWebp(320, 240)), { format: 'webp', width: 320, height: 240 });
  });

  test('rejects text / an SVG / a PNG signature with non-image content', () => {
    assert.equal(sniffImage(Buffer.from('plain text, definitely not an image')), null);
    assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    // PNG magic but corrupt IHDR
    const bad = buildPng(10, 10);
    bad.write('BOGUS', 12);
    assert.equal(sniffImage(bad), null);
  });

  test('rejects zero-size and oversized dimensions (decompression bomb guard)', () => {
    assert.equal(sniffImage(buildPng(0, 100)), null);
    assert.equal(sniffImage(buildGif(0, 100)), null);
    const big = buildPng(MAX_IMAGE_DIMENSION + 1, 10);
    const verdict = validateImageFile(tmpFile('bomb.png', big));
    assert.equal(verdict.valid, false);
    assert.match(verdict.reason, /decompression bomb/i);
  });

  test('validateImageFile reads the file from disk end-to-end', () => {
    const p = tmpFile('real.png', buildPng(512, 512));
    const verdict = validateImageFile(p);
    assert.deepEqual(verdict, { valid: true, format: 'png', width: 512, height: 512 });
    fs.unlinkSync(p);
  });
});

describe('storageService local backend seam', () => {
  test('putObject → deleteObject round-trip', async () => {
    const src = tmpFile('seed.bin', Buffer.from('hello-storage'));
    const url = await putObject({ key: 'products/1-product-1.png', sourcePath: src });
    assert.equal(url, '/uploads/products/1-product-1.png');
    assert.equal(fs.existsSync(path.join('uploads', 'products', '1-product-1.png')), true);
    assert.equal(await deleteObject('products/1-product-1.png'), true);
    assert.equal(fs.existsSync(path.join('uploads', 'products', '1-product-1.png')), false);
    assert.equal(await deleteObject('products/1-product-1.png'), false); // already gone
  });

  test('rejects traversal keys outside the uploads root', async () => {
    await assert.rejects(() => putObject({ key: '../../etc/passwd', sourcePath: '/nowhere' }));
    await assert.rejects(() => deleteObject('../server.js'));
  });

  test('putObject cleans up the staged temp file', async () => {
    const src = tmpFile('stage.bin', Buffer.from('x'));
    await putObject({ key: 'references/2-reference-1.txt', sourcePath: src });
    assert.equal(fs.existsSync(src), false);
    await deleteObject('references/2-reference-1.txt');
  });
});