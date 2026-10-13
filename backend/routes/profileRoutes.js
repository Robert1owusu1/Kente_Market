import express from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { protect } from '../middleware/authMiddleware.js';
import { uploadLimiter } from '../middleware/rateLimitMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';
import { validateImageFile } from '../utils/imageValidator.js';
import { putObject, deleteObject, storageBackend } from '../Services/storageService.js';
import User from '../models/usersModel.js';

const router = express.Router();

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pictures stored before STORE-1 live on local disk under uploads/profiles.
const profilesDir = path.join(__dirname, '..', 'uploads', 'profiles');

// Belt-and-braces: users.profile_picture is only ever written by this route,
// but if a traversal value ever landed in the column, unlinking it would
// delete arbitrary files. Only delete inside uploads/profiles.
const resolveProfilePath = (storedPath) => {
  const resolved = path.resolve(__dirname, '..', String(storedPath).replace(/^\/+/, ''));
  return resolved.startsWith(profilesDir + path.sep) ? resolved : null;
};

// The object name inside the stored value, whatever the backend: a local
// '/uploads/profiles/<name>', or an S3 / CDN URL ending in 'profiles/<name>'.
const profileObjectName = (stored) => {
  const m = /(?:^|\/)profiles\/(profile_[A-Za-z0-9_-]+\.[a-z0-9]+)$/i.exec(String(stored || ''));
  return m ? m[1] : null;
};

// Remove a previous picture from the active backend, and from local disk if it
// predates a switch to object storage. Best-effort: a failed delete must not
// fail the upload/delete request.
const removeStoredPicture = async (stored) => {
  const name = profileObjectName(stored);
  if (name) {
    await deleteObject(`profiles/${name}`).catch((err) => {
 console.warn(` Could not delete old profile picture ${name}: ${err.message}`);
    });
  }
  const legacy = stored && String(stored).startsWith('/uploads/profiles/') ? resolveProfilePath(stored) : null;
  if (legacy && fs.existsSync(legacy)) fs.unlinkSync(legacy);
};

const cleanupStaged = (file) => {
  try {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  } catch { /* best-effort */ }
};

// @desc    Upload profile picture
// @route   POST /api/profile/upload
// @access  Private
// STORE-1: the picture used to be written straight to backend/uploads/profiles
// by a route-local multer disk engine, bypassing storageService — with STORAGE_BACKEND=s3
// on a host without a persistent disk every profile picture vanished on the
// next deploy. Now: stage to tmp (shared upload middleware: image filter,
// 5 MB), validate the real bytes, then store through the configured backend.
router.post('/upload', protect, uploadLimiter, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Client-supplied MIME/extension can lie — validate the actual bytes
    // (magic numbers + header-derived dimensions) exactly like the product
    // upload path does. Invalid content is deleted, never stored.
    const verdict = validateImageFile(req.file.path);
    if (!verdict.valid) {
      cleanupStaged(req.file);
      return res.status(400).json({ message: verdict.reason || 'Invalid image file' });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      cleanupStaged(req.file);
      return res.status(404).json({ message: 'User not found' });
    }

    // Unguessable name; the extension comes from the sniffed bytes, never the
    // client's filename (same rule as product uploads).
    const filename = `profile_${randomUUID()}.${verdict.format}`;
    const profilePicturePath = await putObject({ key: `profiles/${filename}`, sourcePath: req.file.path });

    await User.updateProfilePicture(userId, profilePicturePath);

    // Only after the new picture is saved: remove the previous one.
    // PIC-1: the model exposes `profilePicture` (camelCase). This route read
    // `user.profile_picture`, which is always undefined, so replaced pictures
    // were never removed and DELETE always answered 400.
    if (user.profilePicture && user.profilePicture !== profilePicturePath) {
      await removeStoredPicture(user.profilePicture);
    }

 console.log(` Profile picture uploaded for user ${userId} (${storageBackend.name}):`, filename);

    res.json({
      message: 'Profile picture uploaded successfully',
      profilePicture: profilePicturePath,
      filename,
      size: req.file.size,
    });
  } catch (error) {
 console.error(' Error uploading profile picture:', error);
    cleanupStaged(req.file);
    // No raw error.message here: it is fs/driver/storage text and this route
    // is reachable by any signed-in user.
    res.status(500).json({ message: 'Failed to upload profile picture' });
  }
});

// @desc    Delete profile picture
// @route   DELETE /api/profile/picture
// @access  Private
router.delete('/picture', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.profilePicture) {
      return res.status(400).json({ message: 'No profile picture to delete' });
    }

    await removeStoredPicture(user.profilePicture);
    await User.updateProfilePicture(userId, null);

    res.json({ message: 'Profile picture deleted successfully' });
  } catch (error) {
 console.error(' Error deleting profile picture:', error);
    res.status(500).json({ message: 'Failed to delete profile picture' });
  }
});

export default router;
