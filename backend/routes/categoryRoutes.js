// routes/categoryRoutes.js
import express from "express";
const router = express.Router();
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  getCategories,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";

// Public: active categories only
router.get("/", getCategories);

// Admin: all categories (including inactive)
router.get("/all", protect, admin, getAllCategories);

// Admin: create / update / delete
router.post("/", protect, admin, createCategory);
router.put("/:id", protect, admin, updateCategory);
router.delete("/:id", protect, admin, deleteCategory);

export default router;
