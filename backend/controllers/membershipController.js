// FILE LOCATION: backend/controllers/membershipController.js
// DESCRIPTION: Kente Club API (Phase 3, Step 10) — customer subscribe/cancel +
//   admin tier management (mirrors planController).
import pool from '../config/db.js';
import MembershipPlan from '../models/membershipPlanModel.js';
import Membership from '../models/membershipModel.js';
import paystack from '../Services/paystackservices.js';
import { startMembership, cancelMembership } from '../Services/membershipService.js';

const userEmail = async (userId) => {
  const [[u]] = await pool.execute(`SELECT email FROM users WHERE id = ?`, [userId]);
  return u?.email || null;
};

// --- Customer ------------------------------------------------------------

// @desc  GET /api/kente-club/tiers — tiers a customer can join
export const getMembershipTiers = async (_req, res) => {
  try {
    const plans = await MembershipPlan.selectable();
    res.json(plans.map((p) => p.toPublic()));
  } catch (e) { console.error('getMembershipTiers error:', e.message); res.status(500).json({ message: 'Failed to load memberships' }); }
};

// @desc  GET /api/kente-club/me — current membership
export const getMyMembership = async (req, res) => {
  try {
    const m = await Membership.findCurrent(req.user.id);
    res.json({ membership: m, active: !!m, discountPercent: m ? m.discountPercentAtSubscribe : 0 });
  } catch (e) { console.error('getMyMembership error:', e.message); res.status(500).json({ message: 'Failed to load membership' }); }
};

// @desc  POST /api/kente-club/subscribe  { planId } → Paystack URL
export const subscribeToMembership = async (req, res) => {
  try {
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ message: 'planId is required' });
    const result = await startMembership({ userId: req.user.id, email: await userEmail(req.user.id), planId });
    res.status(201).json(result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('subscribeToMembership error:', error.message);
    res.status(status).json({ message: error.message || 'Failed to start membership' });
  }
};

// @desc  DELETE /api/kente-club/me — cancel membership
export const cancelMyMembership = async (req, res) => {
  try {
    const m = await cancelMembership(req.user.id);
    res.json({ message: 'Membership cancelled', membership: m });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('cancelMyMembership error:', error.message);
    res.status(status).json({ message: error.message || 'Failed to cancel membership' });
  }
};

// --- Admin ---------------------------------------------------------------

// @desc  GET /api/admin/kente-club/plans
export const adminListMembershipPlans = async (_req, res) => {
  try { res.json(await MembershipPlan.findAll()); }
  catch (e) { console.error('adminListMembershipPlans error:', e.message); res.status(500).json({ message: 'Failed to load membership plans' }); }
};

// @desc  POST /api/admin/kente-club/plans
export const adminCreateMembershipPlan = async (req, res) => {
  try {
    const { slug, name } = req.body || {};
    if (!slug || !name) return res.status(400).json({ message: 'slug and name are required' });
    if (await MembershipPlan.findBySlug(slug)) return res.status(409).json({ message: 'A tier with that slug already exists' });
    res.status(201).json(await MembershipPlan.create(req.body));
  } catch (e) { console.error('adminCreateMembershipPlan error:', e.message); res.status(400).json({ message: e.message || 'Failed to create tier' }); }
};

// @desc  PUT /api/admin/kente-club/plans/:id
export const adminUpdateMembershipPlan = async (req, res) => {
  try {
    const plan = await MembershipPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Tier not found' });
    if (plan.paystackPlanCode && req.body.price !== undefined && Number(req.body.price) !== plan.price && Number(req.body.price) > 0) {
      try { await paystack.updatePlan(plan.paystackPlanCode, { amount: Number(req.body.price) }); }
      catch (err) { console.warn(` Paystack plan price update failed: ${err.message}`); }
    }
    res.json(await MembershipPlan.update(req.params.id, req.body));
  } catch (e) { console.error('adminUpdateMembershipPlan error:', e.message); res.status(400).json({ message: e.message || 'Failed to update tier' }); }
};

// @desc  PUT /api/admin/kente-club/plans/:id/activate  { active }
export const adminSetMembershipActive = async (req, res) => {
  try {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') return res.status(400).json({ message: 'active (true/false) is required' });
    const plan = await MembershipPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Tier not found' });
    if (!active) return res.json(await MembershipPlan.update(req.params.id, { isActive: false }));
    if (!(plan.price > 0)) return res.status(400).json({ message: 'Set a price above 0 before activating this tier' });

    let paystackPlanCode = plan.paystackPlanCode;
    if (!paystackPlanCode) {
      try {
        const resp = await paystack.createPlan(`Kente Club ${plan.name} (${plan.slug})`, plan.price, plan.billingInterval);
        paystackPlanCode = resp?.data?.plan_code || null;
      } catch (err) { return res.status(502).json({ message: `Could not create the Paystack plan: ${err.message}` }); }
      if (!paystackPlanCode) return res.status(502).json({ message: 'Paystack did not return a plan code' });
    }
    res.json(await MembershipPlan.update(req.params.id, { isActive: true, paystackPlanCode }));
  } catch (e) { console.error('adminSetMembershipActive error:', e.message); res.status(500).json({ message: e.message || 'Failed to activate tier' }); }
};
