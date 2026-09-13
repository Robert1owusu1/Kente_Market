import pool from '../config/db.js';
import { autoReleaseExpiredEscrows, recoverStuckPendingOrders } from '../Services/escrowService.js';
import Notification from '../models/notificationModel.js';
import { sendEmailSafely } from './emailService.js';
import { scanWishlistRestocks } from '../Services/wishlistRestockService.js';
import { scanWishlistPriceDrops } from '../Services/wishlistPriceDropService.js';
import { sendWeeklyVendorDigest } from './marketInsights.js';

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

// Escalate stale custom requests that have been pending for over 48 hours.
// Sends a notification to the customer, vendor and admin, plus best-effort email
// to the customer. Idempotent: each request is escalated at most once per
// pending stint (guarded by sla_notified_at).
export const escalateStaleCustomRequests = async () => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.customerId, r.vendorId, r.created_at,
              c.email AS customerEmail, c.firstName AS customerFirstName,
              v.businessName AS vendorBusinessName,
              CONCAT(c.firstName, ' ', c.lastName) AS customerName
       FROM custom_requests r
       LEFT JOIN users c ON c.id = r.customerId
       LEFT JOIN vendors v ON v.userId = r.vendorId
       WHERE r.status = 'pending'
         AND r.sla_notified_at IS NULL
         AND r.created_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)`
    );

    for (const row of rows) {
      try {
        const created = row.created_at ? new Date(row.created_at) : new Date();
        const hoursStale = Math.round((Date.now() - created.getTime()) / 3600000);

        // 1) Customer — "vendor hasn't responded yet"
        await Notification.create({
          userId: row.customerId,
          type: 'system',
          title: 'Your custom request needs attention',
          message: `It's been ${hoursStale} hours since you submitted your custom Kente request to ${row.vendorBusinessName || 'your vendor'}. We're following up on your behalf.`,
          link: '/custom-requests',
        });
        if (row.customerEmail) {
          await sendEmailSafely(
            row.customerEmail,
            `Your Bonwire Kente custom request — following up`,
            `<p>Hi ${row.customerFirstName || ''},</p><p>Your custom Kente request submitted ${hoursStale} hours ago to <strong>${row.vendorBusinessName || 'your vendor'}</strong> is still awaiting a quote.</p><p>We're reaching out to the vendor. You can also cancel or contact support if you'd prefer to try another weaver.</p>`
          );
        }

        // 2) Vendor — nudge to respond
        await Notification.create({
          userId: row.vendorId,
          type: 'system',
          title: 'New custom request waiting 48+ hours',
          message: `Customer ${row.customerName || ''} has been waiting over 48 hours for a quote. Please respond promptly to keep your vendor rating healthy.`,
          link: '/vendor/custom-requests',
        });

        // 3) Admin — badge + dashboard visibility
        const [adminUsers] = await pool.execute(
          `SELECT id FROM users WHERE role = 'admin' LIMIT 5`
        );
        for (const admin of adminUsers) {
          await Notification.create({
            userId: admin.id,
            type: 'system',
            title: 'Custom request SLA overdue',
            message: `Request #${row.id} (${row.customerName} -> ${row.vendorBusinessName || 'N/A'}) has been pending for ${hoursStale}h.`,
            link: '/admin/custom-requests',
          });
        }

        await pool.execute(
          `UPDATE custom_requests SET sla_notified_at = NOW() WHERE id = ?`,
          [row.id]
        );
      } catch (notifyErr) {
        console.warn(`⚠️ SLA escalation failed for request ${row.id}: ${notifyErr.message}`);
      }
    }
    if (rows.length > 0) {
      console.log(`⏰ Escalated ${rows.length} stale custom request(s) (>48h pending)`);
    }
  } catch (err) {
    console.error('⚠️ SLA escalation job failed:', err.message);
  }
};

// Run cleanup daily
export const startCleanupSchedule = () => {
  // Run immediately on start
  cleanupUnverifiedUsers();
  autoReleaseExpiredEscrows();
  recoverStuckPendingOrders();
  escalateStaleCustomRequests();
  scanWishlistRestocks();
  scanWishlistPriceDrops();

  // Run every 24 hours
  setInterval(cleanupUnverifiedUsers, 24 * 60 * 60 * 1000);

  // Auto-release expired escrow every 2 hours
  setInterval(autoReleaseExpiredEscrows, 2 * 60 * 60 * 1000);

  // Recover orders stuck in pending (payment reference exists but webhook + fallback both missed)
  setInterval(recoverStuckPendingOrders, 30 * 60 * 1000);

  // Escalate custom requests pending > 48 hours (notifications to all parties)
  setInterval(escalateStaleCustomRequests, 1 * 60 * 60 * 1000);

  // Back-in-stock alerts for wishlisted items (safety-net sweep)
  setInterval(scanWishlistRestocks, 1 * 60 * 60 * 1000);

  // Price-drop alerts for wishlisted items (safety-net sweep)
  setInterval(scanWishlistPriceDrops, 1 * 60 * 60 * 1000);

  // Weekly vendor demand digest (Monday mornings). Not fired on boot — the
  // settings-guarded job is idempotent per calendar week anyway.
  setInterval(() => {
    sendWeeklyVendorDigest().catch((err) => console.error('⚠️ Weekly digest job failed:', err.message));
  }, 7 * 24 * 60 * 60 * 1000);

  console.log('✅ Cleanup scheduler started (users 24h, escrow 2h, stuck orders 30m, SLA 1h, restock 1h, price-drop 1h, digest weekly)');
};