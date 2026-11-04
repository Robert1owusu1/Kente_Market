// FILE LOCATION: backend/models/membershipPlanModel.js
// DESCRIPTION: Kente Club membership tiers (Phase 3, Step 10). Admin-managed;
//   each tier has a price + a members-only checkout discount percent.
import pool from '../config/db.js';

class MembershipPlan {
  constructor(data) {
    this.id = data.id;
    this.slug = data.slug;
    this.name = data.name;
    this.description = data.description ?? null;
    this.price = Number(data.price) || 0;
    this.currency = data.currency || 'GHS';
    this.billingInterval = data.billingInterval || 'monthly';
    this.discountPercent = Number(data.discountPercent) || 0;
    this.paystackPlanCode = data.paystackPlanCode ?? null;
    this.isActive = !!data.isActive;
    this.isPublic = !!data.isPublic;
    this.sortOrder = Number(data.sortOrder) || 0;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  toPublic() {
    return {
      id: this.id, slug: this.slug, name: this.name, description: this.description,
      price: this.price, currency: this.currency, billingInterval: this.billingInterval,
      discountPercent: this.discountPercent, sortOrder: this.sortOrder,
    };
  }

  static async findById(id) {
    const [rows] = await pool.execute(`SELECT * FROM membership_plans WHERE id = ?`, [id]);
    return rows.length ? new MembershipPlan(rows[0]) : null;
  }
  static async findBySlug(slug) {
    const [rows] = await pool.execute(`SELECT * FROM membership_plans WHERE slug = ?`, [slug]);
    return rows.length ? new MembershipPlan(rows[0]) : null;
  }
  static async findByPaystackCode(code) {
    const [rows] = await pool.execute(`SELECT * FROM membership_plans WHERE paystackPlanCode = ?`, [code]);
    return rows.length ? new MembershipPlan(rows[0]) : null;
  }
  static async findAll({ activeOnly = false, publicOnly = false } = {}) {
    const where = [];
    if (activeOnly) where.push('isActive = 1');
    if (publicOnly) where.push('isPublic = 1');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(`SELECT * FROM membership_plans ${clause} ORDER BY sortOrder, id`);
    return rows.map((r) => new MembershipPlan(r));
  }
  static selectable() { return MembershipPlan.findAll({ activeOnly: true, publicOnly: true }); }

  static async create(data) {
    const [res] = await pool.execute(
      `INSERT INTO membership_plans (slug, name, description, price, currency, billingInterval, discountPercent, paystackPlanCode, isActive, isPublic, sortOrder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.slug, data.name, data.description ?? null, Number(data.price) || 0,
        data.currency || 'GHS', data.billingInterval || 'monthly', Number(data.discountPercent) || 0,
        data.paystackPlanCode ?? null, data.isActive ? 1 : 0, data.isPublic === undefined ? 1 : (data.isPublic ? 1 : 0),
        Number(data.sortOrder) || 0,
      ]
    );
    return MembershipPlan.findById(res.insertId);
  }

  static async update(id, data) {
    const map = { name: 'name', description: 'description', price: 'price', currency: 'currency',
      billingInterval: 'billingInterval', discountPercent: 'discountPercent', paystackPlanCode: 'paystackPlanCode',
      isActive: 'isActive', isPublic: 'isPublic', sortOrder: 'sortOrder' };
    const sets = []; const values = [];
    for (const [k, col] of Object.entries(map)) {
      if (data[k] === undefined) continue;
      sets.push(`${col} = ?`);
      values.push(k === 'isActive' || k === 'isPublic' ? (data[k] ? 1 : 0) : data[k]);
    }
    if (sets.length === 0) throw new Error('No membership plan fields to update');
    values.push(id);
    await pool.execute(`UPDATE membership_plans SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    return MembershipPlan.findById(id);
  }
}

export default MembershipPlan;
