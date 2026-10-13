// @ts-check
// FILE LOCATION: backend/utils/adminAlerts.js
// DESCRIPTION: One in-app alert fan-out for operator-facing financial/recovery
//              events. Replaces copies of `SELECT id FROM users WHERE role =
//              'admin' LIMIT 5` that (a) picked an arbitrary five admins (no
//              ORDER BY — a different set per query plan), and (b) dropped the
//              alert without a trace when no admin account existed.
import pool from '../config/db.js';
import Notification from '../models/notificationModel.js';

/** Upper bound on recipients so a large admin table never fans out unbounded. */
const MAX_ADMIN_RECIPIENTS = 5;

/**
 * Notify the platform admins in-app. Best-effort: never throws. When there is
 * nobody to notify (or the notify fails), the alert still reaches the logs at
 * error level so it is visible in the log drain / Sentry.
 * @param {string} title
 * @param {string} message
 * @param {{ link?: string, type?: string }} [opts]
 * @returns {Promise<number>} number of admins notified
 */
export const notifyAdmins = async (title, message, { link = '/admin/orders', type = 'system' } = {}) => {
  try {
    const [admins] = /** @type {any} */ (await pool.execute(
      `SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT ${MAX_ADMIN_RECIPIENTS}`
    ));
    if (admins.length === 0) {
      console.error(`ADMIN ALERT (no admin account to notify): ${title} — ${message}`);
      return 0;
    }
    for (const admin of admins) {
      await Notification.create({ userId: admin.id, type, title, message, link });
    }
    return admins.length;
  } catch (err) {
    console.error(`ADMIN ALERT (notification failed: ${err?.message}): ${title} — ${message}`);
    return 0;
  }
};

export default notifyAdmins;
