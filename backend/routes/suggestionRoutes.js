import express from 'express';
const router = express.Router();
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  createSuggestion,
  getMySuggestions,
  getAllSuggestions,
  updateSuggestionStatus,
} from '../controllers/suggestionController.js';

// POST /api/suggestions → user submits a suggestion
router.route('/').post(protect, createSuggestion);

// GET /api/suggestions/me → suggestions the user submitted
router.route('/me').get(protect, getMySuggestions);

// GET /api/suggestions/all → all suggestions (admin)
router.route('/all').get(protect, admin, getAllSuggestions);

// PUT /api/suggestions/:id/status → admin updates status (mark done etc.)
router.route('/:id/status').put(protect, admin, updateSuggestionStatus);

export default router;