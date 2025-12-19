import express from 'express';
import axios from 'axios';
import crypto from 'crypto';

const router = express.Router();

// Paystack Secret Key - Store in environment variables
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

/**
 * @route   POST /api/payments/verify-paystack
 * @desc    Verify Paystack payment
 * @access  Public
 */
router.post('/verify-paystack', async (req, res) => {
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
 * @access  Public (but verified)
 */
router.post('/paystack-webhook', async (req, res) => {
  try {
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash === req.headers['x-paystack-signature']) {
      const event = req.body;

      // Handle different event types
      switch (event.event) {
        case 'charge.success':
          console.log('Payment successful:', event.data.reference);
          // TODO: Update order status in database
          break;

        case 'charge.failed':
          console.log('Payment failed:', event.data.reference);
          break;

        case 'transfer.success':
          console.log('Transfer successful:', event.data.reference);
          break;

        case 'transfer.failed':
          console.log('Transfer failed:', event.data.reference);
          break;

        default:
          console.log('Unhandled event:', event.event);
      }

      res.status(200).send('Webhook received');
    } else {
      res.status(400).send('Invalid signature');
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook processing failed');
  }
});

/**
 * @route   GET /api/payments/paystack/banks
 * @desc    Get list of banks for Paystack
 * @access  Public
 */
router.get('/paystack/banks', async (req, res) => {
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