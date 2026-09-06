import express from "express";
const router = express.Router();
import { protect } from "../middleware/authMiddleware.js";
import { getMyNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification, deleteAllNotifications } from "../controllers/notificationController.js";

router.route("/").get(protect, getMyNotifications).delete(protect, deleteAllNotifications);
router.route("/unread-count").get(protect, getUnreadCount); // BEFORE /:id
router.route("/mark-all-read").put(protect, markAllAsRead); // BEFORE /:id
router.route("/:id").put(protect, markAsRead).delete(protect, deleteNotification);
export default router;
