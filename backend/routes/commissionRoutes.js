// routes/commissionRoutes.js
import express from 'express';
const router = express.Router();

import { protect, admin } from '../middleware/authMiddleware.js';
import {
  listCommissionRules,
  createCommissionRule,
  updateCommissionRule,
  deleteCommissionRule,
} from '../controllers/commissionController.js';

router.route('/').get(protect, admin, listCommissionRules);
router.route('/').post(protect, admin, createCommissionRule);
router.route('/:id').put(protect, admin, updateCommissionRule);
router.route('/:id').delete(protect, admin, deleteCommissionRule);

export default router;