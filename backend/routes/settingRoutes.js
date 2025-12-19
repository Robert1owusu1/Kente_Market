// FILE LOCATION: routes/settingRoutes.js
// DESCRIPTION: API routes for settings management

import express from 'express';
import { protect, admin } from '../midleware/authMiddleware.js'; // Using your typo path
import { cacheMiddleware } from '../midleware/cacheMiddleware.js';
import {
  getSettings,
  getSetting,
  updateSettings,
  deleteSetting
} from '../controllers/settingController.js';

const router = express.Router();

/**
 * @route   GET /api/settings
 * @desc    Get all settings
 * @access  Private/Admin
 * @cache   5 minutes
 * 
 * @route   PUT /api/settings
 * @desc    Update multiple settings
 * @access  Private/Admin
 */
router.route('/')
  .get(protect, admin, cacheMiddleware(300), getSettings)
  .put(protect, admin, updateSettings);

/**
 * @route   GET /api/settings/:key
 * @desc    Get single setting by key
 * @access  Private/Admin
 * 
 * @route   DELETE /api/settings/:key
 * @desc    Delete a setting
 * @access  Private/Admin
 */
router.route('/:key')
  .get(protect, admin, getSetting)
  .delete(protect, admin, deleteSetting);

export default router;