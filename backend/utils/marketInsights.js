// FILE LOCATION: backend/utils/marketInsights.js
// DESCRIPTION: Shared demand-prediction logic ("what kente is selling") used by
//              the admin insights endpoint, vendor dashboard digest, and the
//              weekly vendor demand digest job. Also hosts the weekly vendor
//              digest that turns this into actionable notifications.
import pool from '../config/db.js';
import Notification from '../models/notificationModel.js';
import { sendEmailSafely } from './emailService.js';

const parseItems = (v) =>
  typeof v === 'string'
    ? (() => { try { return JSON.parse(v); } catch { return []; } })()
    : Array.isArray(v) ? v : [];

/**
 * Aggregate live order history into category/product demand signals.
 * Pure function of the orders table (no product_sales_daily dependency yet),
 * capped at the 2000 most recent non-cancelled orders.
 * @param {number} [limit]
 * @returns {Promise<{ totalRevenue: number, totalQty: number, topTypes: Array<Record<string, unknown>>, topProducts: Array<Record<string, unknown>> }>}
 */
export const computeTopProductTypes = async (limit = 8) => {
  const connection = await pool.getConnection();
  try {
    const [catalogRows] = await connection.query(
      `SELECT id, category, title, patternName, yards FROM product`
    );
    const catalog = new Map(catalogRows.map((p) => [String(p.id), p]));

    const [orders] = await connection.execute(
      `SELECT id, items, created_at
       FROM orders
       WHERE orderStatus != 'cancelled'
       ORDER BY created_at DESC
       LIMIT 2000`
    );

    const byCategory = new Map();
    const byProduct = new Map();
    let totalRevenue = 0;
    let totalQty = 0;

    orders.forEach((order) => {
      const items = parseItems(order.items);
      items.forEach((item) => {
        const pid = String(item.product || item.productId || item.id || '');
        const name = item.title || item.name || 'Unknown Kente';
        const category = item.category || (catalog.has(pid) && catalog.get(pid).category) || 'Uncategorised';
        const qty = item.qty || item.quantity || 1;
        const revenue = (item.price || 0) * qty;
        totalRevenue += revenue;
        totalQty += qty;

        if (!byCategory.has(category)) {
          byCategory.set(category, { category, quantity: 0, revenue: 0, products: new Set() });
        }
        const c = byCategory.get(category);
        c.quantity += qty;
        c.revenue += revenue;
        if (pid) c.products.add(pid);

        if (!byProduct.has(pid)) {
          byProduct.set(pid, {
            productId: pid,
            name,
            category,
            patternName: catalog.has(pid) ? catalog.get(pid).patternName : null,
            quantity: 0,
            revenue: 0,
          });
        }
        const p = byProduct.get(pid);
        p.quantity += qty;
        p.revenue += revenue;
      });
    });

    const sortValues = (map) => [...map.values()].sort((a, b) => b.revenue - a.revenue);
    const safeLimit = Math.max(1, Math.min(parseInt(limit) || 8, 50));

    // Cancellation rate per type — count items that fell through (incl. the
    // ones excluded from the revenue pass above).
    const [cancelledOrders] = await connection.execute(
      `SELECT id, items FROM orders WHERE orderStatus = 'cancelled'
       ORDER BY created_at DESC LIMIT 2000`
    );
    const cancelledQtyByCategory = new Map();
    cancelledOrders.forEach((order) => {
      const items = parseItems(order.items);
      items.forEach((item) => {
        const pid = String(item.product || item.productId || item.id || '');
        const category = item.category || (catalog.has(pid) && catalog.get(pid).category) || 'Uncategorised';
        const qty = item.qty || item.quantity || 1;
        cancelledQtyByCategory.set(category, (cancelledQtyByCategory.get(category) || 0) + qty);
      });
    });

    // Production days per type — how long it actually takes to deliver (avg of
    // expected completion vs order placement on delivered custom-ish orders).
    const [deliveredRows] = await connection.execute(
      `SELECT items, created_at, expectedCompletionDate FROM orders
       WHERE orderStatus = 'delivered' AND expectedCompletionDate IS NOT NULL
       ORDER BY created_at DESC LIMIT 2000`
    );
    const daysByCategory = new Map();
    deliveredRows.forEach((order) => {
      const placed = order.created_at && new Date(order.created_at).getTime();
      const done = order.expectedCompletionDate && new Date(order.expectedCompletionDate).getTime();
      if (!placed || !done || done <= placed) return;
      const items = parseItems(order.items);
      items.forEach((item) => {
        const pid = String(item.product || item.productId || item.id || '');
        const category = item.category || (catalog.has(pid) && catalog.get(pid).category) || 'Uncategorised';
        const days = Math.round((done - placed) / 86400000);
        const e = daysByCategory.get(category) || { days: 0, count: 0 };
        e.days += days;
        e.count += 1;
        daysByCategory.set(category, e);
      });
    });

    return {
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalQty,
      topTypes: sortValues(byCategory).slice(0, safeLimit).map((c) => {
        const cancelledQty = cancelledQtyByCategory.get(c.category) || 0;
        const totalQtyAll = c.quantity + cancelledQty;
        const prod = daysByCategory.get(c.category);
        return {
          category: c.category,
          quantity: c.quantity,
          revenue: parseFloat(c.revenue.toFixed(2)),
          productCount: c.products.size,
          share: totalRevenue > 0 ? parseFloat(((c.revenue / totalRevenue) * 100).toFixed(1)) : 0,
          avgProductionDays: prod && prod.count > 0 ? parseFloat((prod.days / prod.count).toFixed(1)) : null,
          cancellationRate: totalQtyAll > 0 ? parseFloat(((cancelledQty / totalQtyAll) * 100).toFixed(1)) : 0,
        };
      }),
      topProducts: sortValues(byProduct).slice(0, safeLimit),
    };
  } finally {
    connection.release();
  }
};

/**
 * Send the weekly demand digest to every approved vendor (in-app notification
 * + best-effort email). Guarded by settings.vendor_digest_last_week so it fires
 * at most once per calendar week even across multiple server instances.
 * @returns {Promise<number>} number of vendors notified
 */
export const sendWeeklyVendorDigest = async () => {
  try {
  const [weekRows] = await pool.execute(
    `SELECT settingValue FROM settings WHERE settingKey = 'vendor_digest_last_week'`
  );
  const lastWeek = weekRows.length > 0 ? parseInt(weekRows[0].settingValue) || 0 : 0;
  const now = new Date();
  const isoWeek = Math.floor(Date.UTC(now.getUTCFullYear(), 0, now.getUTCDate()) / 604800000);
  if (lastWeek === isoWeek) return 0; // already sent this week
  if (lastWeek > isoWeek) return 0; // clock moved backwards — stay idempotent

  const { topTypes } = await computeTopProductTypes(3);

  const [vendors] = await pool.execute(
    `SELECT v.userId, v.businessName, u.email AS contactEmail
     FROM vendors v
     LEFT JOIN users u ON u.id = v.userId
     WHERE v.status = 'approved'`
  );

  let notified = 0;
  for (const vendor of vendors) {
    try {
      const topLine = topTypes
        .slice(0, 3)
        .map((t, i) => `${i + 1}. ${t.category} — GHS ${t.revenue.toFixed(0)} (${t.share}% of sales)`)
        .join('\n');
      await Notification.create({
        userId: vendor.userId,
        type: 'system',
        title: 'Weekly demand digest 📈',
        message: `Here's what buyers are asking for this week:\n${topLine}\n\nPrepare stock for the hot patterns while lead times are calm.`,
        link: '/vendor/insights',
      });
      const email = vendor.contactEmail || vendor.email;
      if (email) {
        await sendEmailSafely(
          email,
          `${vendor.businessName} — this week's Kente demand digest`,
          `<p>Hi ${vendor.businessName},</p><p>This week's top-selling Kente types across Bonwire Kente:</p><ul>${topTypes
            .slice(0, 3)
            .map((t) => `<li><strong>${t.category}</strong> — GHS ${t.revenue.toFixed(0)} (${t.share}% of sales)</li>`)
            .join('')}</ul><p>Plan your weaving accordingly.</p>`
        );
      }
      notified += 1;
    } catch (err) {
      console.warn(`⚠️ Vendor digest failed for ${vendor.userId}: ${err.message}`);
    }
  }

  await pool.execute(
    `INSERT INTO settings (settingKey, settingValue, settingType)
     VALUES ('vendor_digest_last_week', ?, 'int')
     ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
    [String(isoWeek)]
  );
  if (notified > 0) console.log(`📈 Weekly vendor demand digest sent to ${notified} vendor(s)`);
  return notified;
  } catch (err) {
    console.error('⚠️ Weekly vendor digest job failed:', err.message);
    return 0;
  }
};