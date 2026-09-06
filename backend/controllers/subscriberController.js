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
  } catch {
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
  } catch {
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
    res.status(500).json({ message: "Failed to fetch subscribers" });
  }
};

// ✅ GET /api/subscribe/count - subscriber count (admin only)
export const getSubscriberCount = async (req, res) => {
  try {
    const subscribers = await Subscriber.findAll(10000);
    const count = subscribers.length;
    res.json({ count });
  } catch (error) {
    console.error("getSubscriberCount error:", error.message);
    res.status(500).json({ message: "Failed to fetch subscriber count" });
  }
};

// ✅ GET /api/subscribe/export - export subscribers as CSV (admin only)
export const exportSubscribers = async (req, res) => {
  try {
    const subscribers = await Subscriber.findAll(10000);

    const header = "ID,Email,Subscribed,Created At\n";
    const rows = subscribers
      .map((s) => `${s.id},"${(s.email || "").replace(/"/g, '""')}",${s.subscribed ? "Yes" : "No"},${s.created_at || ""}`)
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=subscribers.csv");
    res.send(header + rows);
  } catch (error) {
    console.error("exportSubscribers error:", error.message);
    res.status(500).json({ message: "Failed to export subscribers" });
  }
};
