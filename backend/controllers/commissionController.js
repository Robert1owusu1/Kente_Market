// FILE LOCATION: backend/controllers/commissionController.js
// DESCRIPTION: Admin CRUD for the configurable commission engine. Rules are
//              scoped global / category / vendor / product and resolved by
//              specificity (product > vendor > category > global).
//
//              Effect of a change: rules are read when an order's escrow is
//              allocated (checkout, or a pre-payment coupon re-allocation). The
//              resulting fee is frozen on the allocation row, so a change never
//              rewrites existing orders or vendor balances — it applies to orders
//              allocated after it.
import pool from '../config/db.js';
import { auditFromRequest } from '../utils/auditLog.js';

const VALID_SCOPES = ['global', 'category', 'vendor', 'product'];
const MAX_RATE = 0.5;

const toRule = (r) => (r ? { ...r, rate: parseFloat(r.rate) } : r);

/**
 * Strict rate parsing: a number or plain decimal string, 0..0.5, at most 4
 * decimal places (the column is DECIMAL(5,4) — more precision would be
 * silently rounded). "0.1abc", "", [0.1], "1e-1" are rejected.
 * @returns {number | null}
 */
export const parseRate = (raw) => {
  let text;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim();
  } else {
    return null;
  }
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
  const n = Number(text);
  return n >= 0 && n <= MAX_RATE ? n : null;
};

/**
 * Validate a scope/target pair and normalise the target. Vendor and product
 * targets must exist; a category target must be a known category name (either
 * in `categories` or used by a product), otherwise the rule could never match.
 * @returns {Promise<{ ok: true, targetId: string | null } | { ok: false, message: string }>}
 */
const validateTarget = async (scope, rawTarget) => {
  if (!VALID_SCOPES.includes(scope)) {
    return { ok: false, message: `Scope must be one of: ${VALID_SCOPES.join(', ')}` };
  }
  if (scope === 'global') return { ok: true, targetId: null };

  const target = rawTarget === undefined || rawTarget === null ? '' : String(rawTarget).trim();
  if (!target) return { ok: false, message: 'A target is required for non-global rules' };

  if (scope === 'vendor' || scope === 'product') {
    if (!/^[1-9]\d{0,9}$/.test(target)) {
      return { ok: false, message: `${scope === 'vendor' ? 'Vendor' : 'Product'} target must be a valid id` };
    }
    const [rows] = scope === 'vendor'
      ? await pool.execute(`SELECT userId FROM vendors WHERE userId = ? LIMIT 1`, [target])
      : await pool.execute(`SELECT id FROM product WHERE id = ? LIMIT 1`, [target]);
    if (rows.length === 0) {
      return { ok: false, message: `${scope === 'vendor' ? 'Vendor' : 'Product'} ${target} not found` };
    }
    return { ok: true, targetId: target };
  }

  // category
  if (target.length > 100) return { ok: false, message: 'Category name is too long' };
  const [[known]] = await pool.execute(
    `SELECT (EXISTS (SELECT 1 FROM categories WHERE name = ?)
          OR EXISTS (SELECT 1 FROM product WHERE category = ?)) AS found`,
    [target, target]
  );
  if (!Number(known?.found)) return { ok: false, message: `Unknown category "${target}"` };
  return { ok: true, targetId: target };
};

const parsePriority = (raw) => {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isInteger(n) && Math.abs(n) <= 1000 ? n : null;
};

// @desc    List commission rules
// @route   GET /api/admin/commissions
// @access  Private/Admin
export const listCommissionRules = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM commission_rules ORDER BY
         CASE scope WHEN 'global' THEN 3 WHEN 'category' THEN 2 WHEN 'vendor' THEN 1 WHEN 'product' THEN 0 END,
         priority DESC, id DESC`
    );
    res.json(rows.map(toRule));
  } catch (error) {
    console.error('Error listing commission rules:', error);
    res.status(500).json({ message: 'Failed to list commission rules' });
  }
};

// @desc    Create a commission rule
// @route   POST /api/admin/commissions
// @access  Private/Admin
export const createCommissionRule = async (req, res) => {
  try {
    const { scope, targetId, rate, priority } = req.body || {};
    const rateNum = parseRate(rate);
    if (rateNum === null) {
      return res.status(400).json({ message: 'Rate must be a decimal between 0 and 0.5 (0%–50%), at most 4 decimal places' });
    }
    const prio = parsePriority(priority);
    if (prio === null) return res.status(400).json({ message: 'Priority must be an integer' });
    const target = await validateTarget(scope, targetId);
    if (!target.ok) return res.status(400).json({ message: target.message });

    const [result] = await pool.execute(
      `INSERT INTO commission_rules (scope, targetId, rate, priority, isActive)
       VALUES (?, ?, ?, ?, true)`,
      [scope, target.targetId, rateNum, prio]
    );
    const [[created]] = await pool.execute(`SELECT * FROM commission_rules WHERE id = ?`, [result.insertId]);
    await auditFromRequest(req, { action: 'commission.create', entityType: 'commission', entityId: result.insertId, after: toRule(created) });
    res.status(201).json({ message: 'Commission rule created', rule: toRule(created) });
  } catch (error) {
    console.error('Error creating commission rule:', error);
    res.status(500).json({ message: 'Failed to create commission rule' });
  }
};

// @desc    Update a commission rule
// @route   PUT /api/admin/commissions/:id
// @access  Private/Admin
export const updateCommissionRule = async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);
    const [[existing]] = await pool.execute(`SELECT * FROM commission_rules WHERE id = ?`, [ruleId]);
    if (!existing) return res.status(404).json({ message: 'Commission rule not found' });

    const { rate, priority, isActive, scope, targetId } = req.body || {};
    const sets = [];
    const vals = [];

    if (rate !== undefined) {
      const rateNum = parseRate(rate);
      if (rateNum === null) {
        return res.status(400).json({ message: 'Rate must be a decimal between 0 and 0.5 (0%–50%), at most 4 decimal places' });
      }
      sets.push('rate = ?'); vals.push(rateNum);
    }
    if (priority !== undefined) {
      const prio = parsePriority(priority);
      if (prio === null) return res.status(400).json({ message: 'Priority must be an integer' });
      sets.push('priority = ?'); vals.push(prio);
    }
    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean' && isActive !== 0 && isActive !== 1) {
        return res.status(400).json({ message: 'isActive must be a boolean' });
      }
      sets.push('isActive = ?'); vals.push(isActive ? 1 : 0);
    }
    if (scope !== undefined || targetId !== undefined) {
      // Scope and target are validated together, so a rule can never end up
      // as e.g. a product rule pointing at a category name.
      const nextScope = scope !== undefined ? scope : existing.scope;
      const nextTarget = targetId !== undefined ? targetId : existing.targetId;
      const target = await validateTarget(nextScope, nextTarget);
      if (!target.ok) return res.status(400).json({ message: target.message });
      sets.push('scope = ?', 'targetId = ?'); vals.push(nextScope, target.targetId);
    }

    if (sets.length === 0) return res.status(400).json({ message: 'No fields to update' });
    vals.push(ruleId);
    await pool.execute(`UPDATE commission_rules SET ${sets.join(', ')} WHERE id = ?`, vals);

    const [[updated]] = await pool.execute(`SELECT * FROM commission_rules WHERE id = ?`, [ruleId]);
    await auditFromRequest(req, { action: 'commission.update', entityType: 'commission', entityId: ruleId, before: toRule(existing), after: toRule(updated) });
    res.json({ message: 'Commission rule updated', rule: toRule(updated) });
  } catch (error) {
    console.error('Error updating commission rule:', error);
    res.status(500).json({ message: 'Failed to update commission rule' });
  }
};

// @desc    Delete a commission rule
// @route   DELETE /api/admin/commissions/:id
// @access  Private/Admin
export const deleteCommissionRule = async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);
    const [[existing]] = await pool.execute(`SELECT * FROM commission_rules WHERE id = ?`, [ruleId]);
    if (!existing) return res.status(404).json({ message: 'Commission rule not found' });
    await pool.execute(`DELETE FROM commission_rules WHERE id = ?`, [ruleId]);
    await auditFromRequest(req, { action: 'commission.delete', entityType: 'commission', entityId: ruleId, before: toRule(existing) });
    res.json({ message: 'Commission rule deleted' });
  } catch (error) {
    console.error('Error deleting commission rule:', error);
    res.status(500).json({ message: 'Failed to delete commission rule' });
  }
};
