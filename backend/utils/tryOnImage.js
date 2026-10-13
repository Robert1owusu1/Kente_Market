// FILE LOCATION: backend/utils/tryOnImage.js
// DESCRIPTION: Content-level validation + sanitization for AI Try-On images.
//
// The try-on endpoint receives the user's personal photograph (and room photos
// in decorate mode) as an inline base64 data: URI. Before this module existed
// the ONLY checks were a regex over the data: URI header and an approximate
// size cap — the decoded bytes were never sniffed, never decoded, and were
// forwarded verbatim (EXIF, GPS coordinates, camera serial numbers and all)
// to a third-party inference provider. Anything base64-encodable passed:
// a PDF, a ZIP, a renamed executable — all "valid" as far as the old check
// was concerned, because the check never looked at the bytes.
//
// The pipeline here is deliberately narrow:
//   1. strict data: URI parsing (jpeg/png/webp only, exact base64, size cap);
//   2. magic-byte sniffing via utils/imageValidator.js — the same predicate
//      the file-upload route uses, so a renamed non-image is refused on its
//      content, never on its declared MIME type or filename;
//   3. header-derived dimension + pixel-count caps BEFORE any decode, which
//      is what stops decompression bombs (an 8KB PNG that inflates to
//      60000x60000 RGB is 10+ GB of RAM);
//   4. a real decode with `sharp` (libvips) under `limitInputPixels`, which
//      rejects malformed/truncated files that a header sniffer would accept;
//   5. re-encode to a fresh baseline JPEG. This is the privacy step: sharp
//      writes no metadata unless explicitly asked to, so every EXIF block
//      (GPS, device serial, timestamps, thumbnails that can embed a second
//      image) is gone, and also the anti-polyglot step — the output bytes are
//      produced by an encoder, so any trailing payload a polyglot file
//      carried after its image data simply ceases to exist. `.rotate()` runs
//      first so the EXIF orientation is baked into pixels before the
//      metadata that describes it is dropped.
//
// All processing is in-memory buffers: no temp files are written, so there is
// no temp-file cleanup failure mode and no path on disk that a user-supplied
// filename could influence.
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sniffImage, MAX_IMAGE_DIMENSION } from './imageValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Raw upload cap. The global body parser (1MB) is the real wire limit; this
 *  is the documented in-pipeline cap so the check is local and explicit. */
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
/** Decoded pixel cap (width x height). Phone photos top out around 12MP;
 *  40MP admits every legitimate photo while refusing bombs outright. */
export const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
/** Cap on the re-encoded JPEG handed to the AI provider. */
export const MAX_SANITIZED_IMAGE_BYTES = 2 * 1024 * 1024;
/** Long-edge cap on the re-encoded image: big enough for IDM-VTON, small
 *  enough to bound provider fetch cost and the JSON round trip. */
export const MAX_OUTPUT_LONG_EDGE = 2048;
/** Catalog garment files read from local storage are capped before reading. */
export const MAX_CATALOG_IMAGE_BYTES = 10 * 1024 * 1024;

/** Client-safe, non-internal error with an HTTP status. Messages here are
 *  shown to end users, so they never contain paths, stack traces, provider
 *  text or configuration values beyond what the operator already documents. */
export class TryOnInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'TryOnInputError';
    this.statusCode = statusCode;
  }
}

const DATA_URI_RE = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

/**
 * Decode a strict data: URI to a Buffer. Content charset and padding are
 * validated exactly — `Buffer.from` would otherwise silently ignore invalid
 * characters instead of failing.
 * @param {unknown} value
 * @param {string} field field name for error messages
 * @returns {Buffer}
 */
export const decodeInlineDataUri = (value, field = 'image') => {
  if (typeof value !== 'string') {
    throw new TryOnInputError(`${field} is required`);
  }
  const match = DATA_URI_RE.exec(value);
  if (!match) {
    throw new TryOnInputError(
      `${field} must be a base64-encoded png, jpeg or webp image (data: URI)`,
    );
  }
  const payload = match[2];
  const approxBytes = Math.floor((payload.length * 3) / 4);
  if (approxBytes > MAX_INLINE_IMAGE_BYTES) {
    throw new TryOnInputError(`${field} exceeds the 5MB inline image limit`);
  }
  if (payload.length % 4 !== 0) {
    throw new TryOnInputError(`${field} is not valid base64 image data`);
  }
  const buffer = Buffer.from(payload, 'base64');
  // Guard against the (charset-checked but still) lossy length math above.
  if (buffer.length === 0 || buffer.length > MAX_INLINE_IMAGE_BYTES) {
    throw new TryOnInputError(`${field} exceeds the 5MB inline image limit`);
  }
  return buffer;
};

/**
 * Magic-byte + header-dimension validation with an explicit pixel cap.
 * Throws TryOnInputError with a user-safe message on anything suspicious;
 * returns the sniffed metadata on success.
 * @param {Buffer} buffer
 * @param {string} field
 */
export const assertSafeImageBuffer = (buffer, field = 'image') => {
  const meta = sniffImage(buffer);
  if (!meta) {
    throw new TryOnInputError(
      `${field} is not a valid jpeg, png or webp image. `
      + 'The actual file contents are checked — renaming a file is not enough.',
    );
  }
  const { width, height } = meta;
  if (width != null && height != null) {
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw new TryOnInputError(
        `${field} dimensions (${width}x${height}) exceed the ${MAX_IMAGE_DIMENSION}px limit`,
      );
    }
    if (width * height > MAX_IMAGE_PIXELS) {
      throw new TryOnInputError(
        `${field} has too many pixels (${width}x${height}); the limit is ${Math.floor(MAX_IMAGE_PIXELS / 1e6)} megapixels`,
      );
    }
  }
  return meta;
};

/**
 * Validate, decode, re-encode and metadata-strip an image buffer. The output
 * is always a baseline JPEG with orientation baked in and EXIF (including
 * GPS) removed.
 * @param {Buffer} buffer
 * @param {string} field
 * @returns {Promise<{ dataUri: string, format: string, width: number, height: number, bytes: number }>}
 */
export const sanitizeImageBuffer = async (buffer, field = 'image') => {
  const meta = assertSafeImageBuffer(buffer, field);
  let result;
  try {
    result = await sharp(buffer, {
      // Backstop behind the header pre-check: even if a crafted header lies
      // about dimensions in a way the sniffer cannot see, libvips itself
      // refuses to materialise more than this many pixels.
      limitInputPixels: MAX_IMAGE_PIXELS,
      // Strict decode: fail on libvips errors AND on truncated streams (a
      // cut-off file is exactly what a "partial upload" attack produces).
      failOn: 'truncated',
      // Belt-and-braces on metadata: never copy EXIF/ICC/XMP from input.
      unlimited: false,
    })
      // Apply the EXIF orientation to the pixels BEFORE the metadata that
      // describes it is discarded, or portrait photos come out sideways.
      .rotate()
      .resize({
        width: MAX_OUTPUT_LONG_EDGE,
        height: MAX_OUTPUT_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // Fresh encode, no `.withMetadata()` — output carries no EXIF/GPS/XMP.
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    // sharp errors can quote file paths / library internals; log server-side,
    // answer the caller with a fixed message.
    console.error(`Try-On ${field} decode failed:`, err.message);
    throw new TryOnInputError(
      `${field} could not be processed as an image. Please re-export it as a JPEG or PNG and try again.`,
    );
  }
  if (result.info.size > MAX_SANITIZED_IMAGE_BYTES) {
    throw new TryOnInputError(`${field} is too large even after compression; please use a smaller photo`);
  }
  return {
    dataUri: `data:image/jpeg;base64,${result.data.toString('base64')}`,
    format: meta.format,
    width: result.info.width,
    height: result.info.height,
    bytes: result.info.size,
  };
};

/**
 * Full pipeline for an uploaded (model/room) photo: strict data: URI ->
 * sniff -> decode -> re-encode. Returns the sanitized JPEG data: URI that is
 * the ONLY thing handed to the AI provider.
 * @param {unknown} value
 * @param {string} field
 * @returns {Promise<string>} data:image/jpeg;base64,... (EXIF-stripped)
 */
export const sanitizeUserImage = async (value, field = 'modelImage') =>
  (await sanitizeImageBuffer(decodeInlineDataUri(value, field), field)).dataUri;

// ---------------------------------------------------------------------------
// Catalog garment images: resolved from the server's own storage, never from
// a client-supplied path. Only the two directories the platform actually
// serves product images from are readable, with a containment check.
// ---------------------------------------------------------------------------
const IMAGES_ROOT = path.join(__dirname, '..', '..', 'src', 'assets', 'images'); // served at /images
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads'); // served at /uploads
const CATALOG_PATH_RE = /^\/(images|uploads\/(?:products|references))\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Read a catalog image referenced by a relative path in the product table
 * (`/images/x.jpg`, `/uploads/products/<id>.jpg`). Refuses traversal,
 * subdirectories beyond the two upload prefixes, non-image extensions and
 * oversized files. Throws TryOnInputError on anything suspect.
 * @param {string} imgPath e.g. "/images/image2.jpeg"
 * @returns {Promise<Buffer>} raw file bytes (caller runs sanitizeImageBuffer)
 */
export const readLocalCatalogImage = (imgPath) => {
  if (typeof imgPath !== 'string' || !CATALOG_PATH_RE.test(imgPath)) {
    throw new TryOnInputError('This product\'s image cannot be used for AI try-on');
  }
  const root = imgPath.startsWith('/images/') ? IMAGES_ROOT : UPLOADS_ROOT;
  // Strip the mount prefix (/images, /uploads) and resolve the remainder
  // inside the matching root — the same URL layout the static server uses.
  const relative = imgPath.replace(/^\/(images|uploads)\//, '');
  const resolved = path.resolve(root, relative);
  // Containment: resolved must sit strictly inside its root. The regex above
  // already excludes `..`, this is the defence in depth for a future regex
  // edit.
  if (!resolved.startsWith(root + path.sep)) {
    throw new TryOnInputError('This product\'s image cannot be used for AI try-on');
  }
  if (!/\.(jpe?g|png|webp)$/i.test(resolved)) {
    // SVG and anything else are excluded here regardless of what the regex
    // allows later: an SVG garment would be an XSS/RCE-capable input to any
    // downstream renderer, and this feature gains nothing from vector input.
    throw new TryOnInputError('This product\'s image format is not supported for AI try-on');
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new TryOnInputError('This product\'s image could not be found for AI try-on');
  }
  if (!stat.isFile() || stat.size > MAX_CATALOG_IMAGE_BYTES) {
    throw new TryOnInputError('This product\'s image cannot be used for AI try-on');
  }
  return fs.promises.readFile(resolved);
};

/**
 * Map a catalog category string to the garment categories IDM-VTON accepts.
 * The client no longer supplies this value — it is derived from the row the
 * server looked up.
 * @param {string} category
 * @returns {'upper_body'|'lower_body'|'dresses'|'others'}
 */
export const toGarmentCategory = (category) => {
  const c = String(category || '').toLowerCase();
  if (/\b(skirt|trouser|pant|short)s?\b/.test(c)) return 'lower_body';
  if (/\b(dress|gown)s?\b/.test(c)) return 'dresses';
  // Kente wraps, stoles, headwraps, throws and table runners all drape best
  // with the upper-body model; 'others' is the provider's catch-all.
  if (!c.trim()) return 'others';
  return 'upper_body';
};

/** Trim and bound a garment description before it is sent to the provider. */
export const sanitizeGarmentName = (title) => {
  const name = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return name || 'Authentic Kente cloth';
};
