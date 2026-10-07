// FILE LOCATION: middleware/uploadMiddleware.js
// DESCRIPTION: Multer setup for product & reference image uploads.
//
// Files are staged in the OS temp directory (NOT the uploads folder) so the
// route can (a) verify magic bytes / dimensions against the real content and
// (b) persist through the storage adapter. Nothing enters /uploads until it has
// passed validation.
import multer from 'multer';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs';

const stagingDir = path.join(os.tmpdir(), 'kente-uploads');
if (!fs.existsSync(stagingDir)) {
  fs.mkdirSync(stagingDir, { recursive: true });
}

const stagingStorage = multer.diskStorage({
  destination: function (_req, _file, cb) { cb(null, stagingDir); },
  filename: function (_req, _file, cb) {
    // Random temp name — the real persisted key is decided by the route after
    // validation, so nothing about the temp name is user-derived.
    cb(null, `stage-${crypto.randomUUID()}`);
  },
});

// File filter - only accept images (extension + declared MIME are a first
// gate; the magic-byte check in the route is the authoritative one).
//
// Anchored, matching the twin that already is in profileRoutes.js: the old
// /jpeg|jpg|png|gif|webp/ matched any filename or MIME CONTAINING a token, so
// `holiday.pngx` (extname `.pngx` holds `png`) and `image/pngfoo` sailed
// through a gate that reads like a control while rejecting nothing. The
// declared MIME is still only the client's word — the magic bytes are the
// evidence — but a gate that accepts everything it claims to filter is worse
// than no gate, because it invites the next reader to rely on it.
const imageFileFilter = (req, file, cb) => {
  const allowedExt = /\.(jpe?g|png|gif|webp)$/i;
  const allowedMime = /^image\/(jpe?g|png|gif|webp)$/;

  if (allowedMime.test(file.mimetype) && allowedExt.test(path.extname(file.originalname))) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'), false);
  }
};

// Configure multer
const upload = multer({
  storage: stagingStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

export default upload;

export { stagingDir, imageFileFilter }; // used by tests + temp cleanup helpers