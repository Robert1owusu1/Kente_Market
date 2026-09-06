// routes/certificateRoutes.js
import express from 'express';
const router = express.Router();

import { protect, admin } from '../middleware/authMiddleware.js';
import {
  issueCertificate,
  verifyCertificate,
  getMyCertificates,
  listCertificates,
} from '../controllers/certificateController.js';

// GET /api/certificates/verify/:tokenOrNumber → public QR/provenance check
router.route('/verify/:tokenOrNumber').get(verifyCertificate);

// GET /api/certificates/mine → customer's certificates
router.route('/mine').get(protect, getMyCertificates);

// POST /api/certificates → admin issues a certificate
router.route('/').post(protect, admin, issueCertificate);

// GET /api/certificates → admin list
router.route('/').get(protect, admin, listCertificates);

export default router;