// FILE LOCATION: controllers/settingController.js
// DESCRIPTION: Controller functions for settings API endpoints

import Setting from '../models/settingModel.js';
import { clearCache } from '../midleware/cacheMiddleware.js';

// @desc    Get all settings
// @route   GET /api/settings
// @access  Private/Admin
export const getSettings = async (req, res) => {
  try {
    const settings = await Setting.getAll();
    
    // Map database keys back to frontend-friendly keys
    const frontendSettings = {
      siteName: settings.site_name || '',
      email: settings.admin_email || '',
      currency: settings.currency || 'USD',
      taxRate: settings.tax_rate || 0,
      shippingCost: settings.shipping_cost || 0,
      notifications: settings.notifications_enabled || false,
      emailNotifications: settings.email_notifications || false,
      orderAlerts: settings.order_alerts || false,
      lowStockAlert: settings.low_stock_threshold || 10,
      theme: settings.theme || 'light'
    };
    
    res.json(frontendSettings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
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
      currency: { key: 'currency', type: 'string' },
      taxRate: { key: 'tax_rate', type: 'number' },
      shippingCost: { key: 'shipping_cost', type: 'number' },
      notifications: { key: 'notifications_enabled', type: 'boolean' },
      emailNotifications: { key: 'email_notifications', type: 'boolean' },
      orderAlerts: { key: 'order_alerts', type: 'boolean' },
      lowStockAlert: { key: 'low_stock_threshold', type: 'number' },
      theme: { key: 'theme', type: 'string' }
    };

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

    // Get updated settings to return
    const updatedSettings = await Setting.getAll();
    const frontendSettings = {
      siteName: updatedSettings.site_name || '',
      email: updatedSettings.admin_email || '',
      currency: updatedSettings.currency || 'USD',
      taxRate: updatedSettings.tax_rate || 0,
      shippingCost: updatedSettings.shipping_cost || 0,
      notifications: updatedSettings.notifications_enabled || false,
      emailNotifications: updatedSettings.email_notifications || false,
      orderAlerts: updatedSettings.order_alerts || false,
      lowStockAlert: updatedSettings.low_stock_threshold || 10,
      theme: updatedSettings.theme || 'light'
    };

    res.json({ 
      message: 'Settings updated successfully',
      settings: frontendSettings
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete setting
// @route   DELETE /api/settings/:key
// @access  Private/Admin
export const deleteSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const deleted = await Setting.delete(key);

    if (!deleted) {
      return res.status(404).json({ message: 'Setting not found' });
    }

    // Clear cache
    clearCache('settings');

    res.json({ message: 'Setting deleted successfully' });
  } catch (error) {
    console.error('Error deleting setting:', error);
    res.status(500).json({ message: error.message });
  }
};