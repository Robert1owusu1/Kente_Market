// FILE LOCATION: utils/orderEmailService.js
// DESCRIPTION: Best-effort transactional emails for the order lifecycle —
//   payment receipt, fulfilment/progress updates (processing → shipped → …) and
//   escrow release. Every function is built on sendEmailSafely so a missing SMTP
//   credential or a transient send failure can never break the business request
//   that triggered it; in-app notifications remain the primary channel.

import pool from '../config/db.js';
import { sendEmailSafely } from './emailService.js';

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

const getOrder = async (orderId) => {
  const [rows] = await pool.execute(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  return rows.length > 0 ? rows[0] : null;
};

const getCustomer = async (userId) => {
  const [[row]] = await pool.execute(
    `SELECT email, firstName, lastName FROM users WHERE id = ?`,
    [userId]
  );
  return row || null;
};

const parseItems = (items) => {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try {
      return JSON.parse(items);
    } catch {
      return [];
    }
  }
  return [];
};

const formatMoney = (value) => `GH₵ ${(Number(value) || 0).toFixed(2)}`;

const renderItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return '<tr><td style="padding:10px;border-bottom:1px solid #eee;" colspan="3">No items</td></tr>';
  }
  return items
    .map((item, i) => {
      const qty = Number(item.qty ?? item.quantity ?? 1) || 1;
      const price = Number(item.price ?? 0) || 0;
      const title = item.name || item.title || `Item ${i + 1}`;
      const variant = item.selectedColor ? ` <span style="color:#666;">(${item.selectedColor})</span>` : '';
      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #eee;">${title}${variant}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">${qty}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;">${formatMoney(price * qty)}</td>
      </tr>`;
    })
    .join('');
};

const layout = (headline, bodyHtml) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Bonwire Kente</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; background: #f3f4f6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .header h1 { margin: 0; font-size: 22px; }
    .content { background: #fff; padding: 30px; border-radius: 0 0 10px 10px; }
    .card { background: #f9fafb; border: 1px solid #eee; border-radius: 8px; padding: 16px; margin: 16px 0; }
    table { width: 100%; border-collapse: collapse; }
    .button { display: inline-block; padding: 12px 30px; background: #f59e0b; color: white !important; text-decoration: none; border-radius: 6px; margin: 10px 0; font-weight: bold; }
    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    .muted { color: #666; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Bonwire Kente</h1>
      <p style="margin:8px 0 0;opacity:.9;">${headline}</p>
    </div>
    <div class="content">${bodyHtml}</div>
    <div class="footer">
      <p>Bonwire • Ashanti Region • Ghana</p>
      <p>© ${new Date().getFullYear()} Bonwire Kente. All rights reserved.</p>
      <p class="muted">This is an automated message. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>`;

const deliveryBlock = (order) => {
  const ship = order.shippingAddress && typeof order.shippingAddress === 'object'
    ? order.shippingAddress
    : {};
  const deliveryMethod = ship.deliveryMethod || 'home';
  if (deliveryMethod === 'pickup') {
    return `Pickup at: <strong>${ship.pickupStation || ship.city || 'your chosen pickup station'}</strong>`;
  }
  const name = `${ship.firstName || ''} ${ship.lastName || ''}`.trim();
  const lines = [name, ship.address, `${ship.city}${ship.region ? `, ${ship.region}` : ''}`, ship.phone].filter(Boolean);
  return lines.join('<br/>');
};

const totalsBlock = (order) => `
  <div class="card" style="margin-top:16px;">
    <table>
      <tr><td style="padding:4px 0;" class="muted">Subtotal</td><td style="padding:4px 0;text-align:right;">${formatMoney(order.totalAmount - (order.tax || 0) - (order.shippingCost || 0))}</td></tr>
      ${Number(order.shippingCost) ? `<tr><td style="padding:4px 0;" class="muted">Delivery</td><td style="padding:4px 0;text-align:right;">${formatMoney(order.shippingCost)}</td></tr>` : ''}
      ${Number(order.tax) ? `<tr><td style="padding:4px 0;" class="muted">Tax</td><td style="padding:4px 0;text-align:right;">${formatMoney(order.tax)}</td></tr>` : ''}
      ${Number(order.discount) ? `<tr><td style="padding:4px 0;" class="muted">Discount</td><td style="padding:4px 0;text-align:right;">− ${formatMoney(order.discount)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;font-weight:bold;border-top:2px solid #eee;">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:2px solid #eee;">${formatMoney(order.totalAmount)}</td></tr>
    </table>
  </div>`;

/**
 * Payment receipt — sent once when an order flips to paid (webhook, verify
 * fallback or admin mark-paid). Idempotency is handled by the caller: the email
 * only goes out from the branch that actually performed the flip.
 * @param {number | string} orderId
 */
export const sendOrderConfirmationEmail = async (orderId) => {
  const order = await getOrder(orderId);
  if (!order || !order.userId) return false;
  const customer = await getCustomer(order.userId);
  if (!customer?.email) return false;

  const items = parseItems(order.items);
  const orderUrl = `${frontendUrl()}/order/${order.id}`;
  const firstName = customer.firstName || customer.email;

  const html = layout('Order Confirmation', `
    <h2>Akwaaba, ${firstName}!</h2>
    <p>Thank you for your order. Your payment of <strong>${formatMoney(order.totalAmount)}</strong> has been received.</p>

    <div class="card">
      <p style="margin:0;"><strong>Order number:</strong> ${order.orderNumber}</p>
      <p style="margin:4px 0 0;"><strong>Payment method:</strong> ${order.paymentMethod || 'Card'}</p>
      <p style="margin:4px 0 0;"><strong>Estimated delivery:</strong> ${order.expectedCompletionDate ? new Date(order.expectedCompletionDate).toLocaleDateString() : 'Soon — we will keep you posted.'}</p>
    </div>

    <table>
      <thead><tr><th style="text-align:left;border-bottom:2px solid #eee;padding:6px;">Item</th><th style="border-bottom:2px solid #eee;padding:6px;">Qty</th><th style="text-align:right;border-bottom:2px solid #eee;padding:6px;">Price</th></tr></thead>
      <tbody>${renderItems(items)}</tbody>
    </table>
    ${totalsBlock(order)}

    <div class="card">
      <p style="margin:0;font-weight:bold;">Delivery details</p>
      <p style="margin:6px 0 0;">${deliveryBlock(order)}</p>
    </div>

    <div style="text-align:center;margin:24px 0;">
      <a href="${orderUrl}" class="button">Track Your Order</a>
    </div>
    <p class="muted">For custom-woven orders, our weavers start work right away — you will get progress updates as your piece moves through the loom. No refunds required; if anything isn't right, our marketplace escrow protects you until you confirm receipt.</p>
  `);

  return sendEmailSafely(customer.email, `Order Confirmation — ${order.orderNumber}`, html);
};

/**
 * Fulfilment progress update (processing → packaging → shipped → arrived →
 * delivered). The label below "shipped" reads "Your order is on its way".
 * @param {number | string} orderId
 * @param {{ statusLabel?: string, note?: string }} [fields]
 */
export const sendOrderStatusEmail = async (orderId, { statusLabel = 'updated', note = '' } = {}) => {
  const order = await getOrder(orderId);
  if (!order || !order.userId) return false;
  const customer = await getCustomer(order.userId);
  if (!customer?.email) return false;

  const orderUrl = `${frontendUrl()}/order/${order.id}`;
  const firstName = customer.firstName || customer.email;
  const friendly = statusLabel === 'shipped'
    ? 'your order is on its way 🎉'
    : `your order is now ${statusLabel}`;

  const html = layout(`Order Update: ${statusLabel}`, `
    <h2>Hello ${firstName},</h2>
    <p>Good news — <strong>${friendly}</strong>.</p>

    <div class="card">
      <p style="margin:0;"><strong>Order number:</strong> ${order.orderNumber}</p>
      <p style="margin:4px 0 0;"><strong>Status:</strong> ${statusLabel.charAt(0).toUpperCase()}${statusLabel.slice(1)}</p>
      ${note ? `<p style="margin:8px 0 0;" class="muted"><strong>Note from the seller:</strong> "${note}"</p>` : ''}
    </div>

    <div style="text-align:center;margin:24px 0;">
      <a href="${orderUrl}" class="button">View Order</a>
    </div>
    <p class="muted">Once delivered, confirm receipt in your account to release your payment to the weaver.</p>
  `);

  return sendEmailSafely(customer.email, `Order Update — ${order.orderNumber}: ${statusLabel.toLowerCase()}`, html);
};

/**
 * Escrow release — sent once the customer confirms receipt and the order's
 * escrowed funds move to the vendor.
 * @param {number | string} orderId
 */
export const sendEscrowReleasedEmail = async (orderId) => {
  const order = await getOrder(orderId);
  if (!order || !order.userId) return false;
  const customer = await getCustomer(order.userId);
  if (!customer?.email) return false;

  const orderUrl = `${frontendUrl()}/order/${order.id}`;
  const firstName = customer.firstName || customer.email;

  const html = layout('Receipt Confirmed', `
    <h2>Medaase, ${firstName}!</h2>
    <p>You confirmed receipt of order <strong>${order.orderNumber}</strong>. Your payment is now being released to the weaver, and the order is complete.</p>

    <div class="card">
      <p style="margin:0;"><strong>Order number:</strong> ${order.orderNumber}</p>
      <p style="margin:4px 0 0;"><strong>Status:</strong> Delivered &amp; confirmed</p>
    </div>

    <div style="text-align:center;margin:24px 0;">
      <a href="${orderUrl}" class="button">View Order</a>
    </div>
    <p class="muted">Thank you for supporting Bonwire weavers. Share your feedback or come back anytime for a new piece.</p>
  `);

  return sendEmailSafely(customer.email, `Receipt confirmed — ${order.orderNumber}`, html);
};