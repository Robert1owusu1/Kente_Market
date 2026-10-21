// FILE LOCATION: backend/routes/shippingAdminRoutes.js
// DESCRIPTION: Admin control of delivery fees and exchange rates.
//   GET    /api/admin/shipping/rates               — platform default fee per country + carriers
//   PUT    /api/admin/shipping/rates/:countryCode  — set the platform default for a country
//   DELETE /api/admin/shipping/rates/:countryCode  — remove it (country becomes unavailable; never GH)
//   GET    /api/admin/shipping/exchange-rates      — current rate per currency, source, age
//   POST   /api/admin/shipping/exchange-rates/refresh — fetch today's rates now
//   GET    /api/admin/shipping/sellers                — every seller and their own fees
//   PUT    /api/admin/shipping/sellers/:vendorId/rates/:countryCode — set a seller's fee
//   DELETE /api/admin/shipping/sellers/:vendorId/rates/:countryCode — remove it (platform default applies)
//   GET    /api/admin/shipping/hub                    — hub address + parcels the platform delivers
//   PUT    /api/admin/shipping/hub/address            — set the address sellers drop parcels at
//   POST   /api/admin/shipping/hub/:orderId/:vendorId/received — parcel arrived at the hub
// Moving a hub parcel on (shipped, arrived, delivered) uses the per-seller
// status endpoint: POST /api/vendors/orders/:id/status with { vendorId }.
// Sellers' own fees override the platform default for their products
// (routes/vendorRoutes.js /shipping/rates); the admin can see and change
// them here. Every change is audit-logged.
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  listShippingRates,
  listShippingCarriers,
  setStandardShippingRate,
  removeStandardShippingRate,
  listSellerShippingRates,
  sellerExists,
} from '../Services/shippingService.js';
import { getExchangeRateStatus, refreshExchangeRates } from '../Services/exchangeRateService.js';
import { auditFromRequest } from '../utils/auditLog.js';
import pool from '../config/db.js';
import Setting from '../models/settingModel.js';

const router = express.Router();

router.use(protect, admin);

router.get('/rates', async (_req, res) => {
  try {
    const [rates, carriers] = await Promise.all([listShippingRates(null), listShippingCarriers()]);
    res.json({ rates, carriers });
  } catch (error) {
    console.error('admin shipping rates:', error.message);
    res.status(500).json({ message: 'Failed to load delivery fees' });
  }
});

router.put('/rates/:countryCode', async (req, res) => {
  try {
    const code = String(req.params.countryCode || '').toUpperCase();
    const before = (await listShippingRates(null)).find((r) => r.countryCode === code) || null;
    const result = await setStandardShippingRate(null, code, req.body || {});
    if (!result.ok) return res.status(400).json({ message: result.message });
    await auditFromRequest(req, { action: 'shipping_rate.set', entityType: 'shipping_rate', entityId: code, before, after: result.rate });
    res.json({ message: 'Platform delivery fee saved', rate: result.rate });
  } catch (error) {
    console.error('admin set shipping rate:', error.message);
    res.status(500).json({ message: 'Failed to save delivery fee' });
  }
});

router.delete('/rates/:countryCode', async (req, res) => {
  try {
    const code = String(req.params.countryCode || '').toUpperCase();
    if (code === 'GH') {
      return res.status(400).json({ message: 'Ghana needs a platform delivery fee; change it instead of removing it' });
    }
    const before = (await listShippingRates(null)).find((r) => r.countryCode === code) || null;
    const removed = await removeStandardShippingRate(null, code);
    if (!removed) return res.status(404).json({ message: 'No platform fee set for this country' });
    await auditFromRequest(req, { action: 'shipping_rate.remove', entityType: 'shipping_rate', entityId: code, before, after: null });
    res.json({ message: 'Platform delivery fee removed; this country is unavailable except for sellers with their own fee' });
  } catch (error) {
    console.error('admin remove shipping rate:', error.message);
    res.status(500).json({ message: 'Failed to remove delivery fee' });
  }
});

// :vendorId is the seller's user id (shipping_rates.vendorId).
const sellerId = (req) => {
  const id = Number(req.params.vendorId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

router.get('/sellers', async (_req, res) => {
  try {
    const [sellers, platformDefaults, carriers] = await Promise.all([
      listSellerShippingRates(), listShippingRates(null), listShippingCarriers(),
    ]);
    res.json({ sellers, platformDefaults, carriers });
  } catch (error) {
    console.error('admin seller shipping rates:', error.message);
    res.status(500).json({ message: "Failed to load sellers' delivery fees" });
  }
});

router.put('/sellers/:vendorId/rates/:countryCode', async (req, res) => {
  try {
    const vendorId = sellerId(req);
    if (!vendorId || !(await sellerExists(vendorId))) return res.status(404).json({ message: 'Seller not found' });
    const code = String(req.params.countryCode || '').toUpperCase();
    const before = (await listShippingRates(vendorId)).find((r) => r.countryCode === code) || null;
    const result = await setStandardShippingRate(vendorId, code, req.body || {});
    if (!result.ok) return res.status(400).json({ message: result.message });
    await auditFromRequest(req, { action: 'seller_shipping_rate.set', entityType: 'shipping_rate', entityId: `${vendorId}:${code}`, before, after: result.rate });
    res.json({ message: "Seller's delivery fee saved", rate: result.rate });
  } catch (error) {
    console.error('admin set seller shipping rate:', error.message);
    res.status(500).json({ message: 'Failed to save delivery fee' });
  }
});

router.delete('/sellers/:vendorId/rates/:countryCode', async (req, res) => {
  try {
    const vendorId = sellerId(req);
    if (!vendorId || !(await sellerExists(vendorId))) return res.status(404).json({ message: 'Seller not found' });
    const code = String(req.params.countryCode || '').toUpperCase();
    const before = (await listShippingRates(vendorId)).find((r) => r.countryCode === code) || null;
    const removed = await removeStandardShippingRate(vendorId, code);
    if (!removed) return res.status(404).json({ message: 'This seller has no fee of their own for this country' });
    await auditFromRequest(req, { action: 'seller_shipping_rate.remove', entityType: 'shipping_rate', entityId: `${vendorId}:${code}`, before, after: null });
    res.json({ message: "Seller's fee removed; the platform default applies" });
  } catch (error) {
    console.error('admin remove seller shipping rate:', error.message);
    res.status(500).json({ message: 'Failed to remove delivery fee' });
  }
});

const HUB_ADDRESS_KEY = 'delivery.hubAddress';

router.get('/hub', async (req, res) => {
  try {
    // open = not yet delivered to the customer; all = include delivered.
    const showAll = req.query.state === 'all';
    const [rows] = await pool.execute(
      `SELECT p.orderId, p.vendorId, p.shippingFee, p.handedOverAt, p.hubReceivedAt,
              o.orderNumber, o.orderStatus, o.shippingAddress, o.created_at,
              v.businessName, v.contactPhone,
              COALESCE(m.status, 'processing') AS parcelStatus, m.trackingNumber
         FROM order_delivery_parts p
         JOIN orders o ON o.id = p.orderId
         LEFT JOIN vendors v ON v.userId = p.vendorId
         LEFT JOIN order_vendor_marks m ON m.orderId = p.orderId AND m.vendorId = p.vendorId
        WHERE p.deliveredBy = 'platform'
          AND o.paymentStatus = 'paid'
          AND o.orderStatus NOT IN ('cancelled', 'refunded')
          ${showAll ? '' : "AND COALESCE(m.status, 'processing') <> 'delivered'"}
        ORDER BY p.handedOverAt IS NULL, p.handedOverAt, o.created_at
        LIMIT 500`
    );
    const parcels = /** @type {any[]} */ (rows).map((r) => {
      let addr = r.shippingAddress;
      if (typeof addr === 'string') { try { addr = JSON.parse(addr); } catch { addr = {}; } }
      addr = addr || {};
      return {
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        orderStatus: r.orderStatus,
        placedAt: r.created_at,
        vendorId: r.vendorId,
        sellerName: r.businessName || `Seller #${r.vendorId}`,
        sellerPhone: r.contactPhone || null,
        shippingFee: Number(r.shippingFee) || 0,
        handedOverAt: r.handedOverAt,
        hubReceivedAt: r.hubReceivedAt,
        parcelStatus: r.parcelStatus,
        trackingNumber: r.trackingNumber || null,
        destination: {
          recipient: addr.fullName || [addr.firstName, addr.lastName].filter(Boolean).join(' ') || null,
          address: addr.address || addr.street || null,
          city: addr.city || null,
          region: addr.region || addr.state || null,
          postalCode: addr.postalCode || addr.zipCode || addr.zip || null,
          country: addr.country || null,
          phone: addr.phone || null,
          deliveryMethod: addr.deliveryMethod || null,
          pickupStation: addr.pickupStation || null,
        },
      };
    });
    res.json({ hubAddress: (await Setting.get(HUB_ADDRESS_KEY)) || '', parcels });
  } catch (error) {
    console.error('admin hub parcels:', error.message);
    res.status(500).json({ message: 'Failed to load hub parcels' });
  }
});

router.put('/hub/address', async (req, res) => {
  try {
    const address = String(req.body?.hubAddress ?? '').trim();
    if (address.length < 5 || address.length > 500) {
      return res.status(400).json({ message: 'Enter the hub address sellers should bring parcels to (5-500 characters)' });
    }
    const before = await Setting.get(HUB_ADDRESS_KEY);
    await Setting.update(HUB_ADDRESS_KEY, address, 'string');
    await auditFromRequest(req, { action: 'delivery_hub.address', entityType: 'setting', entityId: HUB_ADDRESS_KEY, before, after: address });
    res.json({ message: 'Hub address saved', hubAddress: address });
  } catch (error) {
    console.error('admin hub address:', error.message);
    res.status(500).json({ message: 'Failed to save the hub address' });
  }
});

router.post('/hub/:orderId/:vendorId/received', async (req, res) => {
  try {
    const orderId = Number(req.params.orderId);
    const vendorId = sellerId(req);
    if (!Number.isSafeInteger(orderId) || orderId <= 0 || !vendorId) {
      return res.status(400).json({ message: 'Invalid parcel' });
    }
    const [result] = /** @type {[any, any]} */ (await pool.execute(
      `UPDATE order_delivery_parts SET hubReceivedAt = NOW(),
              handedOverAt = COALESCE(handedOverAt, NOW())
        WHERE orderId = ? AND vendorId = ? AND deliveredBy = 'platform' AND hubReceivedAt IS NULL`,
      [orderId, vendorId]
    ));
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'No parcel waiting at the hub for this order and seller' });
    }
    await auditFromRequest(req, { action: 'delivery_hub.received', entityType: 'order', entityId: `${orderId}:${vendorId}`, after: { received: true } });
    res.json({ message: 'Parcel received at the hub' });
  } catch (error) {
    console.error('admin hub received:', error.message);
    res.status(500).json({ message: 'Failed to record the parcel' });
  }
});

router.get('/exchange-rates', async (_req, res) => {
  try {
    res.json({ rates: await getExchangeRateStatus() });
  } catch (error) {
    console.error('admin exchange rates:', error.message);
    res.status(500).json({ message: 'Failed to load exchange rates' });
  }
});

router.post('/exchange-rates/refresh', async (req, res) => {
  try {
    const result = await refreshExchangeRates({ force: true });
    await auditFromRequest(req, { action: 'exchange_rates.refresh', entityType: 'exchange_rates', entityId: 'GHS', after: result });
    res.json({ ...result, rates: await getExchangeRateStatus() });
  } catch (error) {
    console.error('admin refresh exchange rates:', error.message);
    res.status(502).json({ message: 'Could not fetch exchange rates right now; the previous rates are still in use' });
  }
});

export default router;
