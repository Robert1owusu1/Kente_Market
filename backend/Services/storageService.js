// FILE LOCATION: backend/Services/storageService.js
// DESCRIPTION: Object-storage adapter for user uploads.
//   - 'local' (default): filesystem under backend/uploads (magic-byte
//     validation lives in routes/uploadRoute.js). Fully working out of the box.
//   - 's3': S3-compatible object storage (AWS S3, Cloudflare R2, MinIO,
//     Backblaze B2, Wasabi, DigitalOcean Spaces) via STORAGE_BACKEND=s3.
//     SigV4 is implemented with node:crypto + fetch — no SDK dependency.
// Select with STORAGE_BACKEND=s3; see .deploy/UPLOADS_OBJECT_STORAGE.md.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.join(__dirname, '..', 'uploads');
const BACKEND = process.env.STORAGE_BACKEND || 'local';

const assertKeySafe = (key) => {
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

// ---------------------------------------------------------------------------
// S3-compatible backend (SigV4 signer, built-in fetch, no SDK).
// ---------------------------------------------------------------------------
const s3conf = () => {
  const endpoint = (process.env.S3_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = process.env.S3_BUCKET || '';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || '';
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('STORAGE_BACKEND=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION || 'auto',
    pathStyle: process.env.S3_PATH_STYLE !== 'false',
    publicBase: (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, '') || null,
  };
};

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sha256Hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha256HmacHex = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');

const signV4 = ({ method, url, region, service, accessKeyId, secretAccessKey, payloadHash }) => {
  const parsed = new URL(url);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);

  const headers = {
    host: parsed.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = sortedHeaderNames.join(';');

  const query = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    method,
    parsed.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = sha256Hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = sha256Hmac(kDate, region);
  const kService = sha256Hmac(kRegion, service);
  const kSigning = sha256Hmac(kService, 'aws4_request');
  const signature = sha256HmacHex(kSigning, stringToSign);

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, amzDate };
};

const mimeFromBuffer = (buf) => {
  if (!buf || buf.length < 12) return 'application/octet-stream';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 6).toString('ascii') === 'GIF89a' || buf.slice(0, 6).toString('ascii') === 'GIF87a') return 'image/gif';
  return 'application/octet-stream';
};

const s3ObjectUrl = (config, key) => {
  assertKeySafe(key);
  if (config.pathStyle) return `${config.endpoint}/${config.bucket}/${key}`;
  const className = new URL(config.endpoint);
  return `${className.protocol}//${config.bucket}.${className.host}${key.startsWith('/') ? key : `/${key}`}`;
};

const s3Request = async (config, method, key, { body } = {}) => {
  const url = s3ObjectUrl(config, key);
  const payloadHash = body ? sha256Hex(body) : sha256Hex(Buffer.alloc(0));
  const { authorization, amzDate } = signV4({
    method,
    url,
    region: config.region,
    service: 's3',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    payloadHash,
  });

  const headers = {
    Authorization: authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  if (body) headers['Content-Type'] = mimeFromBuffer(body);

  const res = await fetch(url, { method, headers, body: method === 'HEAD' || method === 'DELETE' ? undefined : body });
  return res;
};

const s3Backend = {
  name: 's3',
  config: null,

  async putObject({ key, sourcePath }) {
    const config = (s3Backend.config ||= s3conf());
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Uploaded file is missing from temp storage');
    const safeKey = assertKeySafe(key);
    const body = await fs.promises.readFile(sourcePath);
    const res = await s3Request(config, 'PUT', safeKey, { body });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`S3 PUT failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    await fs.promises.unlink(sourcePath).catch(() => {});
    const publicUrl = config.publicBase
      ? `${config.publicBase}/${safeKey}`
      : s3ObjectUrl(config, safeKey);
    return publicUrl;
  },

  async deleteObject(key) {
    const config = (s3Backend.config ||= s3conf());
    const safeKey = assertKeySafe(key);
    const res = await s3Request(config, 'DELETE', safeKey);
    if (res.status === 404) return false;
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`S3 DELETE failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    return true;
  },

  async exists(key) {
    const config = (s3Backend.config ||= s3conf());
    const safeKey = assertKeySafe(key);
    const res = await s3Request(config, 'HEAD', safeKey);
    return res.ok;
  },
};

const selectBackend = () => {
  if (BACKEND === 'local') return localBackend;
  if (BACKEND === 's3') return s3Backend;
  console.error(`❌ STORAGE_BACKEND=${BACKEND} is not implemented. Use 'local' or 's3'. See .deploy/UPLOADS_OBJECT_STORAGE.md.`);
  process.exit(1);
};

const backend = selectBackend();

export const storageBackend = backend;

/** @returns {Promise<string>} public URL for a storage key */
export const getPublicUrl = (key) =>
  backend === s3Backend
    ? (s3Backend.config ||= s3conf()).publicBase
      ? `${s3Backend.config.publicBase}/${assertKeySafe(key)}`
      : s3ObjectUrl(s3Backend.config, key)
    : `/uploads/${assertKeySafe(key)}`;

/** Handle a multer temp file: validation is done by the caller before this. */
export const putObject = (input) => backend.putObject(input);
export const deleteObject = (key) => backend.deleteObject(key);