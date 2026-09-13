// FILE: backend/controllers/productController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Product from "../models/productModel.js";
import pool from "../config/db.js";
import { clearCache } from "../middleware/cacheMiddleware.js";

// @desc    Fetch curated Kente Museum pieces (approved products with pattern
//          provenance metadata), for the cultural showcase page.
// @route   GET /api/products/museum
// @access  Public
const getMuseumPieces = asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 24, 60));
  const [rows] = await pool.execute(
    `SELECT p.id, p.title, p.img, p.category, p.patternName, p.patternMeaning,
            p.culturalSignificance, p.origin, p.weavingTechnique, p.video,
            v.businessName AS vendorBusinessName
     FROM product p
     LEFT JOIN vendors v ON v.userId = p.vendorId
     WHERE p.approvalStatus = 'approved'
       AND (p.patternName IS NOT NULL AND p.patternName <> '')
     ORDER BY p.updated_at DESC
     LIMIT ${limit}`
  );
  res.json(rows);
});

// @desc    Fetch all products with optional filters
// @route   GET /api/products
// @access  Public
const getProducts = asyncHandler(async (req, res) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit) : 100,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
      category: req.query.category || null,
      featured: req.query.featured !== undefined ? req.query.featured === 'true' : null,
      search: req.query.search || null,
      minPrice: req.query.minPrice || null,
      maxPrice: req.query.maxPrice || null,
    };

    const products = await Product.findAll(options);

    // Optionally include total count for pagination
    if (req.query.includeCount === 'true') {
      const totalCount = await Product.count(options);
      res.json({
        products,
        pagination: {
          total: totalCount,
          limit: options.limit,
          offset: options.offset,
          hasMore: (options.offset + products.length) < totalCount
        }
      });
    } else {
      res.json(products);
    }
  } catch (error) {
    console.error('❌ Error in getProducts:', error.message);
    console.error('Stack:', error.stack);
    
    res.status(500);
    throw new Error(`Failed to fetch products: ${error.message}`);
  }
});

// @desc    Fetch a single product by ID
// @route   GET /api/products/:id
// @access  Public
const getProductById = asyncHandler(async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (product) {
      // "X verified orders" — only confirmed-purchase (delivered) reviews count
      // toward the trust badge shown next to a product's star rating.
      const [[verifiedRow]] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM reviews WHERE productId = ? AND isVerified = 1`,
        [product.id]
      );
      res.json({ ...product, verifiedReviewCount: verifiedRow?.cnt || 0 });
    } else {
      res.status(404);
      throw new Error("Product not found");
    }
  } catch (error) {
    console.error('❌ Error in getProductById:', error.message);
    
    if (res.statusCode === 404) {
      throw error;
    }
    
    res.status(500);
    throw new Error(`Failed to fetch product: ${error.message}`);
  }
});

// @desc    Get products by category
// @route   GET /api/products/category/:category
// @access  Public
const getProductsByCategory = asyncHandler(async (req, res) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit) : 100,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    };

    const products = await Product.findByCategory(req.params.category, options);

    res.json(products);
  } catch (error) {
    console.error('❌ Error in getProductsByCategory:', error.message);
    
    res.status(500);
    throw new Error(`Failed to fetch products by category: ${error.message}`);
  }
});

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
const getFeaturedProducts = asyncHandler(async (req, res) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit) : 10,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    };

    const products = await Product.findFeatured(options);

    res.json(products);
  } catch (error) {
    console.error('❌ Error in getFeaturedProducts:', error.message);
    
    res.status(500);
    throw new Error(`Failed to fetch featured products: ${error.message}`);
  }
});

// ⭐ NEW FUNCTION - Get trending products
// @desc    Get trending products (high ratings, recent, popular)
// @route   GET /api/products/trending
// @access  Public
const getTrendingProducts = asyncHandler(async (req, res) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit) : 5,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    };

    const products = await Product.findTrending(options);

    res.json(products);
  } catch (error) {
    console.error('❌ Error in getTrendingProducts:', error.message);
    
    res.status(500);
    throw new Error(`Failed to fetch trending products: ${error.message}`);
  }
});

// @desc    Create a new product
// @route   POST /api/products
// @access  Private/Admin
const createProduct = asyncHandler(async (req, res) => {
  try {
    const product = await Product.create(req.body);

    clearCache('products');
    res.status(201).json(product);
  } catch (error) {
    console.error('❌ Error in createProduct:', error.message);
    
    if (error.message.includes('required') || error.message.includes('already exists')) {
      res.status(400);
      throw error;
    }
    
    res.status(500);
    throw new Error(`Failed to create product: ${error.message}`);
  }
});

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = asyncHandler(async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      res.status(404);
      throw new Error("Product not found");
    }

    const updatedProduct = await Product.update(req.params.id, req.body);

    // Fast path for back-in-stock alerts (safety-net sweep also runs hourly).
    try {
      const { processRestockForProduct } = await import('../Services/wishlistRestockService.js');
      await processRestockForProduct(req.params.id);
    } catch (alertErr) {
      console.warn(`⚠️ Restock alert skipped: ${alertErr.message}`);
    }

    // Fast path for price-drop alerts (safety-net sweep also runs hourly).
    try {
      const { processPriceDropsForProduct } = await import('../Services/wishlistPriceDropService.js');
      await processPriceDropsForProduct(req.params.id);
    } catch (alertErr) {
      console.warn(`⚠️ Price-drop alert skipped: ${alertErr.message}`);
    }

    clearCache('products');
    res.json(updatedProduct);
  } catch (error) {
    console.error('❌ Error in updateProduct:', error.message);
    
    if (res.statusCode === 404) {
      throw error;
    }
    
    res.status(500);
    throw new Error(`Failed to update product: ${error.message}`);
  }
});

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
const deleteProduct = asyncHandler(async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      res.status(404);
      throw new Error("Product not found");
    }

    await Product.delete(req.params.id);

    clearCache('products');
    res.json({ message: "Product removed successfully" });
  } catch (error) {
    console.error('❌ Error in deleteProduct:', error.message);
    
    if (res.statusCode === 404) {
      throw error;
    }
    
    res.status(500);
    throw new Error(`Failed to delete product: ${error.message}`);
  }
});

// @desc    Get all unique categories
// @route   GET /api/products/categories/list
// @access  Public
const getCategories = asyncHandler(async (req, res) => {
  try {
    const categories = await Product.getCategories();

    res.json(categories);
  } catch (error) {
    console.error('❌ Error in getCategories:', error.message);
    
    res.status(500);
    throw new Error(`Failed to fetch categories: ${error.message}`);
  }
});

// ⭐ EXPORT ALL FUNCTIONS
export {
  getProducts,
  getProductById,
  getProductsByCategory,
  getFeaturedProducts,
  getTrendingProducts, // ⭐ NEW
  getMuseumPieces,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
};