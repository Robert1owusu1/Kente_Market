import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { protect } from '../middleware/authMiddleware.js';
import { uploadLimiter } from '../middleware/rateLimitMiddleware.js';
import { validateImageFile } from '../utils/imageValidator.js';
import User from '../models/usersModel.js';

const router = express.Router();

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create profiles directory if it doesn't exist
const profilesDir = path.join(__dirname, '..', 'uploads', 'profiles');
if (!fs.existsSync(profilesDir)) {
  fs.mkdirSync(profilesDir, { recursive: true });
 console.log(' Created profiles directory:', profilesDir);
}

// Belt-and-braces: users.profile_picture is only ever written by this route,
// but if a traversal value ever landed in the column, unlinking it would
// delete arbitrary files. Only delete inside uploads/profiles.
const resolveProfilePath = (storedPath) => {
  const resolved = path.resolve(__dirname, '..', storedPath);
  return resolved.startsWith(profilesDir + path.sep) ? resolved : null;
};

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, profilesDir);
  },
  filename: (req, file, cb) => {
    // Unguessable filename. This used to be `profile_<userId>_<Date.now()>.ext`
    // where userId is a small sequential integer and the millisecond timestamp
    // is the only other secret - so profile pictures were enumerable by anyone
    // who could guess a plausible id and time window, and /uploads is served
    // from the API origin so the URL is directly probeable.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `profile_${randomUUID()}${ext}`);
  },
});

// File filter - only allow images. Anchored regexes (the old unanchored
// /jpeg|jpg|png/ matched any MIME or filename CONTAINING a token).
const fileFilter = (req, file, cb) => {
  const allowedExt = /\.(jpe?g|png|gif|webp)$/i;
  const allowedMime = /^image\/(jpe?g|png|gif|webp)$/;

  if (allowedMime.test(file.mimetype) && allowedExt.test(path.extname(file.originalname))) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

// Initialize multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: fileFilter,
});

// @desc    Upload profile picture
// @route   POST /api/profile/upload
// @access  Private
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
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: verdict.reason || 'Invalid image file' });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      // Delete uploaded file if user not found
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete old profile picture if exists
    if (user.profile_picture) {
      const oldPicturePath = resolveProfilePath(user.profile_picture);
      if (oldPicturePath && fs.existsSync(oldPicturePath)) {
        fs.unlinkSync(oldPicturePath);
 console.log(' Deleted old profile picture:', oldPicturePath);
      }
    }

    // Update user with new profile picture path
    const profilePicturePath = `/uploads/profiles/${req.file.filename}`;
    
    await User.updateProfilePicture(userId, profilePicturePath);

 console.log(` Profile picture uploaded for user ${userId}:`, profilePicturePath);

    res.json({
      message: 'Profile picture uploaded successfully',
      profilePicture: profilePicturePath,
      filename: req.file.filename,
      size: req.file.size,
    });
  } catch (error) {
 console.error(' Error uploading profile picture:', error);
    
    // Delete uploaded file if error occurs
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    // No raw error.message here: it is fs/driver text (ENOENT, EACCES, SQL)
    // and this route is reachable by any signed-in user.
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

    if (!user.profile_picture) {
      return res.status(400).json({ message: 'No profile picture to delete' });
    }

    // Delete file from filesystem (only inside uploads/profiles)
    const picturePath = resolveProfilePath(user.profile_picture);
    if (picturePath && fs.existsSync(picturePath)) {
      fs.unlinkSync(picturePath);
 console.log(' Deleted profile picture:', picturePath);
    }

    // Update database
    await User.updateProfilePicture(userId, null);

    res.json({ message: 'Profile picture deleted successfully' });
  } catch (error) {
 console.error(' Error deleting profile picture:', error);
    res.status(500).json({ message: 'Failed to delete profile picture' });
  }
});

export default router;