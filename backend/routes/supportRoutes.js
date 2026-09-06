import express from "express";
const router = express.Router();
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  createTicket,
  getMyTickets,
  listAllTickets,
  replyTicket,
  updateTicketStatus,
} from "../controllers/supportController.js";

// User-facing
router.route("/").get(protect, getMyTickets).post(protect, createTicket);

// Admin-facing
router.route("/all").get(protect, admin, listAllTickets);
router.route("/:id/reply").post(protect, admin, replyTicket);
router.route("/:id/status").put(protect, admin, updateTicketStatus);

export default router;
