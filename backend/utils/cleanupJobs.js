import pool from '../config/db.js';
import { autoReleaseExpiredEscrows, recoverStuckPendingOrders } from '../Services/escrowService.js';

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
  autoReleaseExpiredEscrows();
  recoverStuckPendingOrders();
  
  // Run every 24 hours
  setInterval(cleanupUnverifiedUsers, 24 * 60 * 60 * 1000);

  // Auto-release expired escrow every 2 hours
  setInterval(autoReleaseExpiredEscrows, 2 * 60 * 60 * 1000);

  // Recover orders stuck in pending (payment reference exists but webhook + fallback both missed)
  setInterval(recoverStuckPendingOrders, 30 * 60 * 1000);
  
  console.log('✅ Cleanup scheduler started (users 24h, escrow 2h, stuck orders 30m)');
};