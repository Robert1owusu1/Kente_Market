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
    changePassword,
    getUsers,
    deleteUser,
    getUserById,
    updateUser,
    verifyEmail,
    resendOTP,
    getVerificationStatus
} from '../controllers/userController.js';
import { protect, admin } from "../middleware/authMiddleware.js";
import { authLimiter, accountAuthLimiter, passwordResetLimiter, accountResetLimiter, registerLimiter, accountRegisterLimiter } from "../middleware/rateLimitMiddleware.js";
import { validate, updateUserProfileSchema, changePasswordSchema } from "../middleware/validators.js";

// ============================================
// PUBLIC ROUTES (No Authentication Required)
// ============================================

// Register new user
// POST /api/users
router.post('/', registerLimiter, accountRegisterLimiter, registerUser);

// Login user (rate-limited to prevent brute-force)
// POST /api/users/auth
// Two limiters, both required: `authLimiter` bounds one source address, and
// `accountAuthLimiter` bounds attempts against ONE target account using a key
// the client cannot forge (it has no IP component, so rotating
// X-Forwarded-For does not reset it).
router.post('/auth', authLimiter, accountAuthLimiter, authUser);

// Logout user
// POST /api/users/logout
router.post('/logout', logoutUser);

// ============================================
// PASSWORD RESET ROUTES (Public)
// ============================================

// Request password reset (sends email with reset link)
// POST /api/users/forgot-password
// `accountResetLimiter` is keyed on the TARGET email (no IP component), so an
// attacker rotating X-Forwarded-For cannot mail-bomb a victim or grind reset
// tokens — the IP-keyed limiter alone was measured bypassable that way.
router.post('/forgot-password', passwordResetLimiter, accountResetLimiter, forgotPassword);

// Validate reset token (check if token is valid and not expired)
// GET /api/users/reset-password/:token
// Rate-limited like its mutating sibling: this is a public oracle that confirms
// whether a guessed or leaked token is live and unexpired, so it needs the same
// 3/hour cap rather than being an unthrottled probe.
router.get('/reset-password/:token', passwordResetLimiter, validateResetToken);

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
    .put(protect, validate(updateUserProfileSchema), updateUserProfile);

// Change own password. Separate from the profile route so it can require the
// current password — see the comment on changePassword.
// PUT /api/users/password
router.put('/password', protect, authLimiter, validate(changePasswordSchema), changePassword);

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