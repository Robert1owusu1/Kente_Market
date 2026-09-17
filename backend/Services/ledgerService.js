// @ts-check
// SERVICES/ledgerService.js
// Append-only financial journal (financial_events). Every decorated money event
// writes a row keyed by a deterministic `dedupeKey` so retries/re-deliveries can
// never double-book an event. The business-level guards (payout_attempt status,
// wallet unique keys, webhook claim) remain the primary idempotency mechanism;
// this journal is the immutable audit/complement record.
import pool from '../config/db.js';

/**
 * @typedef {Object} FinancialEventInput
 * @property {string} eventType e.g. 'charge.collected' | 'payout.succeeded' ...
 * @property {number | string} amount (GHS)
 * @property {'in'|'out'|'info'} [direction]
 * @property {number | string} [vendorId]
 * @property {number | string} [orderId]
 * @property {number | string} [allocationId]
 * @property {number | string} [payoutAttemptId]
 * @property {string | null} [reference] local business reference
 * @property {string | null} [providerReference] Paystack reference
 * @property {string} dedupeKey deterministic unique key for this action
 * @property {object | null} [payload] raw snapshot
 * @property {string} [currency]
 * @property {any} [connection] optional transaction-scoped connection
 */

/**
 * Write a financial event to the journal. Best-effort: if the migration has
 * not been applied the event is skipped with a warning rather than crashing a
 * webhook or a payout settlement (the business guards still protect money).
 * @param {FinancialEventInput} input
 * @returns {Promise<boolean>} true if the row was written (or deduplicated)
 */
export const recordFinancialEvent = async ({
  eventType,
  amount,
  direction = 'info',
  vendorId,
  orderId,
  allocationId,
  payoutAttemptId,
  reference,
  providerReference,
  dedupeKey,
  payload,
  currency = 'GHS',
  connection,
}) => {
  if (!dedupeKey) throw new Error('financial event requires a dedupeKey');
  const amt = parseFloat(String(amount)) || 0;
  if (!eventType || amt < 0) throw new Error('invalid financial event');

  const exec = connection
    ? connection.execute.bind(connection)
    : pool.execute.bind(pool);

  try {
    await exec(
      `INSERT IGNORE INTO financial_events
         (eventType, currency, amount, direction, vendorId, orderId,
          allocationId, payoutAttemptId, reference, providerReference,
          dedupeKey, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventType,
        currency,
        Math.round(amt * 100) / 100,
        direction,
        vendorId ?? null,
        orderId ?? null,
        allocationId ?? null,
        payoutAttemptId ?? null,
        reference ?? null,
        providerReference ?? null,
        dedupeKey,
        payload ? JSON.stringify(payload) : null,
      ]
    );
    return true;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      console.warn('⚠️  financial_events table missing — run `node migrateHardening.js` (release gate). Skipping journal event.');
    } else if (error.code === 'ER_DUP_ENTRY') {
      // Already recorded (retry/re-delivery) — this is the point of dedupeKey.
      return true;
    } else {
      console.error('❌ Could not record financial event:', error.message);
    }
    return false;
  }
};