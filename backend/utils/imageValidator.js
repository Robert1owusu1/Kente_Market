// FILE LOCATION: backend/utils/imageValidator.js
// DESCRIPTION: Magic-byte (signature) validation for uploaded images, plus
//              header-parsed dimension checks. The browser-supplied MIME type
//              is never trusted on its own — a JPEG renamed to .png must be
//              rejected, and an SVG (which can carry scripts) is not accepted.
// Pure Node, no native deps. Each format is parsed from its own header layout.
import fs from 'fs';

export const MAX_IMAGE_DIMENSION = 8192;

// Bytes: 0:9 must be \x89PNG\r\n\x1a\n ;  IHDR at 8..; width@16 height@20 (BE).
const sniffPng = (b) => {
  if (b.length < 33 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47 ||
      b[4] !== 0x0d || b[5] !== 0x0a || b[6] !== 0x1a || b[7] !== 0x0a) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { format: 'png', width, height };
};

// JPEG: starts FFD8, go marker-by-marker and find a SOF (C0-CF, excluding
// C4=DHT, C8=JPG, CC=DAC) which carries height@? and width@?.
const sniffJpeg = (b) => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < b.length) {
    if (b[offset] !== 0xff) break;
    const marker = b[offset + 1];
    // Standalone markers have no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const len = b.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // SOF payload: precision(1) height(2) width(2) ...
      const height = b.readUInt16BE(offset + 5);
      const width = b.readUInt16BE(offset + 7);
      if (height === 0 || width === 0) return null;
      return { format: 'jpeg', width, height };
    }
    offset += 2 + len;
  }
  // Valid JPEG magic but no SOF within the probe window — accept without dims.
  return { format: 'jpeg', width: null, height: null };
};

// GIF: "GIF87a" / "GIF89a"; logical screen width@6 height@8 (LE16).
const sniffGif = (b) => {
  if (b.length < 10) return null;
  const sig = b.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  const width = b.readUInt16LE(6);
  const height = b.readUInt16LE(8);
  if (width === 0 || height === 0) return null;
  return { format: 'gif', width, height };
};

// WebP: RIFF....WEBP ; then a chunk at 12: 'VP8 ' (lossy), 'VP8L' (lossless),
// 'VP8X' (extended with canvas size).
const sniffWebp = (b) => {
  if (b.length < 30) return null;
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: 3-byte frame tag (0x9D 0x01 0x2A) at 20..22; 14-bit width/height LE.
    if (b[20] !== 0x9d || b[21] !== 0x01 || b[22] !== 0x2a) return null;
    const width = (b.readUInt16LE(23) & 0x3fff);
    const height = (b.readUInt16LE(25) & 0x3fff);
    return { format: 'webp', width, height };
  }
  if (chunk === 'VP8L') {
    if (b.length < 25) return null;
    if (b[20] !== 0x2f) return null; // lossless signature
    const packed = b.readUInt32LE(21);
    const width = (packed & 0x3fff) + 1;
    const height = ((packed >>> 14) & 0x3fff) + 1;
    return { format: 'webp', width, height };
  }
  if (chunk === 'VP8X') {
    if (b.length < 30) return null;
    // Flags@20; canvas width-1 (24-bit LE) @24, height-1 @27.
    const width = b.readUIntLE(24, 3) + 1;
    const height = b.readUIntLE(27, 3) + 1;
    return { format: 'webp', width, height };
  }
  return null;
};

const SNIFFERS = [sniffJpeg, sniffPng, sniffGif, sniffWebp];

/**
 * Sniff a buffer's magic bytes and determine format + (where decodable)
 * dimensions. Returns null when the buffer is not one of the allowed images.
 * @param {Buffer} buffer
 * @returns {{ format: string, width: number|null, height: number|null } | null}
 */
export const sniffImage = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  for (const sniff of SNIFFERS) {
    const result = sniff(buffer);
    if (result) return result;
  }
  return null;
};

/**
 * Validate an image file that was just written to disk (magic bytes + header
 * dimensions, guarding against decompression bombs).
 * @param {string} filePath absolute path to the temp file
 * @param {number} [probeBytes] how much of the header to read (default 64 KiB)
 * @returns {{ valid: boolean, format?: string, width?: number|null, height?: number|null, reason?: string }}
 */
export const validateImageFile = (filePath, probeBytes = 64 * 1024) => {
  const fd = fs.openSync(filePath, 'r');
  let buffer;
  try {
    const { size } = fs.fstatSync(fd);
    buffer = Buffer.alloc(Math.min(probeBytes, size));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const meta = sniffImage(buffer);
  if (!meta) {
    return { valid: false, reason: 'File content does not match a supported image (jpeg, png, gif, webp). Renaming a file to .png is not enough — the actual bytes are checked.' };
  }
  if (meta.width != null && (meta.width > MAX_IMAGE_DIMENSION || meta.height == null || meta.height > MAX_IMAGE_DIMENSION)) {
    return { valid: false, reason: `Image dimensions (${meta.width}×${meta.height}) exceed the ${MAX_IMAGE_DIMENSION}px limit — likely a decompression bomb.` };
  }
  return { valid: true, ...meta };
};