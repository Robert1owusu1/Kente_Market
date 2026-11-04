// FILE LOCATION: backend/controllers/platformRevenueController.js
// DESCRIPTION: Admin platform-earnings report — surfaces the money the platform
//   keeps (platform-product income + marketplace commission). Read-only.
import { getPlatformRevenueReport } from "../Services/platformRevenueService.js";

// @desc    Platform earnings over a date window (owner/partner dashboard)
// @route   GET /api/admin/platform-revenue?from=YYYY-MM-DD&to=YYYY-MM-DD
// @access  Private/Admin
export const getPlatformRevenue = async (req, res) => {
  try {
    const { from, to } = req.query || {};
    const report = await getPlatformRevenueReport({
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
    });
    res.json(report);
  } catch (error) {
    console.error("getPlatformRevenue error:", error.message);
    res.status(500).json({ message: "Failed to load platform revenue" });
  }
};
