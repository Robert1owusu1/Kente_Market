// utils/testApiEndpoint.js
// This simulates what happens when the API is called

import User from '../models/usersModel.js';

async function testGetUsersController() {
  console.log('🧪 Testing getUsers controller logic...\n');

  try {
    // Simulate the controller logic
    console.log('📋 Simulating: GET /api/users');
    
    const options = {
      limit: 100,
      offset: 0,
      role: null,
      isActive: null,
      search: null
    };
    
    console.log('Query options:', options);
    
    const users = await User.findAll(options);
    
    console.log(`✅ Successfully fetched ${users.length} users`);
    
    // Make sure passwords are not included (double check)
    const sanitizedUsers = users.map(user => {
      const userObj = typeof user.getProfile === 'function' ? user.getProfile() : { ...user };
      delete userObj.password;
      return userObj;
    });
    
    console.log('\n📊 Sample user response:');
    console.log(JSON.stringify(sanitizedUsers[0], null, 2));
    
    // Check if any user has password
    const hasPassword = sanitizedUsers.some(u => u.password !== undefined);
    if (hasPassword) {
      console.log('\n⚠️  WARNING: Some users still have passwords in response!');
    } else {
      console.log('\n✅ All passwords properly excluded');
    }
    
    console.log('\n🎉 Controller logic test passed!');
    console.log('\n💡 Next steps:');
    console.log('   1. Update your userController.js with the fixed version');
    console.log('   2. Restart your server');
    console.log('   3. Try accessing GET /api/users from your frontend');
    console.log('\n   If it still fails, check:');
    console.log('   - Authentication middleware (if any)');
    console.log('   - Route definition');
    console.log('   - CORS settings');

  } catch (error) {
    console.error('\n❌ Test Failed!');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

testGetUsersController();