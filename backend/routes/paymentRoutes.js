import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../config/db.js';
import { protect } from '../middleware/authMiddleware.js';
import { apiLimiter, webhookLimiter } from '../middleware/rateLimitMiddleware.js';
import {
  holdEscrowForOrder,
  recomputeOrderEscrowStatus,
  trackPlatformRevenue,
  notifyVendorPayoutFailure,
} from '../Services/escrowService.js';
import Coupon from '../models/couponModel.js';
import { computeExpectedCompletion } from '../utils/computeExpectedCompletion.js';

const router = express.Router();

// Paystack Secret Key - Store in environment variables
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

/**
 * Compare two HMAC signatures in constant time to avoid timing attacks.
 */
const safeEqual = (a, b) => {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

/**
 * @route   POST /api/payments/verify-paystack
 * @desc    Verify Paystack payment
 * @access  Public
 */
router.post('/verify-paystack', protect, async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment reference is required' 
      });
    }

    // Verify payment with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const { data } = response.data;

    if (data.status === 'success') {
      // Fallback: if the webhook missed this order, mark it paid here.
      // The webhook_events idempotency guard prevents double-processing.
      const [existing] = await pool.execute(
        `SELECT id, userId, totalAmount, paymentStatus, couponId FROM orders WHERE paymentReference = ?`,
        [reference]
      );
      let orderMarkedPaid = false;
      if (existing.length > 0 && existing[0].paymentStatus !== 'paid') {
        const order = existing[0];

        // Only the order owner may flip it to paid, and only when Paystack
        // actually collected the full order amount. Without these checks an
        // attacker could mark a large order paid by reusing a reference from a
        // smaller/low-value successful transaction (see audit).
        if (order.userId !== req.user.id) {
          return res.status(403).json({ success: false, message: 'Order does not belong to this user' });
        }
        const expectedKobo = Math.round(parseFloat(order.totalAmount) * 100);
        const paidKobo = parseInt(data.amount, 10);
        if (data.currency !== 'NGN' || paidKobo !== expectedKobo) {
          return res.status(400).json({
            success: false,
            message: 'Payment amount does not match the order total',
          });
        }

        await pool.execute(
          `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', updated_at = CURRENT_TIMESTAMP
           WHERE paymentReference = ? AND paymentStatus != 'paid'`,
          [reference]
        );
        const orderId = order.id;
        const heldCount = await holdEscrowForOrder(orderId);
        console.log(`✅ verify-paystack fallback: order ${orderId} marked paid (${heldCount} allocations held)`);
        // Consume deferred coupon usage
        if (order.couponId) {
          try {
            await Coupon.incrementUses(order.couponId);
          } catch (couponErr) {
            console.error(`Failed to increment coupon uses: ${couponErr.message}`);
          }
        }
        // Seed expected completion date for customised orders (see webhook logic).
        try {
          const [[ordRow]] = await pool.execute(
            `SELECT expectedCompletionDate, created_at, items FROM orders WHERE id = ?`,
            [orderId]
          );
          if (ordRow && !ordRow.expectedCompletionDate) {
            const completion = computeExpectedCompletion(ordRow);
            if (completion) {
              await pool.execute(`UPDATE orders SET expectedCompletionDate = ? WHERE id = ?`, [completion, orderId]);
            }
          }
        } catch (compErr) {
          console.warn(`⚠️ Could not seed expected completion date: ${compErr.message}`);
        }
        orderMarkedPaid = true;
      }

      res.json({
        status: 'success',
        message: 'Payment verified successfully',
        data: {
          reference: data.reference,
          amount: data.amount / 100,
          currency: data.currency,
          channel: data.channel,
          paid_at: data.paid_at,
          customer: data.customer,
          orderMarkedPaid,
        },
      });
    } else {
      res.status(400).json({
        status: 'failed',
        message: 'Payment verification failed',
      });
    }
  } catch (error) {
    console.error('Paystack verification error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: error.response?.data?.message || 'Payment verification failed',
    });
  }
});

/**
 * @route   POST /api/payments/paystack-webhook
 * @desc    Handle Paystack webhooks
 * @access  Public (but signature verified)
 * @note    Requires raw body. server.js captures it via express.json({ verify }) into req.rawBody
 */
router.post('/paystack-webhook', webhookLimiter, async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    if (!signature || !req.rawBody) {
      return res.status(400).send('Missing signature');
    }

    // Verify signature against the RAW request body (never the re-serialized JSON)
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(req.rawBody)
      .digest('hex');

    if (!safeEqual(hash, signature)) {
      return res.status(400).send('Invalid signature');
    }

    const event = req.body;

    // Handle different event types
    switch (event.event) {
      case 'charge.success': {
        const reference = event.data?.reference;
        if (reference) {
          // Idempotency guard: record the event and skip replays/duplicates so a
          // replayed (or doubly-delivered) webhook can never re-process an order.
          const [ins] = await pool.execute(
            `INSERT IGNORE INTO webhook_events (event, reference, payload) VALUES (?, ?, ?)`,
            [event.event, reference, JSON.stringify(event.data || null)]
          );
          if (ins.insertId === 0) {
            console.log(`⏸️ Duplicate webhook ignored: ${event.event} ${reference}`);
            return res.status(200).send('Duplicate ignored');
          }

          // Retry loop: the POST /api/orders may not have completed yet when
          // this webhook fires. We retry up to 5 times with increasing delays
          // to wait for the order row (and its escrow allocations) to exist.
          const MAX_RETRIES = 5;
          const BASE_DELAY_MS = 1000;
          let orderId = null;
          let orderFound = false;

          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const connection = await pool.getConnection();
            try {
              const [result] = await connection.execute(
                `UPDATE orders 
                 SET paymentStatus = 'paid', orderStatus = 'processing', updated_at = CURRENT_TIMESTAMP
                 WHERE paymentReference = ?`,
                [reference]
              );
              if (result.affectedRows > 0) {
                orderFound = true;
                // Resolve the orderId from the reference
                const [orderRows] = await connection.execute(
                  `SELECT id, items, couponId FROM orders WHERE paymentReference = ?`,
                  [reference]
                );
                if (orderRows.length > 0) {
                  orderId = orderRows[0].id;

                  // Hold escrow allocations (pending → held)
                  const heldCount = await holdEscrowForOrder(orderId);
                  console.log(`✅ Webhook: order ${orderId} marked paid for reference ${reference} (${heldCount} allocations held)`);

                  // Track platform-owned product revenue
                  let items = orderRows[0].items;
                  if (typeof items === 'string') {
                    try { items = JSON.parse(items); } catch { items = []; }
                  }
                  if (Array.isArray(items) && items.length > 0) {
                    await trackPlatformRevenue(orderId, items);
                  }

                  // For customised (custom-woven) orders, seed the expected
                  // completion date = order start + longest productionTime among
                  // customisable items, so the buyer sees how many days are left
                  // to finish weaving. Only seed if not already set.
                  try {
                    const [[ordRow]] = await connection.execute(
                      `SELECT expectedCompletionDate, created_at, items FROM orders WHERE id = ?`,
                      [orderId]
                    );
                    if (ordRow && !ordRow.expectedCompletionDate) {
                      const completion = computeExpectedCompletion(ordRow);
                      if (completion) {
                        await connection.execute(
                          `UPDATE orders SET expectedCompletionDate = ? WHERE id = ?`,
                          [completion, orderId]
                        );
                      }
                    }
                  } catch (compErr) {
                    console.warn(`⚠️ Could not seed expected completion date: ${compErr.message}`);
                  }

                  // Consume the deferred coupon usage now that payment is confirmed.
                  if (orderRows[0].couponId) {
                    try {
                      const { default: Coupon } = await import('../models/couponModel.js');
                      await Coupon.incrementUses(orderRows[0].couponId);
                      console.log(`🎟️ Coupon ${orderRows[0].couponId} consumed on confirmed payment for order ${orderId}`);
                    } catch (couponErr) {
                      console.warn(`⚠️ Could not increment coupon on payment: ${couponErr.message}`);
                    }
                  }
                }
                break; // success, no more retries needed
              } else {
                // Order not yet created — wait and retry
                console.log(`⏳ Webhook: order not yet found for ${reference} (attempt ${attempt + 1}/${MAX_RETRIES})`);
              }
            } finally {
              connection.release();
            }
            // Wait before next retry with exponential backoff
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * (attempt + 1)));
            }
          }

          if (!orderFound) {
            console.warn(`⚠️ Webhook: no order found for reference ${reference} after ${MAX_RETRIES} retries`);
          }
        }
        console.log('Payment successful:', reference);
        break;
      }

      case 'charge.failed':
        console.log('Payment failed:', event.data.reference);
        break;

      case 'transfer.success': {
        const transferRef = event.data?.reference;
        if (transferRef) {
          const [ins] = await pool.execute(
            `INSERT IGNORE INTO webhook_events (event, reference, payload) VALUES (?, ?, ?)`,
            [event.event, transferRef, JSON.stringify(event.data || null)]
          );
          if (ins.insertId === 0) {
            console.log(`⏸️ Duplicate webhook ignored: ${event.event} ${transferRef}`);
            return res.status(200).send('Duplicate ignored');
          }
          const [result] = await pool.execute(
            `UPDATE escrow_allocations
             SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE payoutReference = ? AND status != 'released'`,
            [transferRef]
          );
          if (result.affectedRows > 0) {
            const [alloc] = await pool.execute(
              `SELECT orderId FROM escrow_allocations WHERE payoutReference = ?`,
              [transferRef]
            );
            console.log(`✅ Transfer success: ${transferRef}`);
            if (alloc.length > 0) {
              const escrowStatus = await recomputeOrderEscrowStatus(alloc[0].orderId);
              await pool.execute(
                `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [escrowStatus, alloc[0].orderId]
              );
            }
          } else {
            console.log(`Transfer success (no matching allocation): ${transferRef}`);
          }
        }
        break;
      }

      case 'transfer.failed': {
        const transferRef = event.data?.reference;
        if (transferRef) {
          const [ins] = await pool.execute(
            `INSERT IGNORE INTO webhook_events (event, reference, payload) VALUES (?, ?, ?)`,
            [event.event, transferRef, JSON.stringify(event.data || null)]
          );
          if (ins.insertId === 0) {
            console.log(`⏸️ Duplicate webhook ignored: ${event.event} ${transferRef}`);
            return res.status(200).send('Duplicate ignored');
          }
          const [result] = await pool.execute(
            `UPDATE escrow_allocations
             SET status = 'failed', updated_at = CURRENT_TIMESTAMP
             WHERE payoutReference = ?`,
            [transferRef]
          );
          if (result.affectedRows > 0) {
            const [alloc] = await pool.execute(
              `SELECT orderId, id FROM escrow_allocations WHERE payoutReference = ?`,
              [transferRef]
            );
            console.log(`❌ Transfer failed: ${transferRef}`);
            if (alloc.length > 0) {
              const escrowStatus = await recomputeOrderEscrowStatus(alloc[0].orderId);
              await pool.execute(
                `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [escrowStatus, alloc[0].orderId]
              );
              // Notify the vendor about the failed payout
              await notifyVendorPayoutFailure(alloc[0].orderId, [alloc[0].id]);
            }
          }
        }
        break;
      }

      case 'transfer.reversed': {
        const reversedRef = event.data?.reference;
        if (reversedRef) {
          const [ins] = await pool.execute(
            `INSERT IGNORE INTO webhook_events (event, reference, payload) VALUES (?, ?, ?)`,
            [event.event, reversedRef, JSON.stringify(event.data || null)]
          );
          if (ins.insertId === 0) {
            console.log(`⏸️ Duplicate webhook ignored: ${event.event} ${reversedRef}`);
            return res.status(200).send('Duplicate ignored');
          }
          // Reversed transfers go back to 'held' so the admin can retry
          const [result] = await pool.execute(
            `UPDATE escrow_allocations
             SET status = 'held', payoutReference = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE payoutReference = ? AND status IN ('releasing', 'released')`,
            [reversedRef]
          );
          if (result.affectedRows > 0) {
            // Find affected order IDs from the raw payload or from allocations
            // that were just reverted (they no longer have the reference).
            const [orderRows] = await pool.execute(
              `SELECT DISTINCT orderId FROM escrow_allocations
               WHERE status = 'held' AND payoutReference IS NULL
                 AND updated_at >= DATE_SUB(NOW(), INTERVAL 5 SECOND)`,
              []
            );
            for (const row of orderRows) {
              const escrowStatus = await recomputeOrderEscrowStatus(row.orderId);
              await pool.execute(
                `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [escrowStatus, row.orderId]
              );
            }
            console.log(`🔄 Transfer reversed: ${reversedRef} (${result.affectedRows} allocations reverted to held)`);
          } else {
            console.log(`Transfer reversed (no matching allocation): ${reversedRef}`);
          }
        }
        break;
      }

      default:
        console.log('Unhandled event:', event.event);
    }

    res.status(200).send('Webhook received');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook processing failed');
  }
});

/**
 * @route   GET /api/payments/paystack/banks
 * @desc    Get list of banks for Paystack
 * @access  Private
 */
router.get('/paystack/banks', protect, apiLimiter, async (req, res) => {
  try {
    const response = await axios.get('https://api.paystack.co/bank', {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });

    res.json({
      success: true,
      banks: response.data.data,
    });
  } catch (error) {
    console.error('Error fetching banks:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch banks',
    });
  }
});

export default router;