// FILE LOCATION: backend/Services/storageService.js
// DESCRIPTION: Object-storage adapter for user uploads. Today every write goes
//              to the local filesystem (the default and fully-working backend,
//              hardened with magic-byte validation in routes/uploadRoute.js).
//
//              The seam exists so an S3-compatible backend (Cloudflare R2,
//              AWS S3, Google GCS, Backblaze B2) can be dropped in without
//              touching any controller: implement the three functions below for
//              the remote backend and select it with STORAGE_BACKEND=s3.
//              See .deploy/UPLOADS_OBJECT_STORAGE.md for the runbook.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// All uploads live under backend/uploads so the existing /uploads/* static
// mount keeps serving them unchanged.
const STORAGE_ROOT = path.join(__dirname, '..', 'uploads');
const BACKEND = process.env.STORAGE_BACKEND || 'local';

const assertKeySafe = (key) => {
  // Allow "products/<name>" / "references/<name>" only; reject traversal.
  const candidate = path.normalize(key);
  if (candidate.startsWith('..') || path.isAbsolute(candidate) || candidate.includes('../')) {
    throw new Error('Unsafe storage key');
  }
  if (!/^(products|references)\/[^/]+$/.test(key)) {
    throw new Error(`Unsupported storage key: ${key}`);
  }
  return candidate;
};

const localBackend = {
  name: 'local',

  /**
   * Move a just-validated temp file into storage.
   * @param {{ key: string, sourcePath: string }} input
   */
  async putObject({ key, sourcePath }) {
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Uploaded file is missing from temp storage');
    const safeKey = assertKeySafe(key);
    const dest = path.join(STORAGE_ROOT, safeKey);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(sourcePath, dest);
    await fs.promises.unlink(sourcePath).catch(() => {});
    return `/uploads/${key}`;
  },

  async deleteObject(key) {
    const safeKey = assertKeySafe(key);
    const filePath = path.join(STORAGE_ROOT, safeKey);
    if (!fs.existsSync(filePath)) return false;
    await fs.promises.unlink(filePath);
    return true;
  },

  async exists(key) {
    return fs.existsSync(path.join(STORAGE_ROOT, assertKeySafe(key)));
  },
};

// The S3-compatible backend is intentionally not wired in this codebase yet —
// the runbook (.deploy/UPLOADS_OBJECT_STORAGE.md) describes the required
// interface. Selecting it before it exists must fail loudly, never silently
// fall back to local (that would give operators a false sense of durability).
if (BACKEND !== 'local') {
  console.error(`❌ STORAGE_BACKEND=${BACKEND} is not implemented. Only the 'local' backend exists. See .deploy/UPLOADS_OBJECT_STORAGE.md.`);
  process.exit(1);
}

export const storageBackend = localBackend;

/** @returns {Promise<string>} public URL path for a storage key */
export const getPublicUrl = (key) => `/uploads/${assertKeySafe(key)}`;

/** Handle a multer temp file: validation is done by the caller before this. */
export const putObject = (input) => localBackend.putObject(input);
export const deleteObject = (key) => localBackend.deleteObject(key);