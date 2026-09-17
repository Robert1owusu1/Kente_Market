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
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
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

export { stagingDir }; // used in tests + temp cleanup helpers