import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../config/db.js';
import { protect } from '../middleware/authMiddleware.js';
import { apiLimiter, webhookLimiter } from '../middleware/rateLimitMiddleware.js';
import {
  applyPaidOrderSideEffects,
  PAID_TRACKING_SET_SQL,
} from '../Services/escrowService.js';
import { computeExpectedCompletion } from '../utils/computeExpectedCompletion.js';
import { sendOrderConfirmationEmail } from '../utils/orderEmailService.js';
import { CHARGED_CURRENCY } from '../Services/paymentCurrency.js';
import { PAYSTACK_TIMEOUT_MS } from '../Services/paystackservices.js';
import {
  settleTransferSuccess,
  settleTransferFailed,
  settleTransferReversed,
} from '../Services/transferSettlementService.js';
import { reconcileTerminalOrderCharge } from '../Services/paymentReconciliationService.js';
import { recordFinancialEvent } from '../Services/ledgerService.js';
import { notifyAdmins } from '../utils/adminAlerts.js';

// Provider evidence carried by a signed transfer webhook: amount in pesewas and
// currency. Settlement refuses to book a transfer whose evidence differs from
// the reservation (reconciliation_required instead) — PAYOUT_LIFECYCLE_DESIGN.md.
const transferEvidence = (data) => ({
  amountMinor: data?.amount != null && Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
  currency: data?.currency || null,
});

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
 * Durable webhook receipt + claim. Inserting the payload is NOT completion:
 * only a claim transition (received|failed -> processing) may run the side
 * effects, so a crash mid-processing leaves the event reclaimable on
 * redelivery (and by the reconciliation scheduler which marks stale
 * 'processing' rows back to 'failed').
 * @param {string} eventName
 * @param {string} reference
 * @param {string} [payload]
 * @returns {Promise<boolean>} true if THIS call owns the processing
 */
const claimWebhook = async (eventName, reference, payload) => {
  await pool.execute(
    `INSERT IGNORE INTO webhook_events (event, reference, payload) VALUES (?, ?, ?)`,
    [eventName, reference, payload || null]
  );
  const [claim] = await pool.execute(
    `UPDATE webhook_events
     SET processing_status = 'processing', attempts = attempts + 1, last_error = NULL,
         processed_at = CURRENT_TIMESTAMP
     WHERE event = ? AND reference = ? AND processing_status IN ('received', 'failed')`,
    [eventName, reference]
  );
  return claim.affectedRows === 1;
};

/** @param {string} eventName @param {string} reference */
const completeWebhook = async (eventName, reference) => {
  await pool.execute(
    `UPDATE webhook_events SET processing_status = 'processed', processed_at = CURRENT_TIMESTAMP
     WHERE event = ? AND reference = ?`,
    [eventName, reference]
  );
};

/**
 * @param {string} eventName
 * @param {string} reference
 * @param {unknown} error
 */
const failWebhook = async (eventName, reference, error) => {
  await pool.execute(
    `UPDATE webhook_events SET processing_status = 'failed', last_error = ?
     WHERE event = ? AND reference = ? AND processing_status = 'processing'`,
    [String(error?.message || error).slice(0, 500), eventName, reference]
  );
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

    // SECURITY FIX (V-09): encodeURIComponent the reference to prevent
    // same-host path injection (e.g. reference="../../balance" would
    // turn the URL into https://api.paystack.co/transaction/verify/../../balance).
    // Also validate reference format to reject obviously malicious input.
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(reference)) {
      return res.status(400).json({ success: false, message: 'Invalid reference format' });
    }
    const encodedRef = encodeURIComponent(reference);

    // V-09b: validate the URL we actually BUILD, not only the string we build
    // it from. The character class above forbids `/` but permits `.`, so a
    // reference of `..` still passed it — and WHATWG normalization collapsed
    // the URL below to https://api.paystack.co/transaction/, one level off the
    // verify prefix. Same host and no query string reachable (the class
    // refuses `?` too), so nothing could be read or leaked elsewhere, but the
    // "path injection prevented" claim was not true until this assertion:
    // after normalization the request must be byte-for-byte the request we
    // meant to make. A pattern over the input cannot see that; the URL can.
    const verifyUrl = new URL(`https://api.paystack.co/transaction/verify/${encodedRef}`);
    if (
      verifyUrl.origin !== 'https://api.paystack.co'
      || verifyUrl.pathname !== `/transaction/verify/${encodedRef}`
    ) {
      return res.status(400).json({ success: false, message: 'Invalid reference format' });
    }

    // Verify payment with Paystack
    const response = await axios.get(
      verifyUrl.href,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
        timeout: PAYSTACK_TIMEOUT_MS,
      }
    );

    const { data } = response.data;

    if (data.status === 'success') {
      // Fallback: if the webhook missed this order, mark it paid here.
      // The webhook_events idempotency guard prevents double-processing.
      const [existing] = await pool.execute(
        `SELECT id, userId, totalAmount, paymentStatus, orderStatus, refundReference, paymentReference, couponId, items, discount FROM orders WHERE paymentReference = ?`,
        [reference]
      );
      let orderMarkedPaid = false;
      if (existing.length > 1) {
        // A reference must map to exactly one order — more than one means a
        // reused/forged reference. Refuse to flip anything (the DB now also
        // enforces this with a UNIQUE key; this is the friendly error).
        return res.status(400).json({
          success: false,
          message: `Payment reference maps to ${existing.length} orders`,
        });
      }
      if (existing.length === 1) {
        const order = existing[0];

        // Ownership is enforced EVERY time an order is bound to this
        // reference — including when it is already paid. It used to run only
        // on the unpaid branch, so any authenticated user could read the
        // payer's Paystack customer block (email/name/phone) by posting a
        // reference whose order had already been flipped. Admins may verify
        // any reference (support tooling).
        if (order.userId !== req.user.id && req.user.role !== 'admin') {
          return res.status(403).json({ success: false, message: 'Order does not belong to this user' });
        }

        // Already paid: idempotent success receipt for the authorized owner.
        if (order.paymentStatus === 'paid') {
          return res.json({
            status: 'success',
            message: 'Payment verified successfully',
            data: {
              reference: data.reference,
              amount: data.amount / 100,
              currency: data.currency,
              channel: data.channel,
              paid_at: data.paid_at,
              customer: data.customer,
              orderMarkedPaid: false,
            },
          });
        }

        // Only when Paystack actually collected the full order amount may ANY
        // reconciliation proceed — including the terminal-order branch below,
        // which journals a successful collection and pushes a refund. Without
        // this check an attacker could attach a small successful charge's
        // reference to a large cancelled order and have the terminal branch
        // book order.totalAmount as collected (see audit). Mirrors the
        // webhook, which validates before its own terminal-order branch.
        const expectedKobo = Math.round(parseFloat(order.totalAmount) * 100);
        const paidKobo = parseInt(data.amount, 10);
        if (
          data.currency !== CHARGED_CURRENCY ||
          !Number.isFinite(paidKobo) ||
          paidKobo !== expectedKobo
        ) {
          console.error(
            `verify-paystack: amount/currency mismatch for ${reference} on order ${order.id}: ` +
            `paid ${paidKobo} ${data.currency}, expected ${expectedKobo} ${CHARGED_CURRENCY} — refusing to reconcile`
          );
          return res.status(400).json({
            success: false,
            message: 'Payment amount does not match the order total',
          });
        }

        // Terminal orders (cancelled, or refunded by any path) must never be
        // resurrected by a late or duplicate verification — and the captured
        // funds must never be silently dropped. Reconcile the verified charge
        // by refunding it through the shared claim path (validated above).
        if (
          order.orderStatus === 'cancelled' ||
          order.orderStatus === 'refunded' ||
          order.paymentStatus === 'refunded'
        ) {
          const outcome = await reconcileTerminalOrderCharge(order, data);
          return res.json({
            status: 'success',
            // 'refund-unknown' = the provider call did not return a definite
            // result, so the refund may still be in flight — same customer
            // message as a definitive failure. 'finalization-failed' means
            // the provider ACCEPTED the refund and only the DB write lagged,
            // so "initiated" is truthful.
            message: (outcome.action === 'refund-failed' || outcome.action === 'refund-unknown')
              ? 'Payment verified; the order was cancelled and the refund is delayed. Please contact support if it is not reflected shortly.'
              : 'Payment verified; the order was cancelled, so a refund has been initiated.',
            data: { reference: data.reference, orderMarkedPaid: false },
          });
        }

        // Flip exactly ONE order (this one), never every row sharing the
        // reference — before the UNIQUE key existed, two pending orders with
        // the same client-supplied reference were both marked paid by one
        // verified charge (double-spend).
        const [flipResult] = await pool.execute(
          `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', ${PAID_TRACKING_SET_SQL}, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND paymentReference = ? AND totalAmount = ? AND paymentStatus IN ('pending', 'failed') AND orderStatus NOT IN ('cancelled', 'refunded')`,
          // FV-1: pinned to the total validated above (no change in between).
          [order.id, reference, order.totalAmount]
        );
        const orderId = order.id;
        // Idempotency: only run the post-payment side effects (escrow hold,
        // stock decrement, coupon) if THIS call actually flipped the order.
        // If the webhook already marked it paid (dozens of rows updated? no —
        // one order per reference), affectedRows is 0 and we skip so stock and
        // coupon are not decremented twice.
        const flipped = flipResult.affectedRows > 0;
        if (flipped) {
          // Shared post-payment side effects (see the webhook): marked one by
          // one, finished by recoverIncompletePaidOrders if anything fails.
          const effects = await applyPaidOrderSideEffects(orderId, { source: 'verify', charge: data });
          if (!effects.complete) {
            console.error(` verify-paystack: order ${orderId} paid but side effects incomplete (recovery will retry): ${effects.errors.join('; ')}`);
          }
 console.log(` verify-paystack fallback: order ${orderId} marked paid`);
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
 console.warn(` Could not seed expected completion date: ${compErr.message}`);
          }
          // Receipt email — only when THIS call flipped the order, so a webhook
          // that already handled payment never sends a duplicate. Detached
          // (N-20 class): the flip is committed and the response must not be
          // sequenced by SMTP.
          void sendOrderConfirmationEmail(orderId).catch((emailErr) => {
            console.warn(` Could not send order confirmation email: ${emailErr.message}`);
          });
          orderMarkedPaid = true;
        }

        // Flip-path response. (This response was missing at HEAD — the route
        // fell out of the handler without ever writing to `res`, so a
        // SUCCESSFUL verify-fallback flip left the checkout request hanging
        // until the client timed out; `orderMarkedPaid` was the orphaned
        // evidence of the deleted response.) Ownership was proven above, so
        // echoing the verified receipt is safe. `orderMarkedPaid` is false
        // when the flip lost a race to the webhook between the SELECT above
        // and the UPDATE — the money state is still confirmed either way.
        return res.json({
          status: 'success',
          message: orderMarkedPaid
            ? 'Payment verified successfully'
            : 'Payment already confirmed',
          data: {
            reference: data.reference,
            amount: data.amount / 100,
            currency: data.currency,
            channel: data.channel,
            paid_at: data.paid_at,
            orderMarkedPaid,
          },
        });
      } else {
        // No order is bound to this reference. Do NOT echo the payer's
        // Paystack customer block: the caller has proven no association with
        // the transaction, so its PII is not theirs to read.
        res.json({
          status: 'success',
          message: 'Payment verified; no order is bound to this reference yet',
          data: { reference: data.reference, orderMarkedPaid: false },
        });
      }
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
 console.log(`⏸ Webhook already being processed/processed: ${event.event} ${reference}`);
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
          let validationError = null;
          // Set when the verified charge belongs to a TERMINAL order
          // (cancelled/refunded): reconciled by refund after the loop instead
          // of retried or dropped.
          let terminalOrder = null;
          // Set ONLY when this delivery's UPDATE actually flipped the order
          // to paid. The confirmation email keys off this flag, never off
          // orderFound/orderId: the convergence branch below sets those
          // without any flip happening here, and keying the email off them
          // sent a SECOND confirmation whenever the verify-paystack fallback
          // had already paid and emailed the order.
          let webhookFlippedOrderId = null;

          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const connection = await pool.getConnection();
            try {
              // Never flip an order to paid before validating the provider's
              // charge against the actual order: a webhook must confirm the
              // FULL order amount, in GHS. A reference must also map to exactly
              // one order — multiple matches means a reused/forged reference.
              const [preRows] = await connection.execute(
                `SELECT id, totalAmount, paymentStatus FROM orders WHERE paymentReference = ?`,
                [reference]
              );
              if (preRows.length > 1) {
                validationError = `Reference ${reference} maps to ${preRows.length} orders`;
                break;
              }
              if (preRows.length === 1) {
                const expectedKobo = Math.round(parseFloat(preRows[0].totalAmount) * 100);
                const paidKobo = parseInt(event.data?.amount, 10);
                if (
                  event.data?.currency !== CHARGED_CURRENCY ||
                  !Number.isFinite(paidKobo) ||
                  paidKobo !== expectedKobo
                ) {
                  validationError =
                    `Amount/currency mismatch for ${reference}: ` +
                    `paid ${paidKobo} ${event.data?.currency}, expected ${expectedKobo} ${CHARGED_CURRENCY} ` +
                    `(order ${preRows[0].id})`;
                  break;
                }
              }
              // FV-1: flip ONLY the row validated above, at the total validated
              // above. The flip used to be keyed by reference alone, so when
              // the SELECT found no order yet (the usual case — the reference
              // is PUT onto the order after the charge) validation was skipped
              // and an order bound in between was paid for any amount. No
              // validated row → nothing to flip; wait for the next attempt.
              const validated = preRows[0];
              const [result] = validated
                ? await connection.execute(
                  `UPDATE orders
                   SET paymentStatus = 'paid', orderStatus = 'processing', ${PAID_TRACKING_SET_SQL}, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ? AND paymentReference = ? AND totalAmount = ?
                     AND paymentStatus IN ('pending', 'failed') AND orderStatus NOT IN ('cancelled', 'refunded')`,
                  [validated.id, reference, validated.totalAmount]
                )
                : [{ affectedRows: 0 }];
              if (result.affectedRows > 0) {
                orderFound = true;
                // Resolve the orderId from the reference
                const [orderRows] = await connection.execute(
                  `SELECT id FROM orders WHERE paymentReference = ?`,
                  [reference]
                );
                if (orderRows.length > 0) {
                  orderId = orderRows[0].id;
                  // THIS delivery performed the paid flip — the only condition
                  // under which it may send a confirmation email. The side
                  // effects run AFTER this attempt's connection is released
                  // (FV-13, below the loop).
                  webhookFlippedOrderId = orderId;
                }
                break; // success, no more retries needed
              } else if (!validated) {
                // Nothing was validated on this attempt: an order bound since
                // the SELECT is examined (and amount-checked) on the next one.
                console.log(`⏳ Webhook: order not yet found for ${reference} (attempt ${attempt + 1}/${MAX_RETRIES})`);
              } else {
                const [[existingOrder]] = await connection.execute(
                  `SELECT id, paymentStatus, orderStatus, refundReference, totalAmount, paymentReference
                   FROM orders WHERE paymentReference = ?`, [reference]
                );
                // A verified-payment fallback may have completed the same
                // order between delivery attempts. Treat that as terminally
                // processed instead of retrying this webhook forever.
                // Deliberately sets orderFound WITHOUT touching
                // webhookFlippedOrderId: the flip (and the confirmation
                // email) belongs to whoever actually performed it.
                if (existingOrder?.paymentStatus === 'paid') {
                  orderFound = true;
                  break;
                }
                // Late charge on a TERMINAL order: the money moved at Paystack
                // but a cancelled/refunded order must never be resurrected.
                // Reconcile by pushing a real refund (shared idempotent claim)
                // instead of looping retries or silently dropping the funds.
                if (
                  existingOrder &&
                  (['cancelled', 'refunded'].includes(existingOrder.orderStatus) ||
                    existingOrder.paymentStatus === 'refunded')
                ) {
                  terminalOrder = existingOrder;
                  orderFound = true; // stop the create-wait retry loop
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

          // FV-13: post-payment work runs with NO connection held by this
          // delivery. It used to run inside the attempt above, holding that
          // attempt's pooled connection while applyPaidOrderSideEffects took
          // more from the same pool — pool-size concurrent paid flips could
          // each hold one and wait for another (hold-and-wait stall).
          if (webhookFlippedOrderId) {
            // Post-payment side effects (journal, escrow hold, platform
            // revenue, stock, coupon) through the shared routine: each is
            // marked only once applied, so a crash or DB error here is
            // finished by recoverIncompletePaidOrders — a redelivery of
            // this webhook cannot, because it will find the order paid.
            const effects = await applyPaidOrderSideEffects(webhookFlippedOrderId, { source: 'webhook', charge: event.data });
            if (!effects.complete) {
              console.error(` Webhook: order ${webhookFlippedOrderId} paid but side effects incomplete (recovery will retry): ${effects.errors.join('; ')}`);
            }
            console.log(` Webhook: order ${webhookFlippedOrderId} marked paid for reference ${reference}`);

            // For customised (custom-woven) orders, seed the expected
            // completion date = order start + longest productionTime among
            // customisable items, so the buyer sees how many days are left
            // to finish weaving. Only seed if not already set.
            try {
              const [[ordRow]] = await pool.execute(
                `SELECT expectedCompletionDate, created_at, items FROM orders WHERE id = ?`,
                [webhookFlippedOrderId]
              );
              if (ordRow && !ordRow.expectedCompletionDate) {
                const completion = computeExpectedCompletion(ordRow);
                if (completion) {
                  await pool.execute(
                    `UPDATE orders SET expectedCompletionDate = ? WHERE id = ? AND expectedCompletionDate IS NULL`,
                    [completion, webhookFlippedOrderId]
                  );
                }
              }
            } catch (compErr) {
              console.warn(` Could not seed expected completion date: ${compErr.message}`);
            }
          }

          if (terminalOrder) {
            // The charge is real but the order is terminal: refund it. On a
            // definitive provider rejection the claim is released and the
            // webhook is failed so Paystack's redelivery re-attempts the
            // refund. On 'refund-unknown' / 'finalization-failed' the claim
            // was KEPT (the refund may already exist at the provider), the
            // event is still failed for visibility, and the redelivery stands
            // down on the claim while reconcileStaleRefundClaims finalizes
            // from the provider's actual refund state.
            const outcome = await reconcileTerminalOrderCharge(terminalOrder, event.data || {});
            if (['refund-failed', 'refund-unknown', 'finalization-failed'].includes(outcome.action)) {
              console.error(` Webhook: late charge on terminal order ${terminalOrder.id} not finalized (${outcome.action}): ${outcome.error?.message || outcome.error}`);
              await pool.execute(
                `UPDATE webhook_events SET processing_status = 'failed', last_error = ?
                 WHERE event = ? AND reference = ?`,
                [`Late charge on terminal order ${terminalOrder.id}; ${outcome.action}: ${String(outcome.error?.message || outcome.error).slice(0, 300)}`, event.event, reference]
              );
              // Non-2xx so Paystack redelivers.
              return res.status(500).send('Refund reconciliation incomplete; retry webhook');
            }
            console.log(` Webhook: late charge on terminal order ${terminalOrder.id} reconciled (${outcome.action}) for reference ${reference}`);
          }
if (!orderFound) {
            if (validationError) {
 console.error(` ${validationError}`);
              await pool.execute(
                `UPDATE webhook_events SET processing_status = 'failed', last_error = ?
                 WHERE event = ? AND reference = ?`,
                [validationError.slice(0, 500), event.event, reference]
              );
              // 400 permanently rejects the charge so it is never replayed.
              return res.status(400).send('Payment does not match the order');
            }
 console.warn(` Webhook: no order found for reference ${reference} after ${MAX_RETRIES} retries`);
            await pool.execute(
              `UPDATE webhook_events SET processing_status = 'failed', last_error = ?
               WHERE event = ? AND reference = ?`,
              ['Order was not found after retry window', event.event, reference]
            );
            // A non-2xx makes Paystack retry later, when order creation may
            // have completed. The durable failed state avoids losing payment.
            return res.status(500).send('Order not ready; retry webhook');
          } else if (webhookFlippedOrderId) {
            // Receipt email — fires ONLY when the webhook itself performed
            // the paid flip (webhookFlippedOrderId). The convergence branch
            // above (fallback already paid the order) sets orderFound without
            // a flip; keying the email off orderFound/orderId used to send a
            // SECOND confirmation in exactly that case. Detached (N-20
            // class): Paystack's webhook response and the durable
            // processing_status write must never wait on SMTP.
            void sendOrderConfirmationEmail(webhookFlippedOrderId).catch((emailErr) => {
              console.warn(` Could not send order confirmation email: ${emailErr.message}`);
            });
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

      case 'charge.failed': {
        // Durable receipt (idempotent, no state machine): the order stays
        // 'pending' so the customer can retry with a fresh charge, but the
        // failure is recorded for ops visibility and reconciliation instead
        // of living only in stdout.
        const failedRef = event.data?.reference;
        if (failedRef) {
          await pool.execute(
            `INSERT IGNORE INTO webhook_events (event, reference, payload, processing_status, processed_at)
             VALUES (?, ?, ?, 'processed', CURRENT_TIMESTAMP)`,
            ['charge.failed', failedRef, JSON.stringify(event.data || null)]
          ).catch(() => { /* receipt is best-effort; never block the 200 */ });
        }
        console.log('Payment failed:', failedRef);
        break;
      }

case 'transfer.success': {
        const transferRef = event.data?.reference;
        if (transferRef) {
          if (!(await claimWebhook(event.event, transferRef, JSON.stringify(event.data || null)))) {
 console.log(`⏸ Duplicate/in-flight webhook ignored: ${event.event} ${transferRef}`);
            return res.status(200).send('Duplicate ignored');
          }
          try {
            const outcome = await settleTransferSuccess(transferRef, transferEvidence(event.data));
            if (outcome === 'unknown') {
              console.warn(`Transfer success has no payout attempt: ${transferRef}`);
            }
            await completeWebhook(event.event, transferRef);
 if (outcome !== 'unknown') console.log(` Transfer success: ${transferRef} (${outcome})`);
          } catch (error) {
            await failWebhook(event.event, transferRef, error);
            throw error; // → 500 so Paystack redelivers
          }
        }
        break;
      }

      case 'transfer.failed': {
        const transferRef = event.data?.reference;
        if (transferRef) {
          if (!(await claimWebhook(event.event, transferRef, JSON.stringify(event.data || null)))) {
 console.log(`⏸ Duplicate/in-flight webhook ignored: ${event.event} ${transferRef}`);
            return res.status(200).send('Duplicate ignored');
          }
          try {
            const outcome = await settleTransferFailed(transferRef, transferEvidence(event.data));
            if (outcome === 'unknown') {
              console.warn(`Transfer failed has no payout attempt: ${transferRef}`);
            }
            await completeWebhook(event.event, transferRef);
 if (outcome !== 'unknown') console.log(` Transfer failed settled: ${transferRef} (${outcome})`);
          } catch (error) {
            await failWebhook(event.event, transferRef, error);
            throw error; // → 500 so Paystack redelivers
          }
        }
        break;
      }

      case 'transfer.reversed': {
        const reversedRef = event.data?.reference;
        if (reversedRef) {
          if (!(await claimWebhook(event.event, reversedRef, JSON.stringify(event.data || null)))) {
 console.log(`⏸ Duplicate/in-flight webhook ignored: ${event.event} ${reversedRef}`);
            return res.status(200).send('Duplicate ignored');
          }
          try {
            const outcome = await settleTransferReversed(reversedRef, transferEvidence(event.data));
            if (outcome === 'unknown') {
              console.warn(`Transfer reversed has no payout attempt: ${reversedRef}`);
            }
            await completeWebhook(event.event, reversedRef);
 if (outcome !== 'unknown') console.log(` Transfer reversed settled: ${reversedRef} (${outcome})`);
          } catch (error) {
            await failWebhook(event.event, reversedRef, error);
            throw error; // → 500 so Paystack redelivers
          }
        }
        break;
      }

      // Paystack refunds are asynchronous: every refund path books the order
      // refunded when the refund REQUEST is accepted, so a refund that later
      // fails at the provider used to leave the order "refunded" with the
      // customer unpaid and nobody told. Record every refund event durably;
      // on refund.failed alert admins once (no automatic money or state
      // change — re-issuing is an operator decision, see the runbook).
      case 'refund.pending':
      case 'refund.processing':
      case 'refund.processed':
      case 'refund.failed': {
        const txRef = event.data?.transaction_reference ?? event.data?.transaction?.reference;
        const refundId = event.data?.refund_reference ?? event.data?.id ?? '';
        if (txRef) {
          const key = `${txRef}:${refundId}`.slice(0, 255);
          if (event.event !== 'refund.failed') {
            await pool.execute(
              `INSERT IGNORE INTO webhook_events (event, reference, payload, processing_status, processed_at)
               VALUES (?, ?, ?, 'processed', CURRENT_TIMESTAMP)`,
              [event.event, key, JSON.stringify(event.data || null)]
            );
            break;
          }
          if (!(await claimWebhook(event.event, key, JSON.stringify(event.data || null)))) {
            return res.status(200).send('Duplicate ignored');
          }
          try {
            const [[order]] = await pool.execute(
              `SELECT id, orderNumber, paymentStatus, refundReference FROM orders WHERE paymentReference = ? LIMIT 1`,
              [txRef]
            );
            const amount = Number(event.data?.amount);
            await recordFinancialEvent({
              eventType: 'refund.failed',
              direction: 'info',
              amount: Number.isFinite(amount) && amount > 0 ? amount / 100 : 0,
              orderId: order?.id ?? null,
              reference: txRef,
              providerReference: String(refundId || txRef),
              dedupeKey: `refund.failed:${key}`,
              payload: event.data || null,
            });
            await notifyAdmins(
              'Paystack refund FAILED — customer not refunded',
              `Paystack reports refund ${refundId || '(no id)'} for transaction ${txRef}` +
                `${order ? ` (order #${order.orderNumber || order.id}, now ${order.paymentStatus})` : ' (no matching order)'} ` +
                `as FAILED${Number.isFinite(amount) ? ` (GHS ${(amount / 100).toFixed(2)})` : ''}. ` +
                'The order may already show as refunded. Verify in the Paystack dashboard and refund the customer manually; ' +
                'do not re-run cancel/return on the order.',
              { link: order ? `/admin/orders/${order.id}` : '/admin/orders' }
            );
            await completeWebhook(event.event, key);
          } catch (error) {
            await failWebhook(event.event, key, error);
            throw error; // → 500 so Paystack redelivers
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
