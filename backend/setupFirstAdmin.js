// setupFirstAdmin.js - Secure one-time admin setup script
import dotenv from 'dotenv';
dotenv.config();

import readline from 'readline';
import User from './models/usersModel.js';
import pool from './config/db.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Password strength validation (same as your controller)
const validatePasswordStrength = (password) => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const errors = [];
  
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long`);
  }
  if (!hasUpperCase) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!hasLowerCase) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!hasNumbers) {
    errors.push('Password must contain at least one number');
  }
  if (!hasSpecialChar) {
    errors.push('Password must contain at least one special character');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const setupAdmin = async () => {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🔐 BRANDING HOUSE - First-Time Admin Setup');
    console.log('='.repeat(60) + '\n');

    // Check database connection
    await pool.getConnection();
    console.log('✅ Database connected\n');

    // Check if any admin exists
    const [admins] = await pool.query('SELECT id, email FROM users WHERE role = "admin"');
    
    if (admins.length > 0) {
      console.log('❌ SECURITY: Admin user already exists!');
      console.log(`   Email: ${admins[0].email}`);
      console.log('   This script can only run once for security reasons.\n');
      console.log('   If you need to create another admin, use the admin panel.');
      rl.close();
      process.exit(0);
    }

    console.log('📝 Please provide admin account details:\n');
    
    // Get admin details
    const firstName = await question('First Name: ');
    if (!firstName.trim()) {
      throw new Error('First name is required');
    }

    const lastName = await question('Last Name: ');
    if (!lastName.trim()) {
      throw new Error('Last name is required');
    }

    const email = await question('Email: ');
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      throw new Error('Valid email is required');
    }

    // Check if email already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      throw new Error('A user with this email already exists');
    }

    console.log('\nPassword Requirements:');
    console.log('  • At least 8 characters long');
    console.log('  • Contains uppercase and lowercase letters');
    console.log('  • Contains at least one number');
    console.log('  • Contains at least one special character (!@#$%^&*...)\n');

    const password = await question('Password: ');
    
    // Validate password
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      console.log('\n❌ Password does not meet requirements:');
      passwordValidation.errors.forEach(err => console.log(`   • ${err}`));
      throw new Error('Invalid password');
    }

    const confirmPassword = await question('Confirm Password: ');
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }

    console.log('\n🔄 Creating admin account...\n');

    // Create admin user with email verified
    const userData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      password: password,
      role: 'admin',
      isActive: true
    };

    const user = await User.create(userData);

    if (!user) {
      throw new Error('Failed to create admin user');
    }

    // Manually set email as verified (bypass OTP for first admin)
    await pool.query(
      'UPDATE users SET isEmailVerified = 1, emailVerifiedAt = NOW() WHERE id = ?',
      [user.id]
    );

    console.log('='.repeat(60));
    console.log('✅ ADMIN ACCOUNT CREATED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log(`\n📧 Email: ${email}`);
    console.log(`👤 Name: ${firstName} ${lastName}`);
    console.log(`🔑 Role: Admin`);
    console.log(`✉️  Email Verified: Yes`);
    console.log(`\n🎉 You can now login to the admin panel!`);
    console.log(`🌐 Admin URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}/login\n`);
    console.log('🔒 SECURITY NOTE: This script will not run again.\n');
    console.log('='.repeat(60) + '\n');

    rl.close();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('\nSetup failed. Please try again.\n');
    rl.close();
    process.exit(1);
  }
};

// Run the setup
setupAdmin();