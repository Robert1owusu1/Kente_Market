import express from 'express';
import upload from '../midleware/uploadMidleware.js';
import { protect, admin } from '../midleware/authMiddleware.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @desc    Upload product image
// @route   POST /api/upload
// @access  Private/Admin
router.post('/', protect, admin, (req, res) => {
  // Use multer middleware with error handling
  upload.single('image')(req, res, (err) => {
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
    if (!req.file) {
      return res.status(400).json({ 
        message: 'No file uploaded. Please select an image file.' 
      });
    }

    try {
      console.log('✅ Image uploaded successfully:', {
        filename: req.file.filename,
        size: `${(req.file.size / 1024).toFixed(2)} KB`,
        mimetype: req.file.mimetype
      });

      // Return the file path that can be used in the frontend
      const imagePath = `/uploads/products/${req.file.filename}`;
      
      res.status(200).json({
        message: 'Image uploaded successfully',
        image: imagePath,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype
      });
    } catch (error) {
      console.error('❌ Upload processing error:', error);
      
      // Clean up uploaded file if processing fails
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
          console.log('🗑️ Cleaned up failed upload:', req.file.filename);
        } catch (cleanupErr) {
          console.error('Failed to cleanup file:', cleanupErr);
        }
      }
      
      res.status(500).json({ 
        message: error.message || 'Image upload failed' 
      });
    }
  });
});

// @desc    Delete product image
// @route   DELETE /api/upload/:filename
// @access  Private/Admin
router.delete('/:filename', protect, admin, (req, res) => {
  try {
    const { filename } = req.params;
    
    // Sanitize filename to prevent directory traversal attacks
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(__dirname, '../uploads/products', sanitizedFilename);

    // Security: ensure the file is within the uploads directory
    const uploadsDir = path.join(__dirname, '../uploads/products');
    if (!filePath.startsWith(uploadsDir)) {
      return res.status(403).json({ message: 'Invalid file path' });
    }

    // Check if file exists
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('✅ Image deleted:', sanitizedFilename);
      res.json({ 
        message: 'Image deleted successfully',
        filename: sanitizedFilename 
      });
    } else {
      res.status(404).json({ 
        message: 'Image not found',
        filename: sanitizedFilename 
      });
    }
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ 
      message: 'Failed to delete image: ' + error.message 
    });
  }
});

export default router;