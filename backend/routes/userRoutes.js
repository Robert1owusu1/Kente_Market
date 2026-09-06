// routes/userRoutes.js - COMPLETE VERSION
import express from "express";
const router = express.Router();
import {
    authUser,
    registerUser,
    logoutUser,
    forgotPassword,
    resetPassword,
    validateResetToken,
    getUserProfile,
    updateUserProfile,
    getUsers,
    deleteUser,
    getUserById,
    updateUser,
    verifyEmail,
    resendOTP,
    getVerificationStatus
} from '../controllers/userController.js';
import { protect, admin } from "../middleware/authMiddleware.js";
import { authLimiter, passwordResetLimiter } from "../middleware/rateLimitMiddleware.js";

// ============================================
// PUBLIC ROUTES (No Authentication Required)
// ============================================

// Register new user
// POST /api/users
router.post('/', registerUser);

// Login user (rate-limited to prevent brute-force)
// POST /api/users/auth
router.post('/auth', authLimiter, authUser);

// Logout user
// POST /api/users/logout
router.post('/logout', logoutUser);

// ============================================
// PASSWORD RESET ROUTES (Public)
// ============================================

// Request password reset (sends email with reset link)
// POST /api/users/forgot-password
router.post('/forgot-password', passwordResetLimiter, forgotPassword);

// Validate reset token (check if token is valid and not expired)
// GET /api/users/reset-password/:token
router.get('/reset-password/:token', validateResetToken);

// Reset password with token
// POST /api/users/reset-password/:token
router.post('/reset-password/:token', passwordResetLimiter, resetPassword);

// ============================================
// EMAIL VERIFICATION ROUTES (Protected)
// ============================================

// Verify email with OTP (rate-limited to prevent OTP brute-force)
// POST /api/users/verify-email
router.post('/verify-email', protect, authLimiter, verifyEmail);

// Resend OTP (rate-limited to prevent email spamming)
// POST /api/users/resend-otp
router.post('/resend-otp', protect, authLimiter, resendOTP);

// Get verification status
// GET /api/users/verification-status
router.get('/verification-status', protect, getVerificationStatus);

// ============================================
// USER PROFILE ROUTES (Protected)
// ============================================

// Get current user profile & Update current user profile
// GET /api/users/profile
// PUT /api/users/profile
router.route('/profile')
    .get(protect, getUserProfile)
    .put(protect, updateUserProfile);

// ============================================
// ADMIN ROUTES (Protected + Admin Only)
// ============================================

// Get all users (admin only)
// GET /api/users
router.get('/', protect, admin, getUsers);

// User management by ID (admin only)
// DELETE /api/users/:id - Delete user
// GET /api/users/:id - Get user by ID
// PUT /api/users/:id - Update user
router.route('/:id')
    .delete(protect, admin, deleteUser)
    .get(protect, admin, getUserById)
    .put(protect, admin, updateUser);

export default router;