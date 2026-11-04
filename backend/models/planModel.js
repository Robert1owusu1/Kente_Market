// FILE LOCATION: backend/models/planModel.js
// DESCRIPTION: Data-access layer for the vendor PLAN catalogue (the `plans`
//   table seeded by migratePlans.js). Admin CRUD + vendor-facing listing.
//   Money arrives from MySQL DECIMAL as strings — always coerce with Number().
import pool from '../config/db.js';
import { isValidFeatureList, BILLING_INTERVALS } from '../../shared/plans.js';

/** Parse a JSON column that may arrive as a string, array, or null. */
function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

class Plan {
  constructor(data) {
    this.id = data.id;
    this.slug = data.slug;
    this.name = data.name;
    this.description = data.description ?? null;
    this.price = Number(data.price) || 0;
    this.currency = data.currency || 'GHS';
    this.billingInterval = data.billingInterval || 'monthly';
    this.commissionRate = data.commissionRate === null || data.commissionRate === undefined
      ? null
      : Number(data.commissionRate);
    this.paystackPlanCode = data.paystackPlanCode ?? null;
    this.features = parseJson(data.features, []);
    this.productLimit = data.productLimit === null || data.productLimit === undefined
      ? null
      : Number(data.productLimit);
    this.isActive = !!data.isActive;
    this.isPublic = !!data.isPublic;
    this.sortOrder = Number(data.sortOrder) || 0;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  /** Vendor-facing view used on the plan-selection page (no internal churn). */
  toPublic() {
    return {
      id: this.id,
      slug: this.slug,
      name: this.name,
      description: this.description,
      price: this.price,
      currency: this.currency,
      billingInterval: this.billingInterval,
      commissionRate: this.commissionRate,
      features: this.features,
      productLimit: this.productLimit,
      sortOrder: this.sortOrder,
    };
  }

  static async findById(id) {
    const [rows] = await pool.execute(`SELECT * FROM plans WHERE id = ?`, [id]);
    return rows.length ? new Plan(rows[0]) : null;
  }

  static async findBySlug(slug) {
    const [rows] = await pool.execute(`SELECT * FROM plans WHERE slug = ?`, [slug]);
    return rows.length ? new Plan(rows[0]) : null;
  }

  static async findByPaystackCode(planCode) {
    const [rows] = await pool.execute(`SELECT * FROM plans WHERE paystackPlanCode = ?`, [planCode]);
    return rows.length ? new Plan(rows[0]) : null;
  }

  /**
   * @param {{ activeOnly?: boolean, publicOnly?: boolean }} [opts]
   * - activeOnly: only plans available for new subscriptions (admin may hide drafts)
   * - publicOnly: only plans shown on the vendor plan-selection page
   */
  static async findAll({ activeOnly = false, publicOnly = false } = {}) {
    const where = [];
    if (activeOnly) where.push('isActive = 1');
    if (publicOnly) where.push('isPublic = 1');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(`SELECT * FROM plans ${clause} ORDER BY sortOrder, id`);
    return rows.map((r) => new Plan(r));
  }

  /** Plans a vendor may subscribe to (live + public). */
  static selectable() {
    return Plan.findAll({ activeOnly: true, publicOnly: true });
  }

  /** @param {Record<string, any>} data */
  static async create(data) {
    if (data.features !== undefined && !isValidFeatureList(data.features)) {
      throw new Error('features must be an array of known feature keys');
    }
    if (data.billingInterval && !BILLING_INTERVALS.includes(data.billingInterval)) {
      throw new Error(`billingInterval must be one of: ${BILLING_INTERVALS.join(', ')}`);
    }
    const [result] = await pool.execute(
      `INSERT INTO plans
         (slug, name, description, price, currency, billingInterval, commissionRate,
          paystackPlanCode, features, productLimit, isActive, isPublic, sortOrder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?)`,
      [
        data.slug,
        data.name,
        data.description ?? null,
        Number(data.price) || 0,
        data.currency || 'GHS',
        data.billingInterval || 'monthly',
        data.commissionRate === undefined || data.commissionRate === null ? 0.1 : Number(data.commissionRate),
        data.paystackPlanCode ?? null,
        JSON.stringify(data.features ?? []),
        data.productLimit === undefined || data.productLimit === null ? null : Number(data.productLimit),
        data.isActive ? 1 : 0,
        data.isPublic === undefined ? 1 : (data.isPublic ? 1 : 0),
        Number(data.sortOrder) || 0,
      ]
    );
    return Plan.findById(result.insertId);
  }

  /** Partial update. Only provided keys are written. @param {number} id */
  static async update(id, data) {
    const map = {
      name: 'name',
      description: 'description',
      price: 'price',
      currency: 'currency',
      billingInterval: 'billingInterval',
      commissionRate: 'commissionRate',
      paystackPlanCode: 'paystackPlanCode',
      productLimit: 'productLimit',
      isActive: 'isActive',
      isPublic: 'isPublic',
      sortOrder: 'sortOrder',
    };
    const sets = [];
    const values = [];
    for (const [key, col] of Object.entries(map)) {
      if (data[key] === undefined) continue;
      if (key === 'billingInterval' && data[key] && !BILLING_INTERVALS.includes(data[key])) {
        throw new Error(`billingInterval must be one of: ${BILLING_INTERVALS.join(', ')}`);
      }
      sets.push(`${col} = ?`);
      if (key === 'isActive' || key === 'isPublic') values.push(data[key] ? 1 : 0);
      else values.push(data[key]);
    }
    // features is JSON — handled separately with a CAST.
    if (data.features !== undefined) {
      if (!isValidFeatureList(data.features)) {
        throw new Error('features must be an array of known feature keys');
      }
      sets.push('features = CAST(? AS JSON)');
      values.push(JSON.stringify(data.features));
    }
    if (sets.length === 0) throw new Error('No plan fields to update');
    values.push(id);
    await pool.execute(
      `UPDATE plans SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return Plan.findById(id);
  }
}

export default Plan;
