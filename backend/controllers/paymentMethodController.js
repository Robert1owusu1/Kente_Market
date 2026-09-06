// controllers/paymentMethodController.js
import PaymentMethod from "../models/paymentMethodModel.js";
import isValidId from "../utils/isValidId.js";

export const addPaymentMethod = async (req, res) => {
  try {
    const { provider, type, cardBrand, last4, expMonth, expYear, authorizedCode, isDefault } = req.body || {};

    // A saved card requires a Paystack authorization code
    if (type === 'card' && !authorizedCode) {
      return res.status(400).json({ message: "Authorization code is required to save a card" });
    }
    if (type === 'mobile_money' && !last4 && !authorizedCode) {
      return res.status(400).json({ message: "Mobile money details are required" });
    }

    const method = await PaymentMethod.create(req.user.id, {
      provider, type, cardBrand, last4, expMonth, expYear, authorizedCode, isDefault,
    });
    const { authorizedCode: _omit, ...safe } = method;
    res.status(201).json({ message: "Payment method added", paymentMethod: safe });
  } catch (error) {
    console.error("addPaymentMethod error:", error.message);
    res.status(500).json({ message: "Failed to add payment method" });
  }
};

export const getMyPaymentMethods = async (req, res) => {
  try {
    const methods = await PaymentMethod.findAllByUser(req.user.id);
    res.json(methods);
  } catch (error) {
    console.error("getMyPaymentMethods error:", error.message);
    res.status(500).json({ message: "Failed to fetch payment methods" });
  }
};

export const setDefaultPaymentMethod = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid payment method id" });
    }
    const updated = await PaymentMethod.setDefault(req.user.id, parseInt(req.params.id));
    if (!updated) {
      return res.status(404).json({ message: "Payment method not found" });
    }
    const { authorizedCode: _omit, ...safe } = updated;
    res.json({ message: "Default payment method set", paymentMethod: safe });
  } catch (error) {
    console.error("setDefaultPaymentMethod error:", error.message);
    res.status(500).json({ message: "Failed to set default payment method" });
  }
};

export const deletePaymentMethod = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid payment method id" });
    }
    const removed = await PaymentMethod.remove(req.user.id, parseInt(req.params.id));
    if (!removed) {
      return res.status(404).json({ message: "Payment method not found" });
    }
    res.json({ message: "Payment method deleted" });
  } catch (error) {
    console.error("deletePaymentMethod error:", error.message);
    res.status(500).json({ message: "Failed to delete payment method" });
  }
};
