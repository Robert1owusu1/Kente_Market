// routes/campaignRoutes.js
import express from 'express';
const router = express.Router();

import { protect, admin } from '../middleware/authMiddleware.js';
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
} from '../controllers/campaignController.js';

// GET /api/campaigns → active campaigns (public); all with ?all=1 (admin)
router.route('/').get(listCampaigns);
router.route('/').post(protect, admin, createCampaign);

// GET /api/campaigns/:id → single campaign
router.route('/:id').get(getCampaign);
router.route('/:id').put(protect, admin, updateCampaign);
router.route('/:id').delete(protect, admin, deleteCampaign);

export default router;