// FILE LOCATION: backend/models/vendorSubscriptionModel.js
// DESCRIPTION: Data-access layer for vendor subscriptions (the
//   `vendor_subscriptions` table). vendorId == users.id (same convention as
//   escrow_allocations / wallet_transactions / vendor_wallets). Money terms are
//   snapshot on the row at subscribe time so later plan edits never rewrite an
//   active contract. The pay-for-plan gate (Phase 2) reads hasActiveSubscription.
import pool from '../config/db.js';
import { ACTIVE_SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUSES } from '../../shared/plans.js';

class VendorSubscription {
  constructor(data) {
    this.id = data.id;
    this.vendorId = data.vendorId;
    this.planId = data.planId;
    this.status = data.status;
    this.priceAtSubscribe = Number(data.priceAtSubscribe) || 0;
    this.commissionRateAtSubscribe = data.commissionRateAtSubscribe === null || data.commissionRateAtSubscribe === undefined
      ? null
      : Number(data.commissionRateAtSubscribe);
    this.currency = data.currency || 'GHS';
    this.billingInterval = data.billingInterval || 'monthly';
    this.startReference = data.startReference ?? null;
    this.lastPaymentAt = data.lastPaymentAt ?? null;
    this.paystackCustomerCode = data.paystackCustomerCode ?? null;
    this.paystackSubscriptionCode = data.paystackSubscriptionCode ?? null;
    this.paystackEmailToken = data.paystackEmailToken ?? null;
    this.paystackAuthorizationCode = data.paystackAuthorizationCode ?? null;
    this.currentPeriodStart = data.currentPeriodStart ?? null;
    this.currentPeriodEnd = data.currentPeriodEnd ?? null;
    this.nextPaymentAt = data.nextPaymentAt ?? null;
    this.cancelAtPeriodEnd = !!data.cancelAtPeriodEnd;
    this.cancelledAt = data.cancelledAt ?? null;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    // Joined plan fields (when selected with a join).
    this.planName = data.planName;
    this.planSlug = data.planSlug;
  }

  /** True when this subscription keeps the vendor dashboard unlocked. */
  get isUnlocking() {
    return ACTIVE_SUBSCRIPTION_STATUSES.includes(this.status);
  }

  static async findById(id) {
    const [rows] = await pool.execute(`SELECT * FROM vendor_subscriptions WHERE id = ?`, [id]);
    return rows.length ? new VendorSubscription(rows[0]) : null;
  }

  static async findByPaystackCode(subscriptionCode) {
    const [rows] = await pool.execute(
      `SELECT * FROM vendor_subscriptions WHERE paystackSubscriptionCode = ?`,
      [subscriptionCode]
    );
    return rows.length ? new VendorSubscription(rows[0]) : null;
  }

  /** All subscriptions for a vendor (newest first), with plan name/slug joined. */
  static async findByVendor(vendorId) {
    const [rows] = await pool.execute(
      `SELECT vs.*, p.name AS planName, p.slug AS planSlug
       FROM vendor_subscriptions vs
       JOIN plans p ON p.id = vs.planId
       WHERE vs.vendorId = ?
       ORDER BY vs.created_at DESC`,
      [vendorId]
    );
    return rows.map((r) => new VendorSubscription(r));
  }

  /**
   * The vendor's current dashboard-unlocking subscription (active or past_due),
   * or null. There is at most one such row per vendor by application rule.
   */
  static async findCurrent(vendorId) {
    const placeholders = ACTIVE_SUBSCRIPTION_STATUSES.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `SELECT vs.*, p.name AS planName, p.slug AS planSlug
       FROM vendor_subscriptions vs
       JOIN plans p ON p.id = vs.planId
       WHERE vs.vendorId = ? AND vs.status IN (${placeholders})
       ORDER BY vs.created_at DESC
       LIMIT 1`,
      [vendorId, ...ACTIVE_SUBSCRIPTION_STATUSES]
    );
    return rows.length ? new VendorSubscription(rows[0]) : null;
  }

  /** Does this vendor have a dashboard-unlocking subscription right now? */
  static async hasActiveSubscription(vendorId) {
    return (await VendorSubscription.findCurrent(vendorId)) !== null;
  }

  /**
   * Create a subscription in 'pending' (portal stays locked until the first
   * successful payment flips it to 'active'). Money terms are snapshot here.
   * @param {{ vendorId:number, planId:number, priceAtSubscribe:number,
   *   commissionRateAtSubscribe:number, currency?:string, billingInterval?:string,
   *   paystackCustomerCode?:string|null, startReference?:string|null }} data
   */
  static async create(data) {
    const [result] = await pool.execute(
      `INSERT INTO vendor_subscriptions
         (vendorId, planId, status, priceAtSubscribe, commissionRateAtSubscribe,
          currency, billingInterval, paystackCustomerCode, startReference)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [
        data.vendorId,
        data.planId,
        Number(data.priceAtSubscribe) || 0,
        Number(data.commissionRateAtSubscribe),
        data.currency || 'GHS',
        data.billingInterval || 'monthly',
        data.paystackCustomerCode ?? null,
        data.startReference ?? null,
      ]
    );
    return VendorSubscription.findById(result.insertId);
  }

  static async findByStartReference(reference) {
    const [rows] = await pool.execute(
      `SELECT * FROM vendor_subscriptions WHERE startReference = ?`,
      [reference]
    );
    return rows.length ? new VendorSubscription(rows[0]) : null;
  }

  /** Most recent subscription for a Paystack customer + plan (subscription.create match). */
  static async findLatestByCustomerAndPlan(customerCode, planId) {
    const [rows] = await pool.execute(
      `SELECT * FROM vendor_subscriptions WHERE paystackCustomerCode = ? AND planId = ?
       ORDER BY created_at DESC LIMIT 1`,
      [customerCode, planId]
    );
    return rows.length ? new VendorSubscription(rows[0]) : null;
  }

  /**
   * Patch a subscription. Only provided keys are written. Used by the checkout
   * flow and the Paystack webhook handler (Phase 2).
   * @param {number} id
   */
  static async update(id, data) {
    const cols = [
      'status', 'paystackCustomerCode', 'paystackSubscriptionCode',
      'paystackEmailToken', 'paystackAuthorizationCode',
      'currentPeriodStart', 'currentPeriodEnd', 'nextPaymentAt',
      'cancelAtPeriodEnd', 'cancelledAt', 'lastPaymentAt',
    ];
    const sets = [];
    const values = [];
    for (const c of cols) {
      if (data[c] === undefined) continue;
      if (c === 'status' && !SUBSCRIPTION_STATUSES.includes(data[c])) {
        throw new Error(`status must be one of: ${SUBSCRIPTION_STATUSES.join(', ')}`);
      }
      sets.push(`${c} = ?`);
      if (c === 'cancelAtPeriodEnd') values.push(data[c] ? 1 : 0);
      else values.push(data[c]);
    }
    if (sets.length === 0) throw new Error('No subscription fields to update');
    values.push(id);
    await pool.execute(
      `UPDATE vendor_subscriptions SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return VendorSubscription.findById(id);
  }
}

export default VendorSubscription;
