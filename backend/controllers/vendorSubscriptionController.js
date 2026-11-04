// FILE LOCATION: backend/controllers/vendorSubscriptionController.js
// DESCRIPTION: Vendor-facing plan selection + pay-for-plan (Phase 2, Step 4).
import Plan from '../models/planModel.js';
import VendorSubscription from '../models/vendorSubscriptionModel.js';
import { startSubscription, cancelSubscription } from '../Services/vendorSubscriptionService.js';

// @desc    Plans a vendor may subscribe to (active + public)
// @route   GET /api/vendors/plans
// @access  Private (vendor)
export const getSelectablePlans = async (_req, res) => {
  try {
    const plans = await Plan.selectable();
    res.json(plans.map((p) => p.toPublic()));
  } catch (error) {
    console.error('getSelectablePlans error:', error.message);
    res.status(500).json({ message: 'Failed to load plans' });
  }
};

// @desc    The vendor's current subscription (for the portal gate)
// @route   GET /api/vendors/subscription
// @access  Private (vendor)
export const getMySubscription = async (req, res) => {
  try {
    const sub = await VendorSubscription.findCurrent(req.user.id);
    res.json({ subscription: sub, active: !!sub });
  } catch (error) {
    console.error('getMySubscription error:', error.message);
    res.status(500).json({ message: 'Failed to load subscription' });
  }
};

// @desc    Start checkout for a plan → returns Paystack authorization URL
// @route   POST /api/vendors/subscribe   { planId }
// @access  Private (vendor)
export const subscribeToPlan = async (req, res) => {
  try {
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ message: 'planId is required' });
    const result = await startSubscription(req.user.id, planId);
    res.status(201).json(result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('subscribeToPlan error:', error.message);
    res.status(status).json({ message: error.message || 'Failed to start subscription' });
  }
};

// @desc    Cancel the vendor's current subscription
// @route   DELETE /api/vendors/subscription
// @access  Private (vendor)
export const cancelMySubscription = async (req, res) => {
  try {
    const sub = await cancelSubscription(req.user.id);
    res.json({ message: 'Subscription cancelled', subscription: sub });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('cancelMySubscription error:', error.message);
    res.status(status).json({ message: error.message || 'Failed to cancel subscription' });
  }
};
