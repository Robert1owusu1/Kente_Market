import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../config/db.js';
import { protect } from '../midleware/authMiddleware.js';
import { apiLimiter, webhookLimiter } from '../midleware/rateLimitMiddleware.js';
import {
  holdEscrowForOrder,
  recomputeOrderEscrowStatus,
} from '../Services/escrowService.js';

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
      res.json({
        status: 'success',
        message: 'Payment verified successfully',
        data: {
          reference: data.reference,
          amount: data.amount / 100, // Convert from pesewas to cedis
          currency: data.currency,
          channel: data.channel,
          paid_at: data.paid_at,
          customer: data.customer,
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

          const connection = await pool.getConnection();
          try {
            const [result] = await connection.execute(
              `UPDATE orders 
               SET paymentStatus = 'paid', orderStatus = 'processing', updated_at = CURRENT_TIMESTAMP
               WHERE paymentReference = ?`,
              [reference]
            );
            if (result.affectedRows > 0) {
              console.log(`✅ Webhook: order marked paid for reference ${reference}`);
              // Put any per-vendor allocations into escrow ("held")
              if (event.data?.metadata?.orderId) {
                await holdEscrowForOrder(event.data.metadata.orderId);
              } else if (event.data?.orderId) {
                await holdEscrowForOrder(event.data.orderId);
              } else {
                const [orderRows] = await connection.execute(
                  `SELECT id FROM orders WHERE paymentReference = ?`,
                  [reference]
                );
                if (orderRows.length > 0) {
                  await holdEscrowForOrder(orderRows[0].id);
                }
              }
            } else {
              console.warn(`⚠️ Webhook: no order found for reference ${reference}`);
            }
          } finally {
            connection.release();
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
              `SELECT orderId FROM escrow_allocations WHERE payoutReference = ?`,
              [transferRef]
            );
            console.log(`❌ Transfer failed: ${transferRef}`);
            if (alloc.length > 0) {
              const escrowStatus = await recomputeOrderEscrowStatus(alloc[0].orderId);
              await pool.execute(
                `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [escrowStatus, alloc[0].orderId]
              );
            }
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