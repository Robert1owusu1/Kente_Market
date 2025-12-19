// FILE: backend/controllers/productController.js
import asyncHandler from "../midleware/asyncHandller.js";
import Product from "../models/productModel.js";

// @desc    Fetch all products with optional filters
// @route   GET /api/products
// @access  Public
const getProducts = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 GET /api/products - Fetching products...');
    
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit) : 100,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
      category: req.query.category || null,
      featured: req.query.featured !== undefined ? req.query.featured === 'true' : null,
      search: req.query.search || null,
      minPrice: req.query.minPrice || null,
      maxPrice: req.query.maxPrice || null,
    };

    console.log('📋 Query options:', options);

    const products = await Product.findAll(options);
    
    console.log(`✅ Successfully fetched ${products.length} products`);

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
    console.log(`🔍 GET /api/products/${req.params.id} - Fetching product...`);

    const product = await Product.findById(req.params.id);

    if (product) {
      console.log(`✅ Product found: ${product.title}`);
      res.json(product);
    } else {
      console.log(`❌ Product not found with ID: ${req.params.id}`);
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
    console.log(`🔍 GET /api/products/category/${req.params.category}`);

    const options = {
      limit: req.query.limit ? parseInt(req.query.limit) : 100,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    };

    const products = await Product.findByCategory(req.params.category, options);
    
    console.log(`✅ Found ${products.length} products in category: ${req.params.category}`);

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
    console.log('🔍 GET /api/products/featured');

    const options = {
      limit: req.query.limit ? parseInt(req.query.limit) : 10,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    };

    const products = await Product.findFeatured(options);
    
    console.log(`✅ Found ${products.length} featured products`);

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
    console.log('🔍 GET /api/products/trending');

    const options = {
      limit: req.query.limit ? parseInt(req.query.limit) : 5,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    };

    const products = await Product.findTrending(options);
    
    console.log(`✅ Found ${products.length} trending products`);

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
    console.log('➕ POST /api/products - Creating product...');
    console.log('Product data:', req.body);

    const product = await Product.create(req.body);
    
    console.log(`✅ Product created successfully: ${product.title}`);

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
    console.log(`🔄 PUT /api/products/${req.params.id} - Updating product...`);
    console.log('Update data:', req.body);

    const product = await Product.findById(req.params.id);

    if (!product) {
      console.log(`❌ Product not found with ID: ${req.params.id}`);
      res.status(404);
      throw new Error("Product not found");
    }

    const updatedProduct = await Product.update(req.params.id, req.body);
    
    console.log(`✅ Product updated successfully: ${updatedProduct.title}`);

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
    console.log(`🗑️  DELETE /api/products/${req.params.id} - Deleting product...`);

    const product = await Product.findById(req.params.id);

    if (!product) {
      console.log(`❌ Product not found with ID: ${req.params.id}`);
      res.status(404);
      throw new Error("Product not found");
    }

    await Product.delete(req.params.id);
    
    console.log(`✅ Product deleted successfully: ${product.title}`);

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
    console.log('🔍 GET /api/products/categories/list');

    const categories = await Product.getCategories();
    
    console.log(`✅ Found ${categories.length} categories`);

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
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
};