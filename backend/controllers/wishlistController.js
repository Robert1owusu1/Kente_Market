// FILE LOCATION: backend/controllers/wishlistController.js
// DESCRIPTION: User wishlist operations
import Wishlist from "../models/wishlistModel.js";
import isValidId from "../utils/isValidId.js";

export const addToWishlist = async (req, res) => {
  try {
    const { productId } = req.body || {};
    if (!isValidId(productId)) {
      return res.status(400).json({ message: "Valid product id is required" });
    }

    await Wishlist.add(req.user.id, parseInt(productId));
    res.status(201).json({ message: "Added to wishlist" });
  } catch (error) {
    console.error("addToWishlist error:", error.message);
    res.status(500).json({ message: "Failed to add to wishlist" });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    if (!isValidId(req.params.productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const removed = await Wishlist.remove(req.user.id, parseInt(req.params.productId));
    if (!removed) {
      return res.status(404).json({ message: "Product not found in wishlist" });
    }
    res.json({ message: "Removed from wishlist" });
  } catch (error) {
    console.error("removeFromWishlist error:", error.message);
    res.status(500).json({ message: "Failed to remove from wishlist" });
  }
};

export const getMyWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.getUserWishlist(req.user.id);
    res.json(wishlist);
  } catch (error) {
    console.error("getMyWishlist error:", error.message);
    res.status(500).json({ message: "Failed to fetch wishlist" });
  }
};

export const checkWishlist = async (req, res) => {
  try {
    if (!isValidId(req.params.productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const inWishlist = await Wishlist.isInWishlist(req.user.id, parseInt(req.params.productId));
    res.json({ inWishlist });
  } catch (error) {
    console.error("checkWishlist error:", error.message);
    res.status(500).json({ message: "Failed to check wishlist" });
  }
};
