// FILE LOCATION: backend/controllers/commissionController.js
// DESCRIPTION: Admin CRUD for the configurable commission engine. Rules are
//              scoped global / category / vendor / product and resolved by
//              specificity (product > vendor > category > global).
import pool from '../config/db.js';
import { auditFromRequest } from '../utils/auditLog.js';

const VALID_SCOPES = ['global', 'category', 'vendor', 'product'];

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
    res.json(rows.map((r) => ({ ...r, rate: parseFloat(r.rate) })));
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
    const { scope, targetId, rate, priority } = req.body;
    if (!VALID_SCOPES.includes(scope)) {
      return res.status(400).json({ message: `Scope must be one of: ${VALID_SCOPES.join(', ')}` });
    }
    const rateNum = parseFloat(rate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 0.5) {
      return res.status(400).json({ message: 'Rate must be between 0 and 0.5 (0%–50%)' });
    }
    if (scope !== 'global' && (targetId === undefined || targetId === null || targetId === '')) {
      return res.status(400).json({ message: 'A target is required for non-global rules' });
    }

    if (scope === 'vendor' && !Number.isInteger(parseInt(targetId))) {
      return res.status(400).json({ message: 'Vendor target must be a valid user id' });
    }
    if (scope === 'product' && !Number.isInteger(parseInt(targetId))) {
      return res.status(400).json({ message: 'Product target must be a valid product id' });
    }

    const [result] = await pool.execute(
      `INSERT INTO commission_rules (scope, targetId, rate, priority, isActive)
       VALUES (?, ?, ?, ?, true)`,
      [scope, String(targetId), rateNum, parseInt(priority) || 0]
    );
    const [[created]] = await pool.execute(`SELECT * FROM commission_rules WHERE id = ?`, [result.insertId]);
    await auditFromRequest(req, { action: 'commission.create', entityType: 'commission', entityId: result.insertId, after: { scope, targetId: String(targetId), rate: rateNum } });
    res.status(201).json({ message: 'Commission rule created', rule: { ...created, rate: parseFloat(created.rate) } });
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
    const [[existing]] = await pool.execute(`SELECT id FROM commission_rules WHERE id = ?`, [ruleId]);
    if (!existing) return res.status(404).json({ message: 'Commission rule not found' });

    const { rate, priority, isActive, scope, targetId } = req.body;
    const sets = [];
    const vals = [];

    if (rate !== undefined) {
      const rateNum = parseFloat(rate);
      if (isNaN(rateNum) || rateNum < 0 || rateNum > 0.5) {
        return res.status(400).json({ message: 'Rate must be between 0 and 0.5 (0%–50%)' });
      }
      sets.push('rate = ?'); vals.push(rateNum);
    }
    if (priority !== undefined) { sets.push('priority = ?'); vals.push(parseInt(priority) || 0); }
    if (isActive !== undefined) { sets.push('isActive = ?'); vals.push(isActive ? 1 : 0); }
    if (scope !== undefined) {
      if (!VALID_SCOPES.includes(scope)) {
        return res.status(400).json({ message: `Scope must be one of: ${VALID_SCOPES.join(', ')}` });
      }
      sets.push('scope = ?'); vals.push(scope);
    }
    if (targetId !== undefined) { sets.push('targetId = ?'); vals.push(String(targetId)); }

    if (sets.length === 0) return res.status(400).json({ message: 'No fields to update' });
    vals.push(ruleId);
    await pool.execute(`UPDATE commission_rules SET ${sets.join(', ')} WHERE id = ?`, vals);

    const [[updated]] = await pool.execute(`SELECT * FROM commission_rules WHERE id = ?`, [ruleId]);
    await auditFromRequest(req, { action: 'commission.update', entityType: 'commission', entityId: ruleId, before: existing, after: { ...updated, rate: parseFloat(updated.rate) } });
    res.json({ message: 'Commission rule updated', rule: { ...updated, rate: parseFloat(updated.rate) } });
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
    const [[existing]] = await pool.execute(`SELECT id FROM commission_rules WHERE id = ?`, [ruleId]);
    if (!existing) return res.status(404).json({ message: 'Commission rule not found' });
    await pool.execute(`DELETE FROM commission_rules WHERE id = ?`, [ruleId]);
    await auditFromRequest(req, { action: 'commission.delete', entityType: 'commission', entityId: ruleId, before: existing });
    res.json({ message: 'Commission rule deleted' });
  } catch (error) {
    console.error('Error deleting commission rule:', error);
    res.status(500).json({ message: 'Failed to delete commission rule' });
  }
};