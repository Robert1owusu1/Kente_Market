// FILE LOCATION: backend/controllers/giftCardController.js
// DESCRIPTION: Gift cards + store credit API (Phase 3, Step 7).
import pool from '../config/db.js';
import GiftCard from '../models/giftCardModel.js';
import {
  startGiftCardPurchase, redeemGiftCard, getStoreCreditBalance, payOrderWithStoreCredit,
  applyStoreCreditToOrder,
} from '../Services/giftCardService.js';

const userEmail = async (userId) => {
  const [[u]] = await pool.execute(`SELECT email FROM users WHERE id = ?`, [userId]);
  return u?.email || null;
};

// @desc    Buy a gift card → Paystack checkout URL
// @route   POST /api/gift-cards/purchase   { amount, recipientEmail, message? }
// @access  Private
export const purchaseGiftCard = async (req, res) => {
  try {
    const { amount, recipientEmail, message } = req.body || {};
    const result = await startGiftCardPurchase({
      purchaserUserId: req.user.id,
      purchaserEmail: await userEmail(req.user.id),
      amount,
      recipientEmail,
      message,
    });
    res.status(201).json(result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('purchaseGiftCard error:', error.message);
    res.status(status).json({ message: error.message || 'Failed to start gift card purchase' });
  }
};

// @desc    Redeem a gift card code into store credit
// @route   POST /api/gift-cards/redeem   { code }
// @access  Private
export const redeemGiftCardController = async (req, res) => {
  try {
    const result = await redeemGiftCard(req.user.id, req.body?.code);
    res.json({ message: 'Gift card redeemed', ...result });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('redeemGiftCard error:', error.message);
    res.status(status).json({ message: error.message || 'Failed to redeem gift card' });
  }
};

// @desc    Store credit balance + purchased-card history
// @route   GET /api/gift-cards/balance
// @access  Private
export const getStoreCredit = async (req, res) => {
  try {
    const balance = await getStoreCreditBalance(req.user.id);
    const purchased = await GiftCard.findByPurchaser(req.user.id);
    res.json({
      balance,
      purchased: purchased.map((c) => ({
        id: c.id,
        amount: c.initialAmount,
        status: c.status,
        recipientEmail: c.recipientEmail,
        // Never expose the code of an un-redeemed card to the purchaser via API
        // once issued — it was emailed to the recipient.
        createdAt: c.created_at,
      })),
    });
  } catch (error) {
    console.error('getStoreCredit error:', error.message);
    res.status(500).json({ message: 'Failed to load store credit' });
  }
};

// @desc    Apply store credit to PART of a pending order (Paystack pays the rest)
// @route   POST /api/gift-cards/apply-to-order   { orderId }
// @access  Private
export const applyStoreCreditToOrderController = async (req, res) => {
  try {
    const orderId = parseInt(req.body?.orderId, 10);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ message: 'Invalid order id' });
    const { status, body } = await applyStoreCreditToOrder({ userId: req.user.id, orderId });
    res.status(status).json(body);
  } catch (error) {
    console.error('applyStoreCreditToOrder error:', error.message);
    res.status(500).json({ message: 'Failed to apply store credit' });
  }
};

// @desc    Pay a whole pending order from store credit (final)
// @route   POST /api/gift-cards/pay-order   { orderId, acceptFinal: true }
// @access  Private
export const payOrderWithStoreCreditController = async (req, res) => {
  try {
    const orderId = parseInt(req.body?.orderId, 10);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ message: 'Invalid order id' });
    if (req.body?.acceptFinal !== true) {
      return res.status(400).json({ message: 'Orders paid with store credit are final and cannot be refunded to cash. Confirm to continue.', code: 'CONFIRM_FINAL' });
    }
    const { status, body } = await payOrderWithStoreCredit({ userId: req.user.id, orderId });
    res.status(status).json(body);
  } catch (error) {
    console.error('payOrderWithStoreCredit error:', error.message);
    res.status(500).json({ message: 'Payment with store credit failed' });
  }
};
