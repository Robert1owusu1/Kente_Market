// backend/migrateCouponUse.js
// P1 (N-7 / V-04): coupon maxUses was enforced on the counter only, never on
// the money. Validation (`usesUsed >= maxUses`) ran long before settlement and
// nothing reserved a slot, so N pending orders could all validate one capped
// coupon and all settle discounted.
//
// This column is the order-tied reservation marker that makes the cap
// economically enforceable AND idempotent per order:
//
//   0 = none        no slot held for this order (also: slot already released)
//   1 = reserved    one use was taken atomically when the coupon was booked
//                   onto this order, and the order is still unpaid
//   2 = settled     the slot belongs to this order permanently — settlement,
//                   webhook retries and reconciliation may never take another,
//                   and cancellation may never give this one back
//
// The slot itself still lives in `coupons.usesUsed`; this column only says
// whether THIS order already accounted for its slot, which is what makes
// consume/release safe to run more than once.
//
// Deliberately NOT part of Order.update()'s allowedFields: a client must never
// be able to write it. Idempotent: safe to run more than once.
import pool from './config/db.js';

const run = async () => {
  const [[col]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'couponUseState'`
  );
  if (Number(col.n) === 0) {
    await pool.execute(
      `ALTER TABLE orders ADD COLUMN couponUseState TINYINT NOT NULL DEFAULT 0`
    );
    console.log(' Added orders.couponUseState column');
  } else {
    console.log(' orders.couponUseState column already exists');
  }

  // Orders that already hold a coupon from BEFORE this fix have no
  // reservation. Do not fabricate one (that would hand out a free slot): they
  // are settled through the legacy path in consumeCouponForOrder, which takes
  // the slot atomically and marks state 2 exactly once.
  console.log(' orders.couponUseState ready (0=none 1=reserved 2=settled)');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
