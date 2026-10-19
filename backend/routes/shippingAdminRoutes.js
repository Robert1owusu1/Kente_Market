// FILE LOCATION: backend/routes/shippingAdminRoutes.js
// DESCRIPTION: Admin control of delivery fees and exchange rates.
//   GET    /api/admin/shipping/rates               — platform default fee per country + carriers
//   PUT    /api/admin/shipping/rates/:countryCode  — set the platform default for a country
//   DELETE /api/admin/shipping/rates/:countryCode  — remove it (country becomes unavailable; never GH)
//   GET    /api/admin/shipping/exchange-rates      — current rate per currency, source, age
//   POST   /api/admin/shipping/exchange-rates/refresh — fetch today's rates now
// Sellers' own fees override the platform default for their products
// (routes/vendorRoutes.js /shipping/rates). Every change is audit-logged.
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  listShippingRates,
  listShippingCarriers,
  setStandardShippingRate,
  removeStandardShippingRate,
} from '../Services/shippingService.js';
import { getExchangeRateStatus, refreshExchangeRates } from '../Services/exchangeRateService.js';
import { auditFromRequest } from '../utils/auditLog.js';

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
