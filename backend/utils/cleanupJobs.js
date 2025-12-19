import pool from '../config/db.js';

// Delete unverified users older than 7 days
export const cleanupUnverifiedUsers = async () => {
  try {
    const [result] = await pool.execute(
      `DELETE FROM users 
       WHERE is_email_verified = false 
       AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    
    if (result.affectedRows > 0) {
      console.log(`🧹 Cleaned up ${result.affectedRows} unverified users`);
    }
  } catch (error) {
    console.error('❌ Cleanup job failed:', error);
  }
};

// Run cleanup daily
export const startCleanupSchedule = () => {
  // Run immediately on start
  cleanupUnverifiedUsers();
  
  // Run every 24 hours
  setInterval(cleanupUnverifiedUsers, 24 * 60 * 60 * 1000);
  
  console.log('✅ Cleanup scheduler started (runs every 24 hours)');
};