// utils/checkDatabase.js
// Run this script to verify your database schema
import pool from '../config/db.js';

async function checkDatabase() {
  let connection;
  
  try {
    console.log('🔍 Connecting to database...');
    connection = await pool.getConnection();
    console.log('✅ Database connected successfully\n');

    // Check if users table exists
    console.log('📋 Checking users table structure...');
    const [columns] = await connection.query('DESCRIBE users');
    
    console.log('\n📊 Users Table Columns:');
    console.table(columns.map(col => ({
      Field: col.Field,
      Type: col.Type,
      Null: col.Null,
      Key: col.Key,
      Default: col.Default
    })));

    // Check if required columns exist
    const requiredColumns = [
      'id',
      'firstName', 
      'lastName',
      'email',
      'password',
      'role',
      'isActive',
      'created_at',
      'updated_at'
    ];

    const optionalColumns = [
      'phone',
      'address',
      'city',
      'state',
      'zipCode',
      'country',
      'isEmailVerified',
      'last_login'
    ];

    const existingColumns = columns.map(col => col.Field);
    
    console.log('\n✅ Required Columns Check:');
    requiredColumns.forEach(col => {
      const exists = existingColumns.includes(col);
      console.log(`  ${exists ? '✅' : '❌'} ${col} ${exists ? '(found)' : '(MISSING)'}`);
    });

    console.log('\n📝 Optional Columns Check:');
    optionalColumns.forEach(col => {
      const exists = existingColumns.includes(col);
      console.log(`  ${exists ? '✅' : 'ℹ️ '} ${col} ${exists ? '(found)' : '(not found - OK)'}`);
    });

    // Try to query users table
    console.log('\n🔍 Testing query...');
    const [users] = await connection.query('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Users table is queryable. Total users: ${users[0].count}`);

    // Test a sample query like the one in findAll
    console.log('\n🔍 Testing findAll query...');
    const [testUsers] = await connection.query(`
      SELECT id, firstName, lastName, email, phone, address, city, state, 
             zipCode, country, role, isActive, isEmailVerified, created_at, updated_at 
      FROM users 
      LIMIT 1
    `);
    
    if (testUsers.length > 0) {
      console.log('✅ Sample user retrieved successfully:');
      console.log({
        id: testUsers[0].id,
        name: `${testUsers[0].firstName} ${testUsers[0].lastName}`,
        email: testUsers[0].email,
        role: testUsers[0].role,
        isActive: testUsers[0].isActive
      });
    } else {
      console.log('ℹ️  No users in database yet');
    }

    console.log('\n✅ All database checks passed!');

  } catch (error) {
    console.error('\n❌ Database Error:', error.message);
    console.error('Stack:', error.stack);
    
    if (error.code === 'ER_NO_SUCH_TABLE') {
      console.error('\n💡 Suggestion: The users table does not exist. Please run your database migration.');
    } else if (error.code === 'ER_BAD_FIELD_ERROR') {
      console.error('\n💡 Suggestion: One or more columns are missing from your users table.');
      console.error('   Check the error message above for which column is missing.');
    }
  } finally {
    if (connection) {
      connection.release();
      console.log('\n🔌 Database connection released');
    }
    process.exit(0);
  }
}

// Run the check
checkDatabase();