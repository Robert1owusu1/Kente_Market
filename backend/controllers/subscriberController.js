// FILE LOCATION: backend/controllers/subscriberController.js
// DESCRIPTION: Newsletter subscription handling (save + email confirmation)
import Subscriber from "../models/subscriberModel.js";
import { sendSubscribeConfirmation } from "../utils/emailService.js";

// ✅ POST /api/subscribe - subscribe an email (public)
export const subscribe = async (req, res) => {
  try {
    const email = (req.body?.email || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "A valid email is required" });
    }
    if (email.length > 255) {
      return res.status(400).json({ message: "Email is too long" });
    }

    const subscriber = await Subscriber.create(email);

    sendSubscribeConfirmation(subscriber.email).catch(() => {});

    res.status(201).json({
      message: "Subscribed! You'll be notified about new Kente collections.",
      subscriber: { id: subscriber.id, email: subscriber.email },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to subscribe" });
  }
};

// POST /api/subscribe/unsubscribe - unsubscribe (public)
export const unsubscribe = async (req, res) => {
  try {
    const email = (req.body?.email || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "A valid email is required" });
    }
    await Subscriber.unsubscribe(email);
    // Always return the same message — never reveal whether email existed
    res.json({ message: "If this email was subscribed, it has been removed." });
  } catch (error) {
    res.status(500).json({ message: "Failed to process request" });
  }
};

// ✅ GET /api/subscribe - list subscribers (admin only)
export const listSubscribers = async (req, res) => {
  try {
    const subscribers = await Subscriber.findAll(req.query.limit);
    res.json(subscribers);
  } catch (error) {
    console.error("❌ listSubscribers error:", error.message);
    res.status(500).json({ message: error.message || "Failed to fetch subscribers" });
  }
};
