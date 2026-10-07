// FILE LOCATION: backend/utils/orderNumber.js
// DESCRIPTION: Collision-proof business key for `orders.orderNumber`.
//
// WHY: orders.orderNumber is UNIQUE (branding_house.sql: VARCHAR(100) UNIQUE
// NOT NULL) but used to be minted as `ORD-${Date.now()}` — epoch MILLISECONDS.
// Every checkout that lands in the same millisecond therefore asks for the
// same value. Reproduced at 20-way concurrency in
// tests/couponMaxUses.test.js ("concurrency N=20, maxUses=5"): the losing
// INSERT throws ER_DUP_ENTRY, the catch block correctly rolls back the stock
// reservation and hands the coupon slot back, and the customer still gets a
// 500 — an abandoned basket on the critical money path. The custom-request
// checkout had the identical bug with `CUS-${Date.now()}`.
//
// FIX: keep the readable, sortable `PREFIX-<epoch-ms>` prefix and add 8 hex
// chars of entropy. Nothing parses this format (the prefix is display-only;
// the uniqueness that matters is the whole column), so extending it is safe,
// and the result stays far inside VARCHAR(100).
import crypto from 'crypto';

/**
 * A unique order number of the form `PREFIX-<epoch-ms>-<8 hex chars>`.
 *
 * Within a single millisecond two calls now differ with probability
 * 1 - 1/4294967296 (4 random bytes), so a same-millisecond collision is not a
 * realistic checkout failure — while the timestamp keeps numbers sortable and
 * recognisable to support staff.
 *
 * @param {string} [prefix] Business prefix: 'ORD' for checkout, 'CUS' for a
 *   custom-request order.
 * @returns {string} 24-character order number.
 */
export const newOrderNumber = (prefix = 'ORD') =>
  `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

export default newOrderNumber;
