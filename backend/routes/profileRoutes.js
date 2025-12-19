import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { protect } from '../midleware/authMiddleware.js';
import User from '../models/usersModel.js';

const router = express.Router();

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create profiles directory if it doesn't exist
const profilesDir = path.join(__dirname, '..', 'uploads', 'profiles');
if (!fs.existsSync(profilesDir)) {
  fs.mkdirSync(profilesDir, { recursive: true });
  console.log('✅ Created profiles directory:', profilesDir);
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, profilesDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: userId_timestamp.ext
    const uniqueSuffix = `${req.user.id}_${Date.now()}`;
    const ext = path.extname(file.originalname);
    cb(null, `profile_${uniqueSuffix}${ext}`);
  },
});

// File filter - only allow images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
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
router.post('/upload', protect, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
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
      const oldPicturePath = path.join(__dirname, '..', user.profile_picture);
      if (fs.existsSync(oldPicturePath)) {
        fs.unlinkSync(oldPicturePath);
        console.log('🗑️ Deleted old profile picture:', oldPicturePath);
      }
    }

    // Update user with new profile picture path
    const profilePicturePath = `/uploads/profiles/${req.file.filename}`;
    
    await User.updateProfilePicture(userId, profilePicturePath);

    console.log(`✅ Profile picture uploaded for user ${userId}:`, profilePicturePath);

    res.json({
      message: 'Profile picture uploaded successfully',
      profilePicture: profilePicturePath,
      filename: req.file.filename,
      size: req.file.size,
    });
  } catch (error) {
    console.error('❌ Error uploading profile picture:', error);
    
    // Delete uploaded file if error occurs
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      message: 'Failed to upload profile picture',
      error: error.message 
    });
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

    // Delete file from filesystem
    const picturePath = path.join(__dirname, '..', user.profile_picture);
    if (fs.existsSync(picturePath)) {
      fs.unlinkSync(picturePath);
      console.log('🗑️ Deleted profile picture:', picturePath);
    }

    // Update database
    await User.updateProfilePicture(userId, null);

    res.json({ message: 'Profile picture deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting profile picture:', error);
    res.status(500).json({ 
      message: 'Failed to delete profile picture',
      error: error.message 
    });
  }
});

export default router;