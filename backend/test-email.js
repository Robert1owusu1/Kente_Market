import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

console.log('='.repeat(60));
console.log('📧 TESTING EMAIL CONFIGURATION');
console.log('='.repeat(60));

// Check if environment variables are loaded
console.log('\n1️⃣ CHECKING ENVIRONMENT VARIABLES:');
console.log('   EMAIL_USER:', process.env.EMAIL_USER ? '✅ Set' : '❌ Not Set');
console.log('   EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? '✅ Set' : '❌ Not Set');
console.log('   EMAIL_SERVICE:', process.env.EMAIL_SERVICE || 'gmail (default)');

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
  console.error('\n❌ ERROR: Email credentials not found in .env file!');
  process.exit(1);
}

// Show masked credentials
const email = process.env.EMAIL_USER;
const password = process.env.EMAIL_PASSWORD;
console.log('\n2️⃣ CREDENTIALS (MASKED):');
console.log('   Email:', email);
console.log('   Password Length:', password.length, 'characters');
console.log('   Password First 4:', password.substring(0, 4) + '****');
console.log('   Password Last 4:', '****' + password.substring(password.length - 4));
console.log('   Has Spaces?', password.includes(' ') ? '⚠️ YES (PROBLEM!)' : '✅ NO');

// Create transporter
console.log('\n3️⃣ TESTING CONNECTION:');
console.log('   Server: smtp.gmail.com');
console.log('   Port: 587 (TLS)');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: email,
    pass: password,
  },
  debug: true, // Show detailed logs
  logger: true, // Enable logging
});

// Test connection
console.log('\n4️⃣ VERIFYING CONNECTION...');
try {
  await transporter.verify();
  console.log('   ✅ CONNECTION SUCCESSFUL!\n');
  
  // Try sending a test email
  console.log('5️⃣ SENDING TEST EMAIL...');
  const info = await transporter.sendMail({
    from: email,
    to: email, // Send to yourself
    subject: 'Test Email - Bonwire Kente',
    text: 'If you receive this, your email configuration is working correctly!',
    html: '<h1>✅ Success!</h1><p>Your email configuration is working correctly!</p>',
  });
  
  console.log('   ✅ TEST EMAIL SENT SUCCESSFULLY!');
  console.log('   Message ID:', info.messageId);
  console.log('\n' + '='.repeat(60));
  console.log('🎉 ALL TESTS PASSED! Email is configured correctly.');
  console.log('='.repeat(60));
  
} catch (error) {
  console.error('\n   ❌ CONNECTION FAILED!\n');
  console.error('ERROR DETAILS:');
  console.error('   Code:', error.code);
  console.error('   Response:', error.response);
  console.error('   Command:', error.command);
  
  console.log('\n' + '='.repeat(60));
  console.log('🔧 TROUBLESHOOTING STEPS:');
  console.log('='.repeat(60));
  
  if (error.code === 'EAUTH') {
    console.log('\n❌ AUTHENTICATION ERROR:');
    console.log('   This means Gmail rejected your username/password.\n');
    console.log('   FIX STEPS:');
    console.log('   1. Go to: https://myaccount.google.com/apppasswords');
    console.log('   2. Make sure 2-Step Verification is enabled');
    console.log('   3. Generate a NEW App Password:');
    console.log('      - Select "Mail" as the app');
    console.log('      - Select "Other" as the device');
    console.log('      - Name it "Bonwire Kente"');
    console.log('   4. Copy the 16-character password (NO SPACES!)');
    console.log('   5. Update .env file:');
    console.log('      EMAIL_PASSWORD=yourpasswordwithoutspaces');
    console.log('   6. Restart your server');
    
    if (password.includes(' ')) {
      console.log('\n   ⚠️ YOUR PASSWORD HAS SPACES! Remove them!');
      console.log('   Current: "' + password + '"');
      console.log('   Should be: "' + password.replace(/\s/g, '') + '"');
    }
  } else if (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT') {
    console.log('\n❌ CONNECTION ERROR:');
    console.log('   Cannot reach Gmail server.\n');
    console.log('   FIX STEPS:');
    console.log('   1. Check your internet connection');
    console.log('   2. Temporarily disable antivirus/firewall');
    console.log('   3. Try a different network (mobile hotspot)');
  }
  
  console.log('\n' + '='.repeat(60));
  process.exit(1);
}