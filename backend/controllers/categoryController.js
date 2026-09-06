// controllers/categoryController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Category from "../models/categoryModel.js";

// @desc    Get active categories (public, for storefront filters & forms)
// @route   GET /api/categories
// @access  Public
export const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.findAll({ activeOnly: true });
  res.json(categories);
});

// @desc    Get all categories including inactive (admin)
// @route   GET /api/categories/all
// @access  Private/Admin
export const getAllCategories = asyncHandler(async (req, res) => {
  const categories = await Category.findAll({ activeOnly: false });
  res.json(categories);
});

// @desc    Create a category
// @route   POST /api/categories
// @access  Private/Admin
export const createCategory = asyncHandler(async (req, res) => {
  const { name, description, sortOrder, isActive } = req.body;
  if (!name || !String(name).trim()) {
    res.status(400);
    throw new Error("Category name is required");
  }
  const category = await Category.create({ name, description, sortOrder, isActive });
  res.status(201).json({ message: "Category created", category });
});

// @desc    Update a category (rename, reorder, activate/deactivate)
// @route   PUT /api/categories/:id
// @access  Private/Admin
export const updateCategory = asyncHandler(async (req, res) => {
  const { name, description, sortOrder, isActive } = req.body;
  const category = await Category.update(req.params.id, { name, description, sortOrder, isActive });
  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }
  res.json({ message: "Category updated", category });
});

// @desc    Delete a category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
export const deleteCategory = asyncHandler(async (req, res) => {
  const deleted = await Category.remove(req.params.id);
  if (!deleted) {
    res.status(404);
    throw new Error("Category not found");
  }
  res.json({ message: "Category deleted" });
});
