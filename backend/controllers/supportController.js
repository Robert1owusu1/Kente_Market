// controllers/supportController.js
import SupportTicket from "../models/supportTicketModel.js";
import isValidId from "../utils/isValidId.js";

export const createTicket = async (req, res) => {
  try {
    const { subject, category, message } = req.body || {};
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ message: "Subject is required" });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ message: "Message is required" });
    }
    const ticket = await SupportTicket.create(req.user.id, {
      subject: String(subject).trim(),
      category: category || 'general',
      message: String(message).trim(),
    });
    res.status(201).json({ message: "Support ticket submitted", ticket });
  } catch (error) {
    console.error("createTicket error:", error.message);
    res.status(500).json({ message: "Failed to submit support ticket" });
  }
};

export const getMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.findAllByUser(req.user.id);
    res.json(tickets);
  } catch (error) {
    console.error("getMyTickets error:", error.message);
    res.status(500).json({ message: "Failed to fetch tickets" });
  }
};

export const listAllTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.findAll();
    res.json(tickets);
  } catch (error) {
    console.error("listAllTickets error:", error.message);
    res.status(500).json({ message: "Failed to fetch tickets" });
  }
};

export const replyTicket = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid ticket id" });
    }
    const { reply } = req.body || {};
    if (!reply || !String(reply).trim()) {
      return res.status(400).json({ message: "Reply is required" });
    }
    const ticket = await SupportTicket.reply(parseInt(req.params.id), String(reply).trim());
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    res.json({ message: "Reply saved", ticket });
  } catch (error) {
    console.error("replyTicket error:", error.message);
    res.status(500).json({ message: "Failed to reply to ticket" });
  }
};

export const updateTicketStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid ticket id" });
    }
    const { status } = req.body || {};
    if (!['open', 'answered', 'closed'].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const ticket = await SupportTicket.setStatus(parseInt(req.params.id), status);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    res.json({ message: "Ticket status updated", ticket });
  } catch (error) {
    console.error("updateTicketStatus error:", error.message);
    res.status(500).json({ message: "Failed to update ticket status" });
  }
};
