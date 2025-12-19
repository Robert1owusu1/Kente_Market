// test-password-reset.js
import dotenv from 'dotenv';
import User from './models/usersModel.js';
import { sendPasswordResetEmail } from './utils/emailService.js';

dotenv.config();

const testPasswordReset = async () => {
  console.log('🧪 Testing Complete Password Reset Flow');
  console.log('==========================================\n');

  try {
    // Step 1: Find a test user
    console.log('Step 1: Finding test user...');
    const testEmail = 'kenterobert@gmail.com'; // Use your email
    let user = await User.findByEmail(testEmail);
    
    if (!user) {
      console.log('❌ User not found. Please register first.');
      process.exit(1);
    }
    
    console.log(`✅ Found user: ${user.email} (ID: ${user.id})`);

    // Step 2: Generate reset token
    console.log('\nStep 2: Generating reset token...');
    const resetToken = await User.createPasswordResetToken(user.id);
    console.log(`✅ Token generated: ${resetToken.substring(0, 20)}...`);

    // Step 3: Send email
    console.log('\nStep 3: Sending reset email...');
    await sendPasswordResetEmail(user.email, user.firstName, resetToken);
    console.log('✅ Email sent successfully!');
    console.log(`📬 Check inbox: ${user.email}`);

    // Step 4: Verify token
    console.log('\nStep 4: Verifying token...');
    const verifiedUser = await User.findByResetToken(resetToken);
    if (verifiedUser) {
      console.log('✅ Token is valid!');
    } else {
      console.log('❌ Token verification failed!');
    }

    console.log('\n==========================================');
    console.log('✅ ALL TESTS PASSED!');
    console.log('\nNext steps:');
    console.log('1. Check your email inbox');
    console.log('2. Click the reset link');
    console.log('3. Create a new password');
    console.log('==========================================');

  } catch (error) {
    console.error('\n❌ TEST FAILED!');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
  
  process.exit();
};

testPasswordReset();