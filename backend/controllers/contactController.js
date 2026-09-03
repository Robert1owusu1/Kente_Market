// FILE LOCATION: backend/controllers/contactController.js
// DESCRIPTION: Contact Us form handling (save + email notification)
import Contact from "../models/contactModel.js";
import { sendContactConfirmation } from "../utils/emailService.js";

// ✅ POST /api/contact - submit a contact message (public)
export const submitContact = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ message: "Name is too long (max 100 characters)" });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: "A valid email is required" });
    }
    if (subject && subject.trim().length > 200) {
      return res.status(400).json({ message: "Subject is too long (max 200 characters)" });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }
    if (message.trim().length > 5000) {
      return res.status(400).json({ message: "Message is too long (max 5000 characters)" });
    }

    const contact = await Contact.create({ name, email, phone, subject, message });

    // Fire-and-forget confirmation email (does not block the response).
    sendContactConfirmation(contact.email, contact.name || "customer")
      .catch((e) => console.error("Contact confirmation email error:", e.message));

    res.status(201).json({
      message: "Message sent successfully! We'll get back to you soon.",
      contact,
    });
  } catch (error) {
    console.error("❌ submitContact error:", error.message);
    res.status(500).json({ message: error.message || "Failed to send message" });
  }
};

// ✅ GET /api/contact - list messages (admin only)
export const listContacts = async (req, res) => {
  try {
    const contacts = await Contact.findAll(req.query.limit);
    res.json(contacts);
  } catch (error) {
    console.error("❌ listContacts error:", error.message);
    res.status(500).json({ message: error.message || "Failed to fetch messages" });
  }
};
