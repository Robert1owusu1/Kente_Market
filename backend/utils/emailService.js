// utils/emailService.js - FIXED FOR NODEMAILER V7
import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Create transporter - Fixed for nodemailer v7
const createTransporter = () => {
  // Debug log
  console.log('Creating email transporter...');
  
  const config = {
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  };
  
  console.log('Email config:', {
    service: config.service,
    user: config.auth.user,
    passLength: config.auth.pass?.length
  });

  try {
    const transporter = nodemailer.createTransport(config);
    console.log('✅ Transporter created successfully');
    return transporter;
  } catch (error) {
    console.error('❌ Failed to create transporter:', error);
    throw error;
  }
};

// Generate 6-digit OTP
export const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Calculate OTP expiry time
export const getOTPExpiry = () => {
  const minutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + minutes);
  return expiry;
};

// ============================================
// EMAIL VERIFICATION EMAILS
// ============================================

/**
 * Send OTP email for email verification
 */
export const sendOTPEmail = async (email, firstName, otp) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'Branding House <noreply@brandinghouse.com>',
    to: email,
    subject: 'Email Verification - Branding House',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .otp-box { background: white; border: 2px dashed #f59e0b; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
          .otp-code { font-size: 32px; font-weight: bold; color: #f59e0b; letter-spacing: 8px; font-family: 'Courier New', monospace; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🛍️ Branding House</h1>
            <p>Email Verification</p>
          </div>
          <div class="content">
            <h2>Hello ${firstName}!</h2>
            <p>Thank you for registering with Branding House. Please use the OTP below to verify your email address:</p>
            
            <div class="otp-box">
              <p style="margin: 0; color: #666; font-size: 14px;">Your OTP Code:</p>
              <div class="otp-code">${otp}</div>
              <p style="margin: 10px 0 0 0; color: #666; font-size: 12px;">Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes</p>
            </div>
            
            <p><strong>⚠️ Important:</strong></p>
            <ul>
              <li>Do not share this OTP with anyone</li>
              <li>Our team will never ask for your OTP</li>
              <li>This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes</li>
            </ul>
            
            <p>If you didn't request this verification, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Branding House. All rights reserved.</p>
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    console.log(`📧 Sending OTP email to ${email}...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending OTP email:', error);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
};

/**
 * Send welcome email after email verification
 */
export const sendWelcomeEmail = async (email, firstName) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'Branding House <noreply@brandinghouse.com>',
    to: email,
    subject: 'Welcome to Branding House! 🎉',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #f59e0b; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to Branding House!</h1>
          </div>
          <div class="content">
            <h2>Hi ${firstName}!</h2>
            <p>Your email has been successfully verified. Welcome to the Branding House family!</p>
            <p>You can now enjoy:</p>
            <ul>
              <li>✅ Browse our exclusive collection</li>
              <li>✅ Fast and secure checkout</li>
              <li>✅ Order tracking</li>
              <li>✅ Special offers and discounts</li>
            </ul>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" class="button">Start Shopping</a>
            </div>
            <p>If you have any questions, feel free to contact our support team.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Branding House. All rights reserved.</p>
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    console.log(`📧 Sending welcome email to ${email}...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent: ${info.messageId}`);
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    // Don't throw error - welcome email is not critical
  }
};

// ============================================
// PASSWORD RESET EMAILS
// ============================================

/**
 * Send password reset email with secure token link
 */
export const sendPasswordResetEmail = async (email, firstName, resetToken) => {
  const transporter = createTransporter();
  
  // Create reset URL
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${resetToken}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'Branding House <noreply@brandinghouse.com>',
    to: email,
    subject: 'Password Reset Request - Branding House',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 14px 32px; background: #f59e0b; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
          .button:hover { background: #ea580c; }
          .warning-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Hello ${firstName},</h2>
            <p>We received a request to reset your password for your Branding House account.</p>
            
            <p>Click the button below to reset your password:</p>
            
            <div style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </div>
            
            <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
            <p style="background: white; padding: 10px; border-radius: 6px; word-break: break-all; font-size: 12px;">
              ${resetUrl}
            </p>
            
            <div class="warning-box">
              <p style="margin: 0;"><strong>⚠️ Security Notice:</strong></p>
              <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                <li>This link will expire in <strong>1 hour</strong></li>
                <li>If you didn't request this, please ignore this email</li>
                <li>Your password won't change until you create a new one</li>
                <li>Never share this link with anyone</li>
              </ul>
            </div>
            
            <p style="margin-top: 30px;">If you have any concerns about your account security, please contact our support team immediately.</p>
            
            <p style="color: #666; font-size: 14px;">Best regards,<br>The Branding House Team</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Branding House. All rights reserved.</p>
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    console.log(`📧 Sending password reset email to ${email}...`);
    console.log(`🔗 Reset URL: ${resetUrl}`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending password reset email:', error);
    console.error('Error details:', {
      code: error.code,
      command: error.command,
      response: error.response
    });
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }
};

/**
 * Send password reset confirmation email
 */
export const sendPasswordResetConfirmation = async (email, firstName) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'Branding House <noreply@brandinghouse.com>',
    to: email,
    subject: 'Password Changed Successfully - Branding House',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .success-icon { font-size: 48px; margin-bottom: 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #10b981; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="success-icon">✅</div>
            <h1>Password Changed Successfully</h1>
          </div>
          <div class="content">
            <h2>Hi ${firstName},</h2>
            <p>Your password has been changed successfully.</p>
            
            <p><strong>Details:</strong></p>
            <ul>
              <li>Changed at: ${new Date().toLocaleString()}</li>
              <li>Account: ${email}</li>
            </ul>
            
            <p><strong>⚠️ Didn't make this change?</strong></p>
            <p>If you didn't reset your password, please contact our support team immediately to secure your account.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" class="button">Login to Your Account</a>
            </div>
            
            <p style="color: #666; font-size: 14px;">Best regards,<br>The Branding House Team</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Branding House. All rights reserved.</p>
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    console.log(`📧 Sending password reset confirmation to ${email}...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset confirmation sent: ${info.messageId}`);
  } catch (error) {
    console.error('❌ Error sending confirmation email:', error);
    // Don't throw - confirmation email is not critical
  }
};