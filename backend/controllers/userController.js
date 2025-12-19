
import asyncHandler from '../midleware/asyncHandller.js';
import User from '../models/usersModel.js';
import generateToken from '../utils/generateToken.js';
import { 
  generateOTP, 
  getOTPExpiry, 
  sendOTPEmail, 
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmation 
} from '../utils/emailService.js';

// ============================================
// AUTHENTICATION ROUTES
// ============================================

/**
 * @desc    Auth user & get token (LOGIN)
 * @route   POST /api/users/auth
 * @access  Public
 */
const authUser = asyncHandler(async (req, res) => {
  const { email, password, rememberMe } = req.body;

  // Validate input
  if (!email || !password) {
    res.status(400);
    throw new Error('Please provide email and password');
  }

  // Authenticate user
  const user = await User.authenticate(email, password);

  if (!user) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  // Check if user is active
  if (!user.isActive) {
    res.status(403);
    throw new Error('Account is deactivated. Please contact support.');
  }

  // Update last login
  await user.updateLastLogin();

  // Generate token with remember me support
  generateToken(res, user.id, rememberMe === true);

  console.log(`✅ User logged in: ${user.email} (Remember Me: ${rememberMe})`);

  res.json({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    isAdmin: user.role === 'admin',
    isEmailVerified: user.isEmailVerified,
    profilePicture: user.profilePicture
  });
});

/**
 * @desc    Register a new user
 * @route   POST /api/users
 * @access  Public
 */
const registerUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phone, address, city, state, zipCode, country } = req.body;

  // Check if user already exists
  const userExists = await User.findByEmail(email);

  if (userExists) {
    res.status(400);
    throw new Error('User already exists with this email');
  }

  // Create user
  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    phone,
    address,
    city,
    state,
    zipCode,
    country,
    role: 'customer'
  });

  if (user) {
    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    // Save OTP to database
    await User.setVerificationToken(user.id, otp, otpExpiry);

    // Send OTP email
    try {
      await sendOTPEmail(user.email, user.firstName, otp);
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError);
    }

    // Generate token (no remember me on registration)
    generateToken(res, user.id, false);

    res.status(201).json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isAdmin: false,
      isEmailVerified: false,
      message: 'Registration successful. Please check your email for verification code.'
    });
  } else {
    res.status(400);
    throw new Error('Invalid user data');
  }
});

/**
 * @desc    Logout user / clear cookie
 * @route   POST /api/users/logout
 * @access  Private
 */
const logoutUser = asyncHandler(async (req, res) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0)
  });

  res.status(200).json({ message: 'Logged out successfully' });
});

// ============================================
// PASSWORD RESET ROUTES
// ============================================

/**
 * @desc    Request password reset
 * @route   POST /api/users/forgot-password
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    res.status(400);
    throw new Error('Please provide an email address');
  }

  // Find user by email
  const user = await User.findByEmail(email);

  if (!user) {
    // Don't reveal if user exists (security best practice)
    res.status(200).json({
      message: 'If an account exists with this email, a password reset link will be sent.'
    });
    return;
  }

  // Check if user is active
  if (!user.isActive) {
    res.status(403);
    throw new Error('Account is deactivated. Please contact support.');
  }

  try {
    // Generate reset token
    const resetToken = await User.createPasswordResetToken(user.id);

    // Send password reset email
    await sendPasswordResetEmail(user.email, user.firstName, resetToken);

    console.log(`✅ Password reset email sent to ${user.email}`);

    res.status(200).json({
      message: 'Password reset link has been sent to your email address.'
    });
  } catch (error) {
    console.error('❌ Error in forgot password:', error);
    
    // Clear any created tokens
    await User.clearResetToken(user.id);
    
    res.status(500);
    throw new Error('Failed to send password reset email. Please try again.');
  }
});

/**
 * @desc    Reset password with token
 * @route   POST /api/users/reset-password/:token
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  // Validate input
  if (!password || !confirmPassword) {
    res.status(400);
    throw new Error('Please provide both password and confirm password');
  }

  if (password !== confirmPassword) {
    res.status(400);
    throw new Error('Passwords do not match');
  }

  if (password.length < 8) {
    res.status(400);
    throw new Error('Password must be at least 8 characters long');
  }

  // Find user by reset token
  const user = await User.findByResetToken(token);

  if (!user) {
    res.status(400);
    throw new Error('Invalid or expired reset token');
  }

  try {
    // Reset password
    await User.resetPassword(user.id, password);

    // Send confirmation email
    try {
      await sendPasswordResetConfirmation(user.email, user.firstName);
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
    }

    console.log(`✅ Password reset successful for user ${user.email}`);

    res.status(200).json({
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('❌ Error resetting password:', error);
    res.status(500);
    throw new Error('Failed to reset password. Please try again.');
  }
});

/**
 * @desc    Validate reset token
 * @route   GET /api/users/reset-password/:token
 * @access  Public
 */
const validateResetToken = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const user = await User.findByResetToken(token);

  if (!user) {
    res.status(400);
    throw new Error('Invalid or expired reset token');
  }

  res.status(200).json({
    valid: true,
    message: 'Token is valid'
  });
});

// ============================================
// EMAIL VERIFICATION ROUTES
// ============================================

/**
 * @desc    Verify email with OTP
 * @route   POST /api/users/verify-email
 * @access  Private
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const { otp } = req.body;
  const userId = req.user.id;

  if (!otp) {
    res.status(400);
    throw new Error('Please provide OTP code');
  }

  const verifiedUser = await User.verifyEmail(userId, otp);

  if (!verifiedUser) {
    res.status(400);
    throw new Error('Invalid or expired OTP. Please request a new one.');
  }

  try {
    await sendWelcomeEmail(verifiedUser.email, verifiedUser.firstName);
  } catch (emailError) {
    console.error('Failed to send welcome email:', emailError);
  }

  res.json({
    message: 'Email verified successfully',
    isEmailVerified: true
  });
});

/**
 * @desc    Resend OTP
 * @route   POST /api/users/resend-otp
 * @access  Private
 */
const resendOTP = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const user = await User.findById(userId);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  if (user.isEmailVerified) {
    res.status(400);
    throw new Error('Email is already verified');
  }

  const attempts = await User.getVerificationAttempts(userId);
  
  if (attempts.verification_attempts >= 5) {
    res.status(429);
    throw new Error('Too many attempts. Please try again later.');
  }

  const otp = generateOTP();
  const otpExpiry = getOTPExpiry();

  await User.setVerificationToken(userId, otp, otpExpiry);

  try {
    await sendOTPEmail(user.email, user.firstName, otp);
    res.json({ message: 'New OTP has been sent to your email' });
  } catch (error) {
    res.status(500);
    throw new Error('Failed to send OTP. Please try again.');
  }
});

/**
 * @desc    Get verification status
 * @route   GET /api/users/verification-status
 * @access  Private
 */
const getVerificationStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  
  const isVerified = await User.isEmailVerified(userId);
  const attempts = await User.getVerificationAttempts(userId);

  res.json({
    isEmailVerified: isVerified,
    attemptsRemaining: Math.max(0, 5 - attempts.verification_attempts)
  });
});

// ============================================
// USER PROFILE ROUTES
// ============================================

/**
 * @desc    Get user profile
 * @route   GET /api/users/profile
 * @access  Private
 */
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (user) {
    res.json(user.getProfile());
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

/**
 * @desc    Update user profile
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (user) {
    const updatedUser = await User.update(req.user.id, req.body);
    
    res.json({
      id: updatedUser.id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      email: updatedUser.email,
      phone: updatedUser.phone,
      address: updatedUser.address,
      city: updatedUser.city,
      state: updatedUser.state,
      zipCode: updatedUser.zipCode,
      country: updatedUser.country,
      role: updatedUser.role,
      isAdmin: updatedUser.role === 'admin',
      profilePicture: updatedUser.profilePicture
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * @desc    Get all users
 * @route   GET /api/users
 * @access  Private/Admin
 */
const getUsers = asyncHandler(async (req, res) => {
  const options = {
    limit: req.query.limit || 100,
    offset: req.query.offset || 0,
    role: req.query.role,
    isActive: req.query.isActive,
    search: req.query.search
  };

  const users = await User.findAll(options);
  res.json(users);
});

/**
 * @desc    Delete user
 * @route   DELETE /api/users/:id
 * @access  Private/Admin
 */
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    if (user.role === 'admin') {
      res.status(400);
      throw new Error('Cannot delete admin user');
    }
    
    await User.softDelete(req.params.id);
    res.json({ message: 'User removed' });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

/**
 * @desc    Get user by ID
 * @route   GET /api/users/:id
 * @access  Private/Admin
 */
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  
  if (user) {
    res.json(user.getProfile());
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

/**
 * @desc    Update user
 * @route   PUT /api/users/:id
 * @access  Private/Admin
 */
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    const updatedUser = await User.update(req.params.id, req.body);
    
    res.json({
      id: updatedUser.id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      email: updatedUser.email,
      role: updatedUser.role,
      isAdmin: updatedUser.role === 'admin',
      isActive: updatedUser.isActive
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

export {
  authUser,
  registerUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  validateResetToken,
  verifyEmail,
  resendOTP,
  getVerificationStatus,
  getUserProfile,
  updateUserProfile,
  getUsers,
  deleteUser,
  getUserById,
  updateUser
};