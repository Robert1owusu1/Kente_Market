// FILE LOCATION: backend/controllers/reportController.js
// DESCRIPTION: Review report management (admin)
import ReviewReport from "../models/reportModel.js";
import isValidId from "../utils/isValidId.js";

export const createReport = async (req, res) => {
  try {
    const { reviewId, reason } = req.body || {};

    if (!isValidId(reviewId)) {
      return res.status(400).json({ message: "Valid review id is required" });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: "Reason for reporting is required" });
    }

    const alreadyReported = await ReviewReport.findByUserAndReview(reviewId, req.user.id);
    if (alreadyReported) {
      return res.status(400).json({ message: "You have already reported this review" });
    }

    const report = await ReviewReport.create({
      reviewId: parseInt(reviewId),
      userId: req.user.id,
      reason: reason.trim(),
    });

    res.status(201).json({ message: "Review reported successfully", report });
  } catch (error) {
    console.error("createReport error:", error.message);
    res.status(500).json({ message: "Failed to create report" });
  }
};

export const getAllReports = async (req, res) => {
  try {
    const reports = await ReviewReport.findAll();
    res.json(reports);
  } catch (error) {
    console.error("getAllReports error:", error.message);
    res.status(500).json({ message: "Failed to fetch reports" });
  }
};

export const updateReportStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid report id" });
    }

    const { status } = req.body || {};
    const validStatuses = ["pending", "resolved", "dismissed"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${validStatuses.join(", ")}` });
    }

    const report = await ReviewReport.updateStatus(req.params.id, status);
    res.json({ message: "Report status updated", report });
  } catch (error) {
    console.error("updateReportStatus error:", error.message);
    res.status(500).json({ message: "Failed to update report" });
  }
};
