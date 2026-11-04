// FILE LOCATION: backend/models/membershipModel.js
// DESCRIPTION: A customer's Kente Club membership (Phase 3, Step 10). Mirrors
//   vendor_subscriptions; active/past_due keep the membership benefits live.
import pool from '../config/db.js';

const ACTIVE = ['active', 'past_due'];

class Membership {
  constructor(data) {
    this.id = data.id;
    this.userId = data.userId;
    this.planId = data.planId;
    this.status = data.status;
    this.priceAtSubscribe = Number(data.priceAtSubscribe) || 0;
    this.discountPercentAtSubscribe = Number(data.discountPercentAtSubscribe) || 0;
    this.currency = data.currency || 'GHS';
    this.billingInterval = data.billingInterval || 'monthly';
    this.startReference = data.startReference ?? null;
    this.lastPaymentAt = data.lastPaymentAt ?? null;
    this.paystackCustomerCode = data.paystackCustomerCode ?? null;
    this.paystackSubscriptionCode = data.paystackSubscriptionCode ?? null;
    this.paystackEmailToken = data.paystackEmailToken ?? null;
    this.currentPeriodStart = data.currentPeriodStart ?? null;
    this.currentPeriodEnd = data.currentPeriodEnd ?? null;
    this.nextPaymentAt = data.nextPaymentAt ?? null;
    this.cancelAtPeriodEnd = !!data.cancelAtPeriodEnd;
    this.cancelledAt = data.cancelledAt ?? null;
    this.created_at = data.created_at;
    this.planName = data.planName;
    this.planSlug = data.planSlug;
  }

  static async findById(id) {
    const [rows] = await pool.execute(`SELECT * FROM memberships WHERE id = ?`, [id]);
    return rows.length ? new Membership(rows[0]) : null;
  }
  static async findByStartReference(ref) {
    const [rows] = await pool.execute(`SELECT * FROM memberships WHERE startReference = ?`, [ref]);
    return rows.length ? new Membership(rows[0]) : null;
  }
  static async findByPaystackCode(code) {
    const [rows] = await pool.execute(`SELECT * FROM memberships WHERE paystackSubscriptionCode = ?`, [code]);
    return rows.length ? new Membership(rows[0]) : null;
  }
  static async findLatestByCustomerAndPlan(customerCode, planId) {
    const [rows] = await pool.execute(
      `SELECT * FROM memberships WHERE paystackCustomerCode = ? AND planId = ? ORDER BY created_at DESC LIMIT 1`,
      [customerCode, planId]
    );
    return rows.length ? new Membership(rows[0]) : null;
  }

  /** The user's current benefit-granting membership (active/past_due), with plan info. */
  static async findCurrent(userId) {
    const ph = ACTIVE.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `SELECT m.*, p.name AS planName, p.slug AS planSlug
         FROM memberships m JOIN membership_plans p ON p.id = m.planId
        WHERE m.userId = ? AND m.status IN (${ph})
        ORDER BY m.created_at DESC LIMIT 1`,
      [userId, ...ACTIVE]
    );
    return rows.length ? new Membership(rows[0]) : null;
  }
  static async hasActiveMembership(userId) {
    return (await Membership.findCurrent(userId)) !== null;
  }

  static async findByUser(userId) {
    const [rows] = await pool.execute(
      `SELECT m.*, p.name AS planName, p.slug AS planSlug
         FROM memberships m JOIN membership_plans p ON p.id = m.planId
        WHERE m.userId = ? ORDER BY m.created_at DESC`,
      [userId]
    );
    return rows.map((r) => new Membership(r));
  }

  static async create(data) {
    const [res] = await pool.execute(
      `INSERT INTO memberships (userId, planId, status, priceAtSubscribe, discountPercentAtSubscribe, currency, billingInterval, startReference, paystackCustomerCode)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [
        data.userId, data.planId, Number(data.priceAtSubscribe) || 0, Number(data.discountPercentAtSubscribe) || 0,
        data.currency || 'GHS', data.billingInterval || 'monthly', data.startReference ?? null, data.paystackCustomerCode ?? null,
      ]
    );
    return Membership.findById(res.insertId);
  }

  static async update(id, data) {
    const cols = ['status', 'paystackCustomerCode', 'paystackSubscriptionCode', 'paystackEmailToken',
      'currentPeriodStart', 'currentPeriodEnd', 'nextPaymentAt', 'cancelAtPeriodEnd', 'cancelledAt', 'lastPaymentAt'];
    const sets = []; const values = [];
    for (const c of cols) {
      if (data[c] === undefined) continue;
      sets.push(`${c} = ?`);
      values.push(c === 'cancelAtPeriodEnd' ? (data[c] ? 1 : 0) : data[c]);
    }
    if (sets.length === 0) throw new Error('No membership fields to update');
    values.push(id);
    await pool.execute(`UPDATE memberships SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    return Membership.findById(id);
  }
}

export default Membership;
