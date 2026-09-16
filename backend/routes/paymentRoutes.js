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
import { decrementStockForOrder } from '../controllers/orderController.js';
import { sendOrderConfirmationEmail } from '../utils/orderEmailService.js';
import { debitVendorBalance } from '../Services/walletService.js';

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
        if (data.currency !== 'GHS' || paidKobo !== expectedKobo) {
          return res.status(400).json({
            success: false,
            message: 'Payment amount does not match the order total',
          });
        }

        const [flipResult] = await pool.execute(
          `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', updated_at = CURRENT_TIMESTAMP
           WHERE paymentReference = ? AND paymentStatus != 'paid'`,
          [reference]
        );
        const orderId = order.id;
        // Idempotency: only run the post-payment side effects (escrow hold,
        // stock decrement, coupon) if THIS call actually flipped the order.
        // If the webhook already marked it paid (dozens of rows updated? no —
        // one order per reference), affectedRows is 0 and we skip so stock and
        // coupon are not decremented twice.
        const flipped = flipResult.affectedRows > 0;
        if (flipped) {
          const heldCount = await holdEscrowForOrder(orderId);
          console.log(`✅ verify-paystack fallback: order ${orderId} marked paid (${heldCount} allocations held)`);
          // Decrement in-stock inventory for the confirmed order.
          try {
            const [[paidOrderRow]] = await pool.execute(
              `SELECT items FROM orders WHERE id = ?`,
              [orderId]
            );
            if (paidOrderRow?.items) {
              let paidItems = paidOrderRow.items;
              if (typeof paidItems === 'string') {
                try { paidItems = JSON.parse(paidItems); } catch { paidItems = []; }
              }
              if (Array.isArray(paidItems) && paidItems.length > 0) {
                await decrementStockForOrder(paidItems, orderId);
              }
            }
          } catch (stockErr) {
            console.warn(`⚠️ Could not decrement stock for order ${orderId}: ${stockErr.message}`);
          }
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
          // Receipt email — only when THIS call flipped the order, so a webhook
          // that already handled payment never sends a duplicate.
          try {
            await sendOrderConfirmationEmail(orderId);
          } catch (emailErr) {
            console.warn(`⚠️ Could not send order confirmation email: ${emailErr.message}`);
          }
          orderMarkedPaid = true;
        }
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
  let claimedWebhook = null;
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
          // Persist first, then atomically claim processing. Receipt is not the
          // same as completion: failed events remain retryable on redelivery.
          await pool.execute(
            `INSERT IGNORE INTO webhook_events (event, reference, payload) VALUES (?, ?, ?)`,
            [event.event, reference, JSON.stringify(event.data || null)]
          );
          const [claim] = await pool.execute(
            `UPDATE webhook_events
             SET processing_status = 'processing', attempts = attempts + 1, last_error = NULL
             WHERE event = ? AND reference = ?
               AND processing_status IN ('received', 'failed')`,
            [event.event, reference]
          );
          if (claim.affectedRows !== 1) {
            console.log(`⏸️ Webhook already being processed/processed: ${event.event} ${reference}`);
            return res.status(200).send('Duplicate ignored');
          }
          claimedWebhook = { event: event.event, reference };

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
                 WHERE paymentReference = ? AND paymentStatus != 'paid'`,
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

                  // Decrement in-stock inventory now that payment is confirmed.
                  if (Array.isArray(items) && items.length > 0) {
                    await decrementStockForOrder(items, orderId);
                    console.log(`📦 Stock decremented for order ${orderId}`);
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
                // A verified-payment fallback may have completed the same
                // order between delivery attempts. Treat that as terminally
                // processed instead of retrying this webhook forever.
                const [[alreadyPaid]] = await connection.execute(
                  `SELECT id, paymentStatus FROM orders WHERE paymentReference = ?`, [reference]
                );
                if (alreadyPaid?.paymentStatus === 'paid') {
                  orderFound = true;
                  orderId = alreadyPaid.id;
                  break;
                }
                // Order not yet created — wait and retry.
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
            await pool.execute(
              `UPDATE webhook_events SET processing_status = 'failed', last_error = ?
               WHERE event = ? AND reference = ?`,
              ['Order was not found after retry window', event.event, reference]
            );
            // A non-2xx makes Paystack retry later, when order creation may
            // have completed. The durable failed state avoids losing payment.
            return res.status(500).send('Order not ready; retry webhook');
          } else if (orderId) {
            // Receipt email — fires only when the webhook itself performed the
            // paid flip. If the verify-paystack fallback already did it, the
            // affected guard above means orderFound is false here.
            try {
              await sendOrderConfirmationEmail(orderId);
            } catch (emailErr) {
              console.warn(`⚠️ Could not send order confirmation email: ${emailErr.message}`);
            }
          }
          await pool.execute(
            `UPDATE webhook_events SET processing_status = 'processed', processed_at = CURRENT_TIMESTAMP
             WHERE event = ? AND reference = ?`, [event.event, reference]
          );
          claimedWebhook = null;
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
          const [attemptRows] = await pool.execute(
            `SELECT pa.*, ea.orderId
             FROM payout_attempts pa JOIN escrow_allocations ea ON ea.id = pa.allocationId
             WHERE pa.reference = ? OR pa.providerReference = ? LIMIT 1`,
            [transferRef, transferRef]
          );
          const attempt = attemptRows[0];
          if (attempt) {
            // Mark the attempt before touching the wallet. Re-delivered
            // webhooks are stopped by webhook_events, and this condition makes
            // a manual/reconciliation replay safe as well.
            const [settled] = await pool.execute(
              `UPDATE payout_attempts SET status = 'succeeded', lastError = NULL
               WHERE id = ? AND status = 'processing'`, [attempt.id]
            );
            if (settled.affectedRows === 0) return res.status(200).send('Transfer already settled');
            if (attempt.isFull) {
              await pool.execute(
                `UPDATE escrow_allocations
                 SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'releasing'`, [attempt.allocationId]
              );
            }
            await debitVendorBalance(attempt.vendorId, attempt.amount, attempt.reference,
              `Withdrawal for order ${attempt.orderId}`);
            console.log(`✅ Transfer success: ${transferRef}`);
            const escrowStatus = await recomputeOrderEscrowStatus(attempt.orderId);
            await pool.execute(
              `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [escrowStatus, attempt.orderId]
            );
          } else {
            console.warn(`Transfer success has no payout attempt: ${transferRef}`);
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
          const [attemptRows] = await pool.execute(
            `SELECT pa.*, ea.orderId FROM payout_attempts pa
             JOIN escrow_allocations ea ON ea.id = pa.allocationId
             WHERE pa.reference = ? OR pa.providerReference = ? LIMIT 1`, [transferRef, transferRef]
          );
          const attempt = attemptRows[0];
          if (attempt) {
            const [failedAttempt] = await pool.execute(
              `UPDATE payout_attempts SET status = 'failed' WHERE id = ? AND status = 'processing'`, [attempt.id]
            );
            if (failedAttempt.affectedRows === 0) return res.status(200).send('Transfer already settled');
            // Return the reserved amount only after Paystack definitively says
            // it failed. Never do this for a client timeout, whose outcome is
            // unknown until reconciliation.
            if (attempt.isFull) {
              await pool.execute(
                `UPDATE escrow_allocations SET status = 'available', payoutAmount = payoutAmount + ?,
                 payoutReference = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'releasing'`,
                [attempt.amount, attempt.allocationId]
              );
            } else {
              await pool.execute(
                `UPDATE escrow_allocations SET payoutAmount = payoutAmount + ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'available'`, [attempt.amount, attempt.allocationId]
              );
            }
            console.log(`❌ Transfer failed: ${transferRef}`);
            {
              const escrowStatus = await recomputeOrderEscrowStatus(attempt.orderId);
              await pool.execute(
                `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [escrowStatus, attempt.orderId]
              );
              await notifyVendorPayoutFailure(attempt.orderId, [attempt.allocationId]);
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
    if (claimedWebhook) {
      try {
        await pool.execute(
          `UPDATE webhook_events SET processing_status = 'failed', last_error = ?
           WHERE event = ? AND reference = ? AND processing_status = 'processing'`,
          [String(error.message || error).slice(0, 500), claimedWebhook.event, claimedWebhook.reference]
        );
      } catch (recordError) {
        console.error('Could not record webhook failure:', recordError.message);
      }
    }
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
