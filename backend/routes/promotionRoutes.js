import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  listPromotions,
  getActiveBanners,
  getActivePopups,
  getActivePromotions,
  getPromotion,
  createPromotion,
  updatePromotion,
  deletePromotion,
} from '../controllers/promotionController.js';

const router = express.Router();

// Public routes — no auth needed (for hero + popup)
router.get('/public/banners', getActiveBanners);
router.get('/public/popups', getActivePopups);
router.get('/public/all', getActivePromotions);

// Admin CRUD
router.get('/', protect, admin, listPromotions);
router.get('/:id', protect, admin, getPromotion);
router.post('/', protect, admin, createPromotion);
router.put('/:id', protect, admin, updatePromotion);
router.delete('/:id', protect, admin, deletePromotion);

export default router;
