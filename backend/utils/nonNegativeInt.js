// FILE LOCATION: backend/utils/nonNegativeInt.js
// DESCRIPTION: The non-negative invariant for absolute counters, in one place.
//
// Why this exists (I3): inventory has two kinds of write.
//
//   * *Relative* writes — `stock = stock - ?` with a `AND stock >= ?` guard
//     (reservationService, the payment decrement) — are already safe by
//     construction, and `stockRace.test.js` proves stock lands on 0, never -1.
//   * *Absolute* writes — `stock = ?` straight from a request body — accepted
//     any integer. `parseInt(-5) || 0` is `-5`, so `-5` was stored as-is.
//     Four independent call sites did this (admin create, admin update, vendor
//     create, vendor update).
//
// The negative value is what makes the relative guards meaningless: once the
// column can start at -5, `stock >= ?` passes for quantities the shop does not
// have, and the public projection (`productModel.js` → `Math.max(0, onHand)`)
// hides it from buyers while checkout happily oversells.
//
// Enforced twice on purpose:
//   1. Here, on every absolute write — this is what actually holds on TiDB,
//      which parses CHECK constraints but does not enforce them.
//   2. `CHECK (stock >= 0)` on MySQL/MariaDB — see `branding_house.sql` and
//      `migrateSchemaSync.js`, so a *future* writer written without this
//      helper still cannot persist a negative row.
//
// Note it deliberately does not validate: callers already coerce garbage to 0
// (`parseInt(x) || 0`), and turning that into a 400 would change behaviour for
// every client that sends an empty string. Clamping preserves today's
// responses while removing the capability.

/**
 * Coerce to an integer, refusing to go below zero.
 *
 * `NaN` (missing, `''`, `'abc'`) → 0, exactly as the previous
 * `parseInt(x) || 0` behaved; anything negative → 0.
 *
 * @param {unknown} value
 * @returns {number} a non-negative integer
 */
export const toNonNegativeInt = (value) =>
  Math.max(0, Number.parseInt(value, 10) || 0);
