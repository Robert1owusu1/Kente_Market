// FILE LOCATION: backend/controllers/planController.js
// DESCRIPTION: Admin plan management (Phase 2, Step 4). Admins set each plan's
//   price/commission/features and activate it. Activating a priced plan creates
//   (or updates) the matching Paystack Plan so vendors can subscribe to it.
import Plan from '../models/planModel.js';
import paystack from '../Services/paystackservices.js';
import Setting from '../models/settingModel.js';

const asBool = (v) => v === true || v === 'true';

// @desc    Read the plan-gate settings
// @route   GET /api/admin/plans/settings
// @access  Private/Admin
export const getPlanSettings = async (_req, res) => {
  try {
    const required = await Setting.get('vendorPlans.required');
    const bonwire = await Setting.get('vendorPlans.bonwireVerificationRequired');
    res.json({
      required: asBool(required),
      bonwireVerificationRequired: bonwire === null || bonwire === undefined ? true : asBool(bonwire),
    });
  } catch (error) {
    console.error('getPlanSettings error:', error.message);
    res.status(500).json({ message: 'Failed to load plan settings' });
  }
};

// @desc    Update the plan-gate settings
// @route   PUT /api/admin/plans/settings  { required?, bonwireVerificationRequired? }
// @access  Private/Admin
export const updatePlanSettings = async (req, res) => {
  try {
    const { required, bonwireVerificationRequired } = req.body || {};
    // Setting.update treats a 'boolean' type by truthiness — pass real booleans
    // (a string 'false' is truthy and would be stored as 'true').
    if (typeof required === 'boolean') {
      await Setting.update('vendorPlans.required', required, 'boolean');
    }
    if (typeof bonwireVerificationRequired === 'boolean') {
      await Setting.update('vendorPlans.bonwireVerificationRequired', bonwireVerificationRequired, 'boolean');
    }
    return getPlanSettings(req, res);
  } catch (error) {
    console.error('updatePlanSettings error:', error.message);
    res.status(500).json({ message: 'Failed to update plan settings' });
  }
};

// @desc    All plans (incl. drafts/inactive) for the admin
// @route   GET /api/admin/plans
// @access  Private/Admin
export const adminListPlans = async (_req, res) => {
  try {
    const plans = await Plan.findAll();
    res.json(plans);
  } catch (error) {
    console.error('adminListPlans error:', error.message);
    res.status(500).json({ message: 'Failed to load plans' });
  }
};

// @desc    Create a plan
// @route   POST /api/admin/plans
// @access  Private/Admin
export const adminCreatePlan = async (req, res) => {
  try {
    const { slug, name } = req.body || {};
    if (!slug || !name) return res.status(400).json({ message: 'slug and name are required' });
    const existing = await Plan.findBySlug(slug);
    if (existing) return res.status(409).json({ message: 'A plan with that slug already exists' });
    const plan = await Plan.create(req.body);
    res.status(201).json(plan);
  } catch (error) {
    console.error('adminCreatePlan error:', error.message);
    res.status(400).json({ message: error.message || 'Failed to create plan' });
  }
};

// @desc    Update a plan (price, commission, features, limits, visibility)
// @route   PUT /api/admin/plans/:id
// @access  Private/Admin
export const adminUpdatePlan = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    // Keep the Paystack plan's price in step when a live plan's price changes.
    const nextPrice = req.body.price !== undefined ? Number(req.body.price) : plan.price;
    if (plan.paystackPlanCode && req.body.price !== undefined && nextPrice !== plan.price && nextPrice > 0) {
      try { await paystack.updatePlan(plan.paystackPlanCode, { amount: nextPrice }); }
      catch (err) { console.warn(` Paystack plan price update failed: ${err.message}`); }
    }

    const updated = await Plan.update(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    console.error('adminUpdatePlan error:', error.message);
    res.status(400).json({ message: error.message || 'Failed to update plan' });
  }
};

// @desc    Activate / deactivate a plan. Activating creates the Paystack Plan.
// @route   PUT /api/admin/plans/:id/activate   { active: boolean }
// @access  Private/Admin
export const adminSetPlanActive = async (req, res) => {
  try {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') return res.status(400).json({ message: 'active (true/false) is required' });

    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    if (!active) {
      const updated = await Plan.update(req.params.id, { isActive: false });
      return res.json(updated);
    }

    // Activating: a plan needs a price before it can be sold.
    if (!(plan.price > 0)) {
      return res.status(400).json({ message: 'Set a price above 0 before activating this plan' });
    }

    // Ensure a Paystack Plan exists for recurring billing.
    let paystackPlanCode = plan.paystackPlanCode;
    if (!paystackPlanCode) {
      try {
        const resp = await paystack.createPlan(`Bonwire ${plan.name} (${plan.slug})`, plan.price, plan.billingInterval);
        paystackPlanCode = resp?.data?.plan_code || null;
      } catch (err) {
        return res.status(502).json({ message: `Could not create the Paystack plan: ${err.message}` });
      }
      if (!paystackPlanCode) {
        return res.status(502).json({ message: 'Paystack did not return a plan code' });
      }
    }

    const updated = await Plan.update(req.params.id, { isActive: true, paystackPlanCode });
    res.json(updated);
  } catch (error) {
    console.error('adminSetPlanActive error:', error.message);
    res.status(500).json({ message: error.message || 'Failed to activate plan' });
  }
};
