// models/userModel.js - COMPLETE VERSION WITH PASSWORD RESET
import pool from '../config/db.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

class User {
  constructor(data) {
    this.id = data.id;
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.email = data.email;
    this.password = data.password;
    this.phone = data.phone;
    this.address = data.address;
    this.city = data.city;
    this.state = data.state;
    this.zipCode = data.zipCode;
    this.country = data.country;
    this.role = data.role || 'customer';
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.isEmailVerified = data.isEmailVerified || data.is_email_verified || false;
    this.profilePicture = data.profileImage || data.profile_picture || data.profilePicture || null;
    this.resetPasswordToken = data.reset_password_token || null;
    this.resetPasswordExpire = data.reset_password_expire || null;
    this.lastLogin = data.last_login || null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  // Input validation and sanitization
  static validateUserInput(userData, isUpdate = false) {
    const errors = [];
    
    if (!isUpdate) {
      if (!userData.firstName || typeof userData.firstName !== 'string' || userData.firstName.trim().length < 1) {
        errors.push('First name is required');
      }
      
      if (!userData.lastName || typeof userData.lastName !== 'string') {
        errors.push('Last name is required');
      }
      
      if (!userData.email || typeof userData.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
        errors.push('Valid email is required');
      }
      
      if (!userData.password || typeof userData.password !== 'string' || userData.password.length < 8) {
        errors.push('Password must be at least 8 characters');
      }
    }

    if (userData.firstName && userData.firstName.trim().length > 50) {
      errors.push('First name must be less than 50 characters');
    }
    
    if (userData.lastName && userData.lastName.trim().length > 50) {
      errors.push('Last name must be less than 50 characters');
    }
    
    if (userData.email && userData.email.length > 255) {
      errors.push('Email must be less than 255 characters');
    }
    
    if (userData.phone && (typeof userData.phone !== 'string' || userData.phone.length > 20)) {
      errors.push('Phone number must be less than 20 characters');
    }

    return errors;
  }

  // Sanitize user input
  static sanitizeUserData(userData) {
    const sanitized = {};
    
    if (userData.firstName) sanitized.firstName = userData.firstName.trim();
    if (userData.lastName) sanitized.lastName = userData.lastName.trim();
    if (userData.email) sanitized.email = userData.email.toLowerCase().trim();
    if (userData.password) sanitized.password = userData.password;
    if (userData.phone) sanitized.phone = userData.phone.trim();
    if (userData.address) sanitized.address = userData.address.trim();
    if (userData.city) sanitized.city = userData.city.trim();
    if (userData.state) sanitized.state = userData.state.trim();
    if (userData.zipCode) sanitized.zipCode = userData.zipCode.trim();
    if (userData.country) sanitized.country = userData.country.trim();
    if (userData.isActive !== undefined) sanitized.isActive = Boolean(userData.isActive);
    if (userData.role) sanitized.role = userData.role.trim();

    return sanitized;
  }

  // Get all users
  static async findAll(options = {}) {
    let connection;
    try {
      connection = await pool.getConnection();
      
      const { 
        limit = 100, 
        offset = 0, 
        role = null, 
        isActive = null,
        search = null 
      } = options;

      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 1000));
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      let query = 'SELECT id, firstName, lastName, email, phone, address, city, state, zipCode, country, role, isActive, is_email_verified, profile_picture, last_login, created_at, updated_at FROM users WHERE 1=1';
      const params = [];

      if (role) {
        query += ' AND role = ?';
        params.push(role);
      }

      if (isActive !== null) {
        query += ' AND isActive = ?';
        params.push(isActive ? 1 : 0);
      }

      if (search) {
        query += ' AND (firstName LIKE ? OR lastName LIKE ? OR email LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      query += ` ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

      const [rows] = params.length > 0 
        ? await connection.execute(query, params)
        : await connection.query(query);
      
      return rows.map(row => {
        const user = new User(row);
        delete user.password;
        return user;
      });

    } catch (error) {
      console.error('Error in findAll:', error.message);
      throw new Error(`Error fetching users: ${error.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // Get user by ID
  static async findById(id) {
    let connection;
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid user ID');
      }

      connection = await pool.getConnection();
      
      const [rows] = await connection.execute(
        'SELECT id, firstName, lastName, email, phone, address, city, state, zipCode, country, role, isActive, is_email_verified, profile_picture, last_login, created_at, updated_at FROM users WHERE id = ?', 
        [parseInt(id)]
      );
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);

    } catch (error) {
      console.error('Error in findById:', error.message);
      throw new Error(`Error fetching user: ${error.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // Get user by email (includes password for authentication)
  static async findByEmail(email) {
    let connection;
    try {
      if (!email || typeof email !== 'string') {
        throw new Error('Invalid email');
      }

      connection = await pool.getConnection();
      
      const sanitizedEmail = email.toLowerCase().trim();
      const [rows] = await connection.execute(
        'SELECT * FROM users WHERE email = ?', 
        [sanitizedEmail]
      );
      
      return rows.length ? new User(rows[0]) : null;

    } catch (error) {
      console.error('Error in findByEmail:', error.message);
      throw new Error(`Error fetching user by email: ${error.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // Check if email exists
  static async emailExists(email) {
    let connection;
    try {
      connection = await pool.getConnection();
      
      const sanitizedEmail = email.toLowerCase().trim();
      const [rows] = await connection.execute(
        'SELECT COUNT(*) as count FROM users WHERE email = ?', 
        [sanitizedEmail]
      );
      
      return rows[0].count > 0;

    } catch (error) {
      console.error('Error in emailExists:', error.message);
      throw new Error(`Error checking email existence: ${error.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // Create new user
  static async create(userData) {
    let connection;
    try {
      const validationErrors = User.validateUserInput(userData);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      const sanitizedData = User.sanitizeUserData(userData);

      connection = await pool.getConnection();

      const emailExists = await User.emailExists(sanitizedData.email);
      if (emailExists) {
        throw new Error('Email already exists');
      }

      const hashedPassword = await bcrypt.hash(sanitizedData.password, 12);

      const requiredFields = {
        firstName: sanitizedData.firstName,
        lastName: sanitizedData.lastName,
        email: sanitizedData.email,
        password: hashedPassword,
        role: sanitizedData.role || 'customer',
        isActive: sanitizedData.isActive !== undefined ? sanitizedData.isActive : true
      };

      const optionalFields = {};
      ['phone', 'address', 'city', 'state', 'zipCode', 'country'].forEach(field => {
        if (sanitizedData[field] && sanitizedData[field].trim() !== '') {
          optionalFields[field] = sanitizedData[field];
        }
      });

      const allFields = { ...requiredFields, ...optionalFields };
      
      const fieldNames = Object.keys(allFields);
      const placeholders = fieldNames.map(() => '?').join(', ');
      const fieldValues = Object.values(allFields);

      const [result] = await connection.execute(`
        INSERT INTO users (${fieldNames.join(', ')}) 
        VALUES (${placeholders})
      `, fieldValues);

      console.log('User created successfully with ID:', result.insertId);
      return await User.findById(result.insertId);

    } catch (error) {
      console.error('Error in create:', error.message);
      
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('Email already exists');
      }
      if (error.code === 'ER_DATA_TOO_LONG') {
        throw new Error('Input data exceeds maximum length');
      }
      if (error.code === 'ER_BAD_NULL_ERROR') {
        throw new Error('Required field is missing');
      }
      
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // Update user
  static async update(id, updateData) {
    let connection;
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid user ID');
      }

      const validationErrors = User.validateUserInput(updateData, true);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      connection = await pool.getConnection();

      const sanitizedData = User.sanitizeUserData(updateData);

      if (sanitizedData.email) {
        const existingUser = await User.findByEmail(sanitizedData.email);
        if (existingUser && existingUser.id !== parseInt(id)) {
          throw new Error('Email already exists');
        }
      }

      const setClause = [];
      const values = [];

      Object.keys(sanitizedData).forEach(key => {
        if (sanitizedData[key] !== undefined && key !== 'password') {
          setClause.push(`${key} = ?`);
          values.push(sanitizedData[key]);
        }
      });

      if (sanitizedData.password) {
        const hashedPassword = await bcrypt.hash(sanitizedData.password, 12);
        setClause.push('password = ?');
        values.push(hashedPassword);
      }

      if (setClause.length === 0) {
        throw new Error("No valid fields provided for update");
      }

      setClause.push('updated_at = CURRENT_TIMESTAMP');
      values.push(parseInt(id));

      await connection.execute(
        `UPDATE users SET ${setClause.join(', ')} WHERE id = ?`,
        values
      );

      console.log('User updated successfully:', id);
      return await User.findById(id);

    } catch (error) {
      console.error('Error in update:', error.message);
      
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('Email already exists');
      }
      
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // Soft delete user
  static async softDelete(id) {
    let connection;
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid user ID');
      }

      connection = await pool.getConnection();

      const [result] = await connection.execute(
        'UPDATE users SET isActive = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
        [parseInt(id)]
      );
      
      console.log('User soft deleted:', id);
      return result.affectedRows > 0;

    } catch (error) {
      console.error('Error in softDelete:', error.message);
      throw new Error(`Error deactivating user: ${error.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // Hard delete user
  static async delete(id) {
    let connection;
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid user ID');
      }

      connection = await pool.getConnection();

      const [result] = await connection.execute(
        'DELETE FROM users WHERE id = ?', 
        [parseInt(id)]
      );
      
      console.log('User permanently deleted:', id);
      return result.affectedRows > 0;

    } catch (error) {
      console.error('Error in delete:', error.message);
      throw new Error(`Error deleting user: ${error.message}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // Compare password
  async comparePassword(candidatePassword) {
    try {
      if (!candidatePassword || !this.password) {
        return false;
      }
      return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
      console.error('Error comparing password:', error.message);
      return false;
    }
  }

  // Authenticate user
  static async authenticate(email, password) {
    try {
      if (!email || !password) {
        return null;
      }

      const user = await User.findByEmail(email);
      if (!user || !user.isActive) {
        return null;
      }

      const isMatch = await user.comparePassword(password);
      return isMatch ? user : null;
    } catch (error) {
      console.error('Error in authenticate:', error.message);
      return null;
    }
  }

  // ============================================
  // EMAIL VERIFICATION METHODS
  // ============================================

  // Set email verification token
  static async setVerificationToken(userId, token, expiry) {
    let connection;
    try {
      connection = await pool.getConnection();
      
      const [result] = await connection.execute(
        `UPDATE users 
         SET email_verification_token = ?, 
             email_verification_expires = ?,
             verification_attempts = 0,
             last_verification_attempt = NOW()
         WHERE id = ?`,
        [token, expiry, userId]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error setting verification token:', error);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // Verify email with OTP
  static async verifyEmail(userId, otp) {
    let connection;
    try {
      connection = await pool.getConnection();
      
      const [rows] = await connection.execute(
        `SELECT * FROM users 
         WHERE id = ? 
         AND email_verification_token = ? 
         AND email_verification_expires > NOW()
         AND verification_attempts < ?`,
        [userId, otp, parseInt(process.env.MAX_OTP_ATTEMPTS) || 5]
      );

      if (rows.length === 0) {
        await connection.execute(
          `UPDATE users 
           SET verification_attempts = verification_attempts + 1 
           WHERE id = ?`,
          [userId]
        );
        return null;
      }

      await connection.execute(
        `UPDATE users 
         SET is_email_verified = TRUE,
             email_verification_token = NULL,
             email_verification_expires = NULL,
             verification_attempts = 0
         WHERE id = ?`,
        [userId]
      );

      return rows[0];
    } catch (error) {
      console.error('Error verifying email:', error);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // Check if email is verified
  static async isEmailVerified(userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      
      const [rows] = await connection.execute(
        'SELECT is_email_verified FROM users WHERE id = ?',
        [userId]
      );
      return rows.length > 0 && rows[0].is_email_verified;
    } catch (error) {
      console.error('Error checking email verification:', error);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // Get verification attempts
  static async getVerificationAttempts(userId) {
    let connection;
    try {
      connection = await pool.getConnection();
      
      const [rows] = await connection.execute(
        'SELECT verification_attempts, last_verification_attempt FROM users WHERE id = ?',
        [userId]
      );
      return rows[0] || { verification_attempts: 0, last_verification_attempt: null };
    } catch (error) {
      console.error('Error getting verification attempts:', error);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // ============================================
  // PASSWORD RESET METHODS
  // ============================================

  /**
   * Generate password reset token
   * @param {number} userId - User ID
   * @returns {string} Plain text reset token
   */
  static async createPasswordResetToken(userId) {
    let connection;
    try {
      // Generate random token (32 bytes = 64 hex characters)
      const resetToken = crypto.randomBytes(32).toString('hex');

      // Hash token before storing (security best practice)
      const hashedToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

      // Token expires in 1 hour
      const expireTime = new Date(Date.now() + 60 * 60 * 1000);

      connection = await pool.getConnection();

      await connection.execute(
        `UPDATE users 
         SET reset_password_token = ?,
             reset_password_expire = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [hashedToken, expireTime, userId]
      );

      console.log(`✅ Password reset token created for user ${userId}`);
      
      // Return plain text token (to be sent in email)
      return resetToken;
    } catch (error) {
      console.error('❌ Error creating reset token:', error);
      throw new Error('Failed to create password reset token');
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Find user by reset token
   * @param {string} resetToken - Plain text reset token
   * @returns {User|null}
   */
  static async findByResetToken(resetToken) {
    let connection;
    try {
      // Hash the token to match database
      const hashedToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

      connection = await pool.getConnection();

      const [rows] = await connection.execute(
        `SELECT * FROM users 
         WHERE reset_password_token = ? 
         AND reset_password_expire > NOW()
         AND isActive = 1`,
        [hashedToken]
      );

      if (rows.length === 0) {
        return null;
      }

      return new User(rows[0]);
    } catch (error) {
      console.error('❌ Error finding user by reset token:', error);
      throw new Error('Invalid or expired reset token');
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Reset user password
   * @param {number} userId 
   * @param {string} newPassword 
   */
  static async resetPassword(userId, newPassword) {
    let connection;
    try {
      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `UPDATE users 
         SET password = ?,
             reset_password_token = NULL,
             reset_password_expire = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [hashedPassword, userId]
      );

      if (result.affectedRows === 0) {
        throw new Error('User not found');
      }

      console.log(`✅ Password reset successful for user ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ Error resetting password:', error);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Clear password reset token
   * @param {number} userId 
   */
  static async clearResetToken(userId) {
    let connection;
    try {
      connection = await pool.getConnection();

      await connection.execute(
        `UPDATE users 
         SET reset_password_token = NULL,
             reset_password_expire = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [userId]
      );

      console.log(`✅ Reset token cleared for user ${userId}`);
    } catch (error) {
      console.error('❌ Error clearing reset token:', error);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // ============================================
  // PROFILE PICTURE METHODS
  // ============================================

  // Update user profile picture
  static async updateProfilePicture(userId, profilePicturePath) {
    let connection;
    try {
      if (!userId || isNaN(userId)) {
        throw new Error('Invalid user ID');
      }

      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `UPDATE users 
         SET profile_picture = ?, 
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [profilePicturePath, parseInt(userId)]
      );

      if (result.affectedRows === 0) {
        throw new Error('User not found');
      }

      console.log(`✅ Profile picture updated for user ${userId}`);
      
      const updatedUser = await this.findById(userId);
      return updatedUser;
    } catch (error) {
      console.error('Error updating profile picture:', error);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // Get user's profile picture URL
  static async getProfilePicture(userId) {
    let connection;
    try {
      if (!userId || isNaN(userId)) {
        throw new Error('Invalid user ID');
      }

      connection = await pool.getConnection();

      const [rows] = await connection.execute(
        'SELECT profile_picture FROM users WHERE id = ?',
        [parseInt(userId)]
      );

      if (rows.length === 0) {
        return null;
      }

      return rows[0].profile_picture;
    } catch (error) {
      console.error('Error getting profile picture:', error);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  // Get user profile without password
  getProfile() {
    const profile = { ...this };
    delete profile.password;
    delete profile.resetPasswordToken;
    delete profile.resetPasswordExpire;
    return profile;
  }

  // Update last login
  async updateLastLogin() {
    let connection;
    try {
      connection = await pool.getConnection();
      
      await connection.execute(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [this.id]
      );
    } catch (error) {
      console.error('Error updating last login:', error.message);
    } finally {
      if (connection) connection.release();
    }
  }
}

export default User;