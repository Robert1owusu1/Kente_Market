import pool from '../config/db.js';
import { autoReleaseExpiredEscrows, recoverStuckPendingOrders } from '../Services/escrowService.js';
import Notification from '../models/notificationModel.js';
import { sendEmailSafely } from './emailService.js';
import { scanWishlistRestocks } from '../Services/wishlistRestockService.js';
import { scanWishlistPriceDrops } from '../Services/wishlistPriceDropService.js';
import { releaseExpiredReservations } from '../Services/reservationService.js';
import { sendWeeklyVendorDigest } from './marketInsights.js';
import {
  reconcileStuckTransfers,
  reclaimStaleProcessingWebhooks,
} from '../Services/transferReconciliationService.js';
import { reconcileAvailableAllocations } from '../Services/escrowService.js';
import { runScheduledJob } from './schedulerJob.js';

// Deactivate (not destroy) stale unverified users. Never hard-delete a user
// who has any financial footprint: orders cascade to escrow allocations under
// the current FK setup, so DELETE could destroy money history. Rows without any
// order/wallet footprint are removed outright; the rest are soft-deactivated.
export const cleanupUnverifiedUsers = async () => {
  try {
    const [result] = await pool.execute(
      `DELETE FROM users
       WHERE is_email_verified = false
         AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.userId = users.id)
         AND NOT EXISTS (SELECT 1 FROM wallet_transactions wt WHERE wt.vendorId = users.id)
         AND NOT EXISTS (SELECT 1 FROM vendor_wallets vw WHERE vw.vendorId = users.id)`
    );

    if (result.affectedRows > 0) {
      console.log(`🧹 Cleaned up ${result.affectedRows} unverified users (no financial footprint)`);
    }

    const [deactivated] = await pool.execute(
      `UPDATE users
       SET isActive = 0
       WHERE is_email_verified = false
         AND isActive = 1
         AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    if (deactivated.affectedRows > 0) {
      console.log(`🚫 Soft-deactivated ${deactivated.affectedRows} stale unverified users with financial data`);
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

// Abandoned cart recovery: email a signed-in user whose server cart has been
// untouched for RECOVERY_HOURS from the last time we reached out, so each cart
// is only re-targeted after a cooldown. Skips users who placed an order AFTER
// they last touched their cart (already converted). Best-effort — never blocks
// the scheduler and never resends twice for the same stint.
export const sendAbandonedCartEmails = async () => {
  try {
    const cooldownHours = Math.max(1, parseInt(process.env.CART_RECOVERY_COOLDOWN_HOURS || '72', 10));
    const [rows] = await pool.execute(
      `SELECT c.id AS cartId, c.items, c.updated_at, c.lastRecoveryEmailAt,
              u.id AS userId, u.email, u.firstName
       FROM carts c
       JOIN users u ON u.id = c.userId
       WHERE JSON_LENGTH(COALESCE(c.items, JSON_ARRAY())) > 0
         AND c.updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
         AND (c.lastRecoveryEmailAt IS NULL
              OR c.lastRecoveryEmailAt < DATE_SUB(NOW(), INTERVAL ? HOUR))
       LIMIT 25`,
      [cooldownHours]
    );

    let sent = 0;
    for (const row of rows) {
      try {
        // Skip users who converted (placed an order) after last touching the cart.
        const [[recentOrder]] = await pool.execute(
          `SELECT id FROM orders
           WHERE userId = ? AND created_at > ?
           ORDER BY created_at DESC LIMIT 1`,
          [row.userId, row.updated_at]
        );
        if (recentOrder) continue;

        let items = row.items;
        if (typeof items === 'string') {
          try { items = JSON.parse(items); } catch { items = []; }
        }
        const list = (Array.isArray(items) ? items : [])
          .map((it) => `<strong>${it.name || it.title || 'Item'}</strong> x${it.qty ?? it.quantity ?? 1}`)
          .slice(0, 6)
          .join('<br/>');
        if (!row.email) continue;

        const cartUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/cart`;
        const ok = await sendEmailSafely(
          row.email,
          `You left something beautiful in your cart, ${row.firstName || 'friend'} 🧶`,
          `<p>Hi ${row.firstName || 'there'},</p>
           <p>You still have these pieces waiting in your Bonwire Kente cart:</p>
           <p style="background:#f9fafb;border:1px solid #eee;border-radius:8px;padding:16px;">${list}</p>
           <p>Kente pieces are woven by hand and quantities are limited — once a pattern is sold it may take weeks to weave again.</p>
           <p style="text-align:center;margin:24px 0;"><a href="${cartUrl}" style="display:inline-block;padding:12px 30px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Return to my cart</a></p>
           <p style="color:#666;font-size:13px;">Determined to leave it this time? Reply to this email and we'll save the design for you — no pressure.</p>`
        );
        if (ok) {
          await pool.execute(
            `UPDATE carts SET lastRecoveryEmailAt = NOW() WHERE id = ?`,
            [row.cartId]
          );
          sent += 1;
        }
      } catch (rowErr) {
        console.warn(`⚠️ Abandoned-cart email failed for cart ${row.cartId}: ${rowErr.message}`);
      }
    }
    if (sent > 0) {
      console.log(`📧 Sent ${sent} abandoned-cart recovery email(s)`);
    }
  } catch (err) {
    console.error('⚠️ Abandoned-cart job failed:', err.message);
  }
};

// ============================================================
// SCHEDULER
// ============================================================
// Every job runs under a MySQL distributed lock (one replica executes it), is
// recorded in scheduler_job_status, and escalates failures to the admins
// (throttled once/day/job). If the lock infra is missing the job still runs,
// unlocked, so a not-yet-migrated deployment keeps working.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const scheduleJobs = () => {
  const run = (jobName, fn, intervalMs) => {
    runScheduledJob(jobName, fn).catch(() => {});
    setInterval(() => runScheduledJob(jobName, fn).catch(() => {}), intervalMs);
    return jobName;
  };

  run('cleanupUnverifiedUsers', cleanupUnverifiedUsers, 24 * HOUR);
  run('autoReleaseExpiredEscrows', autoReleaseExpiredEscrows, 2 * HOUR);
  run('recoverStuckPendingOrders', recoverStuckPendingOrders, 30 * 60 * 1000);
  run('releaseExpiredReservations', releaseExpiredReservations, 30 * 60 * 1000);
  run('escalateStaleCustomRequests', escalateStaleCustomRequests, HOUR);
  run('scanWishlistRestocks', scanWishlistRestocks, HOUR);
  run('scanWishlistPriceDrops', scanWishlistPriceDrops, HOUR);
  run('sendAbandonedCartEmails', sendAbandonedCartEmails, HOUR);
  run('reconcileStuckTransfers', reconcileStuckTransfers, 30 * 60 * 1000);
  run('reclaimStaleProcessingWebhooks', reclaimStaleProcessingWebhooks, 15 * 60 * 1000);
  run('reconcileAvailableAllocations', reconcileAvailableAllocations, 15 * 60 * 1000);
  // Weekly vendor demand digest (Monday mornings). Settings-guarded and
  // idempotent per calendar week; not fired on boot (that would email everyone).
  setTimeout(() => runScheduledJob('sendWeeklyVendorDigest', sendWeeklyVendorDigest).catch(() => {}), 7 * DAY);
  setInterval(() => runScheduledJob('sendWeeklyVendorDigest', sendWeeklyVendorDigest).catch(() => {}), 7 * DAY);

  console.log('✅ Cleanup scheduler started (users 24h, escrow 2h, stuck orders 30m, reservations 30m, SLA 1h, restock 1h, price-drop 1h, abandoned-cart 1h, transfers 30m, webhook reclaim 15m, digest weekly) — distributed lock + job status + failure alerts active');
};

export const startCleanupSchedule = () => {
  try {
    scheduleJobs();
  } catch (error) {
    console.error('❌ Failed to start scheduler:', error.message);
  }
};