import express from 'express';
import path from 'path';
import fs from 'fs';
import upload from '../middleware/uploadMiddleware.js';
import { protect } from '../middleware/authMiddleware.js';
import { uploadLimiter } from '../middleware/rateLimitMiddleware.js';
import { validateImageFile } from '../utils/imageValidator.js';
import { putObject, deleteObject, storageBackend } from '../Services/storageService.js';

const router = express.Router();

// Allow admins AND approved vendors to upload product images. Vendors create
// and sell their own products, so they must be able to upload images too —
// but plain customers cannot.
const adminOrVendor = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'vendor')) {
    return next();
  }
  res.status(403);
  const e = new Error('Not authorized as an admin or vendor');
  return next(e);
};

const stagedPath = (file) => file?.path;

const cleanupStaged = async (file) => {
  if (!file?.path) return;
  try {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  } catch { /* best-effort */ }
};

// @desc    Upload product image
// @route   POST /api/upload
// @access  Private/Admin/Vendor
router.post('/', protect, adminOrVendor, uploadLimiter, (req, res) => {
  // Use multer middleware with error handling
  upload.single('image')(req, res, async (err) => {
    // Handle multer-specific errors
    if (err) {
      console.error('❌ Multer error:', err);

      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          message: 'File too large. Maximum size is 5MB.'
        });
      }

      if (err.message && err.message.includes('Only image files')) {
        return res.status(400).json({
          message: err.message
        });
      }

      return res.status(400).json({
        message: err.message || 'Upload failed'
      });
    }

    // Check if file was uploaded
    if (!req.file || !stagedPath(req.file)) {
      return res.status(400).json({
        message: 'No file uploaded. Please select an image file.'
      });
    }

    try {
      // 1) Authoritative magic-byte + dimension validation (client-supplied
      //    MIME/extension can lie). Invalid content is deleted, never stored.
      const verdict = validateImageFile(stagedPath(req.file));
      if (!verdict.valid) {
        await cleanupStaged(req.file);
        return res.status(400).json({ message: verdict.reason });
      }

      // 2) Persist through the storage adapter. Key is
      //    "<ownerId>-product-<ts>-<rand><ext>" so the DELETE route can enforce
      //    that only the uploader (or an admin) may remove the file.
      const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const key = `products/${req.user.id}-product-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const publicUrl = await putObject({ key, sourcePath: stagedPath(req.file) });

      console.log('✅ Image uploaded successfully:', {
        filename: path.basename(key),
        format: verdict.format,
        size: `${(req.file.size / 1024).toFixed(2)} KB`,
        storage: storageBackend.name,
      });

      res.status(200).json({
        message: 'Image uploaded successfully',
        image: publicUrl,
        filename: path.basename(key),
        size: req.file.size,
        mimetype: req.file.mimetype,
      });
    } catch (error) {
      console.error('❌ Upload processing error:', error);
      await cleanupStaged(req.file);
      res.status(500).json({ message: 'Image upload failed' });
    }
  });
});

// @desc    Delete product image
// @route   DELETE /api/upload/:filename
// @access  Private/Admin/Vendor
router.delete('/:filename', protect, adminOrVendor, async (req, res) => {
  try {
    const { filename } = req.params;

    // Ownership check: filename is prefixed "<ownerId>-product-...". Admins may
    // delete any file; vendors may only delete files they uploaded themselves.
    if (req.user.role !== 'admin') {
      const ownerId = filename.split('-', 1)[0];
      if (!ownerId || ownerId !== String(req.user.id)) {
        return res.status(403).json({ message: 'You can only delete files you uploaded' });
      }
    }

    // Sanitize filename to prevent directory traversal attacks
    const sanitizedFilename = path.basename(filename);

    const removed = await deleteObject(`products/${sanitizedFilename}`);
    if (!removed) {
      return res.status(404).json({ message: 'Image not found', filename: sanitizedFilename });
    }
    console.log('✅ Image deleted:', sanitizedFilename);
    res.json({
      message: 'Image deleted successfully',
      filename: sanitizedFilename,
    });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({
      message: 'Failed to delete image: ' + error.message
    });
  }
});

// @desc    Upload a reference image for a custom kente request
// @route   POST /api/upload/reference
// @access  Private (any authenticated user — customers too)
router.post('/reference', protect, uploadLimiter, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      console.error('❌ Reference upload error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: 'File too large. Maximum size is 5MB.' });
      }
      if (err.message && err.message.includes('Only image files')) {
        return res.status(400).json({ message: err.message });
      }
      return res.status(400).json({ message: err.message || 'Upload failed' });
    }
    if (!req.file || !stagedPath(req.file)) {
      return res.status(400).json({ message: 'No file uploaded. Please select an image file.' });
    }
    try {
      const verdict = validateImageFile(stagedPath(req.file));
      if (!verdict.valid) {
        await cleanupStaged(req.file);
        return res.status(400).json({ message: verdict.reason });
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const key = `references/${req.user.id}-reference-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const publicUrl = await putObject({ key, sourcePath: stagedPath(req.file) });

      res.status(200).json({
        message: 'Reference image uploaded successfully',
        image: publicUrl,
        filename: path.basename(key),
        size: req.file.size,
        mimetype: req.file.mimetype,
      });
    } catch {
      await cleanupStaged(req.file);
      res.status(500).json({ message: 'Reference upload failed' });
    }
  });
});

// @desc    Delete a reference image the caller uploaded
// @route   DELETE /api/upload/reference/:filename
// @access  Private (owner or admin)
router.delete('/reference/:filename', protect, async (req, res) => {
  try {
    const { filename } = req.params;
    if (req.user.role !== 'admin') {
      const ownerId = filename.split('-', 1)[0];
      if (!ownerId || ownerId !== String(req.user.id)) {
        return res.status(403).json({ message: 'You can only delete files you uploaded' });
      }
    }
    const sanitized = path.basename(filename);
    const removed = await deleteObject(`references/${sanitized}`);
    if (!removed) {
      return res.status(404).json({ message: 'File not found' });
    }
    res.json({ message: 'Reference image deleted', filename: sanitized });
  } catch {
    res.status(500).json({ message: 'Failed to delete reference image' });
  }
});

export default router;