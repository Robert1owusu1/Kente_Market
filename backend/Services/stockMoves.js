// backend/Services/stockMoves.js
// Stock-movement ledger (P1 auditability). Every mutation of product.stock
// appends one row per product: who/what/why. Writers are best-effort — a
// ledger failure must never fail the stock operation itself (the UPDATE
// already committed or runs independently).
import pool from '../config/db.js';

export const STOCK_REASONS = [
  'reserve',
  'sale',
  'create-rollback',
  'cancel-restore',
  'return-restore',
  'partial-return-restore',
  'expiry-release',
  'manual-adjust',
];

/**
 * Append a stock movement row. Never throws.
 * @param {{ productId: number|string, delta: number|string, reason: string, orderId?: number|string|null, actorId?: number|string|null, note?: string|null }} move
 */
export const recordStockMove = async ({ productId, delta, reason, orderId = null, actorId = null, note = null }) => {
  try {
    if (!productId || !Number.isFinite(Number(delta)) || Number(delta) === 0) return false;
    if (!STOCK_REASONS.includes(reason)) reason = 'manual-adjust';
    await pool.execute(
      `INSERT INTO stock_moves (productId, delta, reason, orderId, actorId, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [parseInt(productId, 10), parseInt(delta, 10), reason, orderId ?? null, actorId ?? null, note ? String(note).slice(0, 500) : null]
    );
    return true;
  } catch (err) {
    console.warn(` Stock ledger skipped (product ${productId}, ${reason}): ${err.message}`);
    return false;
  }
};
