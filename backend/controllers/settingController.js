// FILE LOCATION: controllers/settingController.js
// DESCRIPTION: Controller functions for settings API endpoints

import Setting from '../models/settingModel.js';
import { clearCache } from '../middleware/cacheMiddleware.js';
import { auditFromRequest } from '../utils/auditLog.js';
import { getVatRate, clearPricingConfigCache } from '../Services/pricingConfig.js';

// Money settings are real values or nothing: the form shows what is stored
// (null when unset) instead of an invented default. Delivery fees live in
// Admin -> Shipping & FX and the charge currency is fixed (GHS), so neither is
// a setting here. Keys that pricing depends on cannot be deleted.
const PROTECTED_KEYS = new Set(['tax_rate', 'referral.minWithdrawal']);

/** @param {Record<string, any>} settings */
const toFrontend = (settings) => ({
  siteName: settings.site_name || '',
  email: settings.admin_email || '',
  currency: 'GHS',
  taxRate: settings.tax_rate === undefined || settings.tax_rate === null || settings.tax_rate === '' ? null : Number(settings.tax_rate),
  notifications: settings.notifications_enabled || false,
  emailNotifications: settings.email_notifications || false,
  orderAlerts: settings.order_alerts || false,
  lowStockAlert: settings.low_stock_threshold || 10,
  theme: settings.theme || 'light'
});

// @desc    VAT rate for storefront price estimates (the server re-prices every order)
// @route   GET /api/settings/public/pricing
// @access  Public
export const getPublicPricing = async (_req, res) => {
  try {
    res.json({ vatRate: await getVatRate(), currency: 'GHS' });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.publicMessage || 'Pricing unavailable' });
  }
};

// @desc    Get all settings
// @route   GET /api/settings
// @access  Private/Admin
export const getSettings = async (req, res) => {
  try {
    const settings = await Setting.getAll();
    res.json(toFrontend(settings));
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get single setting by key
// @route   GET /api/settings/:key
// @access  Private/Admin
export const getSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const value = await Setting.get(key);
    
    if (value === null) {
      return res.status(404).json({ message: 'Setting not found' });
    }

    res.json({ [key]: value });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Update settings
// @route   PUT /api/settings
// @access  Private/Admin
export const updateSettings = async (req, res) => {
  try {
    const settings = req.body;

    if (!settings || Object.keys(settings).length === 0) {
      return res.status(400).json({ message: 'No settings provided' });
    }

    // Map frontend keys to database keys with their types
    const settingsMap = {
      siteName: { key: 'site_name', type: 'string' },
      email: { key: 'admin_email', type: 'string' },
      taxRate: { key: 'tax_rate', type: 'number' },
      notifications: { key: 'notifications_enabled', type: 'boolean' },
      emailNotifications: { key: 'email_notifications', type: 'boolean' },
      orderAlerts: { key: 'order_alerts', type: 'boolean' },
      lowStockAlert: { key: 'low_stock_threshold', type: 'number' },
      theme: { key: 'theme', type: 'string' }
    };

    if (settings.taxRate !== undefined) {
      const pct = Number(settings.taxRate);
      if (settings.taxRate === null || settings.taxRate === '' || !Number.isFinite(pct) || pct < 0 || pct > 50) {
        return res.status(400).json({ message: 'VAT rate must be a percentage between 0 and 50' });
      }
    }

    const dbSettings = {};
    for (const [frontendKey, value] of Object.entries(settings)) {
      const mapping = settingsMap[frontendKey];
      if (mapping) {
        dbSettings[mapping.key] = { value, type: mapping.type };
      }
    }

    await Setting.updateMany(dbSettings);

    // Clear cache after updating settings
    clearCache('settings');
    clearPricingConfigCache();

    // Get updated settings to return
    const frontendSettings = toFrontend(await Setting.getAll());

    res.json({ 
      message: 'Settings updated successfully',
      settings: frontendSettings
    });

    await auditFromRequest(req, {
      action: 'settings.update',
      entityType: 'setting',
      entityId: null,
      after: { keys: Object.keys(dbSettings), values: dbSettings },
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Delete setting
// @route   DELETE /api/settings/:key
// @access  Private/Admin
export const deleteSetting = async (req, res) => {
  try {
    const { key } = req.params;
    if (PROTECTED_KEYS.has(key)) {
      return res.status(400).json({ message: 'This setting is required for pricing and cannot be deleted; change its value instead' });
    }
    const deleted = await Setting.delete(key);

    if (!deleted) {
      return res.status(404).json({ message: 'Setting not found' });
    }

    // Clear cache
    clearCache('settings');

    res.json({ message: 'Setting deleted successfully' });
  } catch (error) {
    console.error('Error deleting setting:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};