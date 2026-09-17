# Uploads → Object Storage Runbook

All image uploads (product images, reference sketches, profile pictures) go
through `backend/Services/storageService.js`. Today the **only** backend is
`local` (files under `backend/uploads/*`, served from `/uploads/*`).

This document is the runbook for moving to an S3-compatible object store so
files survive redeploys and are not lost when the ephemeral API disk is wiped.

## Security status (what changed in this phase)

- `backend/utils/imageValidator.js` — **magic-byte validation**. The client's
  MIME type / `.png` name can lie. Every upload is now sniffed from its actual
  bytes (JPEG `FF D8`, PNG signature, GIF87a/89a, RIFF....WEBP) and its header
  dimensions are parsed (PNG IHDR, JPEG SOF, GIF logical screen, WebP VP8 /
  VP8L / VP8X). Anything that does not actually start like a supported image is
  rejected **before** it reaches `/uploads`. SVGs (script-capable) are not
  allowed.
- **Decompression-bomb guard**: header-declared dimensions > 8192px are
  rejected (`MAX_IMAGE_DIMENSION`, `backend/utils/imageValidator.js`).
- Files are staged in the OS temp dir and validated; only valid files are moved
  into storage (`backend/middleware/uploadMiddleware.js`,
  `backend/routes/uploadRoute.js`).
- All writes/removals now go through the `storageService` seam — a controller
  never touches the filesystem directly anymore.

## Switching to object storage

1. Pick an S3-compatible store: Cloudflare R2, AWS S3, GCS, Backblaze B2
   (all speak S3). R2 has no egress fees — good for a Ghana / ER network.
2. Implement the `storageBackend` interface in
   `backend/Services/storageService.js` for `STORAGE_BACKEND=s3`:
   ```js
   const s3Backend = {
     name: 's3',
     async putObject({ key, sourcePath }) { /* upload + delete temp */ },
     async deleteObject(key) { /* 404 => return false */ },
   };
   ```
   The public URL is currently `/uploads/<key>` (same-origin, proxied by the
   hosting provider from the API process). If you move to a CDN domain, return
   the absolute CDN URL from `putObject` and mirror the change in
   `getPublicUrl`.
3. Wire the config: `STORAGE_BACKEND=s3`, `S3_BUCKET`, `S3_REGION`,
   `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (secret manager, never
   commit). Set a bucket policy / CORS for the frontend origin.
4. **When you start writing to S3, keep the legacy local files readable**: the
   old `backend/uploads/*` files must either be migrated (one-time copy job) or
   served as fallback until they age out of the product catalog.
5. Test a full cycle per environment: upload (valid image accepted, renamed
   file rejected), delete (owner-only), reopen the product page and confirm the
   CDN/URL loads with the right `Content-Type`.

## Env knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_BACKEND` | `local` | `local` only today; `s3` fails loudly until implemented |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | S3-compatible config (unused while `local`) |
| `MAX_IMAGE_DIMENSION` | 8192 | pixel cap enforced from image headers |