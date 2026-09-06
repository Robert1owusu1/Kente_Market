import express from "express";
const router = express.Router();
import { protect } from "../middleware/authMiddleware.js";
import { createDesign, getMyDesigns, updateDesign, deleteDesign } from "../controllers/designController.js";

router.route("/").get(protect, getMyDesigns).post(protect, createDesign);
router.route("/:id").put(protect, updateDesign).delete(protect, deleteDesign);

export default router;
