// FILE LOCATION: backend/controllers/notificationController.js
// DESCRIPTION: User notification management
import Notification from "../models/notificationModel.js";
import isValidId from "../utils/isValidId.js";

export const getMyNotifications = async (req, res) => {
  try {
    const { limit, unreadOnly } = req.query;
    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (unreadOnly === "true" || unreadOnly === "1") options.unreadOnly = true;

    const notifications = await Notification.findByUser(req.user.id, options);
    res.json(notifications);
  } catch (error) {
    console.error("getMyNotifications error:", error.message);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.getUnreadCount(req.user.id);
    res.json({ count });
  } catch (error) {
    console.error("getUnreadCount error:", error.message);
    res.status(500).json({ message: "Failed to fetch unread count" });
  }
};

export const markAsRead = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    const notification = await Notification.markAsRead(req.params.id, req.user.id);
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.json({ message: "Notification marked as read", notification });
  } catch (error) {
    console.error("markAsRead error:", error.message);
    res.status(500).json({ message: "Failed to mark notification as read" });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const updated = await Notification.markAllAsRead(req.user.id);
    res.json({ message: "All notifications marked as read", updated });
  } catch (error) {
    console.error("markAllAsRead error:", error.message);
    res.status(500).json({ message: "Failed to mark notifications as read" });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    const deleted = await Notification.delete(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.json({ message: "Notification deleted" });
  } catch (error) {
    console.error("deleteNotification error:", error.message);
    res.status(500).json({ message: "Failed to delete notification" });
  }
};

export const deleteAllNotifications = async (req, res) => {
  try {
    await Notification.deleteAllForUser(req.user.id);
    res.json({ message: "All notifications cleared" });
  } catch (error) {
    console.error("deleteAllNotifications error:", error.message);
    res.status(500).json({ message: "Failed to clear notifications" });
  }
};
