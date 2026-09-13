// FILE: backend/models/productModel.js
import pool from "../config/db.js";

// Safe JSON/CSV parser
function safeParse(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value.split(",").map((v) => v.trim());
    }
  }
  return [value];
}

class Product {
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.img = data.img;
    this.rating = data.rating;
    this.price = data.price;
    this.originalPrice = data.originalPrice;
    this.color = data.color;
    this.category = data.category;
    this.sizes = data.sizes;
    this.printType = data.printType;
    this.material = data.material;
    this.reviews = data.reviews;
    this.isCustomizable = !!data.isCustomizable;
    this.colors = data.colors;
    this.threadTypes = data.threadTypes;
    this.dominantThread = data.dominantThread || null;
    this.tag = data.tag;
    this.fabricType = data.fabricType;
    this.productionTime = data.productionTime;
    this.featured = !!data.featured;
    this.basePrice = data.basePrice;
    this.vendorId = data.vendorId || null;
    this.description = data.description || null;
    this.vendorBusinessName = data.vendorBusinessName || null;
    this.vendorStatus = data.vendorStatus || null;
    // Kente-specific fields
    this.patternName = data.patternName || null;
    this.patternMeaning = data.patternMeaning || null;
    this.culturalSignificance = data.culturalSignificance || null;
    this.origin = data.origin || null;
    this.weavingTechnique = data.weavingTechnique || null;
    this.yards = data.yards ? parseFloat(data.yards) : null;
    this.occasions = data.occasions || null;
    this.designStory = data.designStory || null;
    this.careInstructions = data.careInstructions || null;
    this.weight = data.weight ? parseFloat(data.weight) : null;
    this.wholesalePrice = data.wholesalePrice ? parseFloat(data.wholesalePrice) : null;
    this.retailPrice = data.retailPrice ? parseFloat(data.retailPrice) : null;
    this.madeToOrder = !!data.madeToOrder;
    this.video = data.video || null;
    this.gallery = data.gallery || null;
    this.descriptionHTML = data.descriptionHTML || null;
    // Approval + inventory
    this.approvalStatus = data.approvalStatus || 'approved';
    this.approvalNote = data.approvalNote || null;
    this.approvedAt = data.approvedAt || null;
    this.stock = parseInt(data.stock) || 0;
    this.sku = data.sku || null;
    this.lowStockThreshold = parseInt(data.lowStockThreshold) || 0;
  }

  // ✅ Get all products with proper LIMIT/OFFSET handling
  static async findAll(options = {}) {
    let connection;
    try {
      connection = await pool.getConnection();

      const {
        limit = 100,
        offset = 0,
        category = null,
        featured = null,
        search = null,
        minPrice = null,
        maxPrice = null,
        approvalStatus = null,
        vendorId = null,
      } = options;

      // Validate and sanitize limit and offset
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 1000));
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      let query = `SELECT p.*, v.businessName AS vendorBusinessName, v.status AS vendorStatus
                   FROM product p
                   LEFT JOIN vendors v ON v.userId = p.vendorId
                   WHERE 1=1`;
      const params = [];

      // Filter by approval status (public listing = 'approved' only)
      if (approvalStatus) {
        query += " AND p.approvalStatus = ?";
        params.push(approvalStatus);
      }

      // Filter by owner vendor
      if (vendorId) {
        query += " AND p.vendorId = ?";
        params.push(parseInt(vendorId));
      }

      // Filter by category
      if (category) {
        query += " AND p.category = ?";
        params.push(category);
      }

      // Filter by featured
      if (featured !== null) {
        query += " AND p.featured = ?";
        params.push(featured ? 1 : 0);
      }

      // Search in title, category, or tag
      if (search) {
        query += " AND (p.title LIKE ? OR p.category LIKE ? OR p.tag LIKE ?)";
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      // Price range filters
      if (minPrice !== null) {
        query += " AND p.price >= ?";
        params.push(parseFloat(minPrice));
      }

      if (maxPrice !== null) {
        query += " AND p.price <= ?";
        params.push(parseFloat(maxPrice));
      }

      // Add LIMIT and OFFSET
      query += ` ORDER BY p.id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

      const [rows] = params.length > 0 
        ? await connection.execute(query, params)
        : await connection.query(query);

      return rows.map(
        (row) =>
          new Product({
            ...row,
            sizes: safeParse(row.sizes),
            colors: safeParse(row.colors),
            threadTypes: safeParse(row.threadTypes),
          })
      );
    } catch (err) {
      console.error("DB Error (findAll):", err.message);
      console.error("Stack:", err.stack);
      throw new Error(`Error fetching products: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // ✅ Get product by ID
  static async findById(id) {
    let connection;
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid product ID');
      }

      connection = await pool.getConnection();

      const [rows] = await connection.execute(
        `SELECT p.*, v.businessName AS vendorBusinessName, v.status AS vendorStatus
         FROM product p
         LEFT JOIN vendors v ON v.userId = p.vendorId
         WHERE p.id = ?`,
        [parseInt(id)]
      );

      if (rows.length === 0) return null;

      return new Product({
        ...rows[0],
        sizes: safeParse(rows[0].sizes),
        colors: safeParse(rows[0].colors),
        threadTypes: safeParse(rows[0].threadTypes),
      });
    } catch (err) {
      console.error("DB Error (findById):", err.message);
      throw new Error(`Error fetching product: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Get products by category
  static async findByCategory(category, options = {}) {
    return await Product.findAll({ ...options, category });
  }

  // Get featured products
  static async findFeatured(options = {}) {
    return await Product.findAll({ ...options, featured: true });
  }

  // ⭐ NEW: Get trending products (sorted by rating and reviews)
  static async findTrending(options = {}) {
    let connection;
    try {
      connection = await pool.getConnection();

      const {
        limit = 5,
        offset = 0,
      } = options;

      // Validate limit and offset
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 5, 100));
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      // Query to get trending products
      // Trending = high rating + high reviews + recent
      const query = `
        SELECT p.*, v.businessName AS vendorBusinessName, v.status AS vendorStatus
        FROM product p
        LEFT JOIN vendors v ON v.userId = p.vendorId
        WHERE 1=1
        ORDER BY 
          (COALESCE(p.rating, 0) * 0.6 + (COALESCE(p.reviews, 0) / 100) * 0.4) DESC,
          p.id DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;

      const [rows] = await connection.query(query);

      return rows.map(
        (row) =>
          new Product({
            ...row,
            sizes: safeParse(row.sizes),
            colors: safeParse(row.colors),
            threadTypes: safeParse(row.threadTypes),
          })
      );
    } catch (err) {
      console.error("DB Error (findTrending):", err.message);
      console.error("Stack:", err.stack);
      throw new Error(`Error fetching trending products: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // ✅ Create new product
  static async create(productData) {
    let connection;
    try {
      connection = await pool.getConnection();

      // Validate required fields
      if (!productData.title || productData.title.trim().length === 0) {
        throw new Error('Product title is required');
      }

      if (!productData.price || isNaN(productData.price) || parseFloat(productData.price) <= 0) {
        throw new Error('Valid product price is required');
      }

      const [result] = await connection.execute(
        `INSERT INTO product (
          title, img, rating, price, originalPrice, color, category, 
          sizes, printType, material, reviews, isCustomizable, colors, 
          tag, fabricType, productionTime, featured, basePrice, vendorId, description,
          patternName, patternMeaning, culturalSignificance, origin, weavingTechnique,
          yards, occasions, designStory, careInstructions, weight, wholesalePrice,
          retailPrice, madeToOrder, video, gallery, descriptionHTML,
          threadTypes, dominantThread,
          approvalStatus, approvalNote, approvedAt, stock, sku, lowStockThreshold
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          productData.title.trim(),
          productData.img || null,
          productData.rating ?? null,
          parseFloat(productData.price),
          productData.originalPrice ? parseFloat(productData.originalPrice) : null,
          productData.color || null,
          productData.category || null,
          JSON.stringify(productData.sizes || []),
          productData.printType || null,
          productData.material || null,
          parseInt(productData.reviews) || 0,
          productData.isCustomizable ? 1 : 0,
          JSON.stringify(productData.colors || []),
          productData.tag || null,
          productData.fabricType || null,
          productData.productionTime ?? null,
          productData.featured ? 1 : 0,
          productData.basePrice ? parseFloat(productData.basePrice) : 0,
          productData.vendorId || null,
          productData.description || null,
          productData.patternName || null,
          productData.patternMeaning || null,
          productData.culturalSignificance || null,
          productData.origin || null,
          productData.weavingTechnique || null,
          productData.yards ?? null,
          productData.occasions ? JSON.stringify(productData.occasions) : null,
          productData.designStory || null,
          productData.careInstructions || null,
          productData.weight ?? null,
          productData.wholesalePrice ?? null,
          productData.retailPrice ?? null,
          productData.madeToOrder ? 1 : 0,
          productData.video || null,
          productData.gallery ? JSON.stringify(productData.gallery) : null,
          productData.descriptionHTML || null,
          JSON.stringify(productData.threadTypes || []),
          productData.dominantThread || null,
          productData.approvalStatus || 'approved',
          productData.approvalNote || null,
          productData.approvedAt || null,
          parseInt(productData.stock) || 0,
          productData.sku || null,
          parseInt(productData.lowStockThreshold) || 0,
        ]
      );

      return await Product.findById(result.insertId);
    } catch (err) {
      console.error("DB Error (create):", err.message);

      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error('Product with this title already exists');
      }
      
      throw err;
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // ✅ Update product
  static async update(id, updateData) {
    let connection;
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid product ID');
      }

      connection = await pool.getConnection();

      // Only allow updates to known product columns (prevents arbitrary column
      // injection / tampering with fields outside the product schema).
      const allowedColumns = new Set([
        'title', 'img', 'rating', 'price', 'originalPrice', 'color', 'category',
        'sizes', 'printType', 'material', 'reviews', 'isCustomizable', 'colors',
        'tag', 'fabricType', 'productionTime', 'featured', 'basePrice', 'vendorId',
        'description',
        'threadTypes', 'dominantThread',
        'patternName', 'patternMeaning', 'culturalSignificance', 'origin',
        'weavingTechnique', 'yards', 'occasions', 'designStory', 'careInstructions',
        'weight', 'wholesalePrice', 'retailPrice', 'madeToOrder', 'video', 'gallery',
        'descriptionHTML', 'approvalStatus', 'approvalNote', 'approvedAt',
        'stock', 'sku', 'lowStockThreshold'
      ]);

      const setClause = [];
      const values = [];

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] !== undefined && allowedColumns.has(key)) {
          const jsonColumns = new Set([
            'sizes', 'colors', 'threadTypes', 'occasions', 'gallery'
          ]);
          const floatColumns = new Set([
            'price', 'originalPrice', 'basePrice', 'yards', 'weight',
            'wholesalePrice', 'retailPrice'
          ]);
          const intColumns = new Set(['reviews', 'stock', 'lowStockThreshold']);
          const boolColumns = new Set(['isCustomizable', 'featured', 'madeToOrder']);
          if (jsonColumns.has(key)) {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] ? JSON.stringify(updateData[key]) : null);
          } else if (floatColumns.has(key)) {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] !== null && updateData[key] !== '' ? parseFloat(updateData[key]) : null);
          } else if (intColumns.has(key)) {
            setClause.push(`${key} = ?`);
            values.push(parseInt(updateData[key]) || 0);
          } else if (boolColumns.has(key)) {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] ? 1 : 0);
          } else if (key === "vendorId") {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] ? parseInt(updateData[key]) : null);
          } else {
            setClause.push(`${key} = ?`);
            values.push(updateData[key]);
          }
        }
      });

      if (setClause.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(id));

      await connection.execute(
        `UPDATE product SET ${setClause.join(", ")} WHERE id = ?`,
        values
      );

      return await Product.findById(id);
    } catch (err) {
      console.error("DB Error (update):", err.message);
      throw new Error(`Error updating product: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // ✅ Delete product
  static async delete(id) {
    let connection;
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid product ID');
      }

      connection = await pool.getConnection();

      const [result] = await connection.execute(
        "DELETE FROM product WHERE id = ?",
        [parseInt(id)]
      );

      return result.affectedRows > 0;
    } catch (err) {
      console.error("DB Error (delete):", err.message);
      throw new Error(`Error deleting product: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // ✅ Get product count
  static async count(options = {}) {
    let connection;
    try {
      connection = await pool.getConnection();

      let query = "SELECT COUNT(*) as count FROM product WHERE 1=1";
      const params = [];

      if (options.category) {
        query += " AND category = ?";
        params.push(options.category);
      }

      if (options.featured !== null && options.featured !== undefined) {
        query += " AND featured = ?";
        params.push(options.featured ? 1 : 0);
      }

      if (options.search) {
        query += " AND (title LIKE ? OR category LIKE ? OR tag LIKE ?)";
        const searchTerm = `%${options.search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      if (options.minPrice !== null) {
        query += " AND price >= ?";
        params.push(parseFloat(options.minPrice));
      }

      if (options.maxPrice !== null) {
        query += " AND price <= ?";
        params.push(parseFloat(options.maxPrice));
      }

      const [rows] = params.length > 0
        ? await connection.execute(query, params)
        : await connection.query(query);

      return rows[0].count;
    } catch (err) {
      console.error("DB Error (count):", err.message);
      throw new Error(`Error counting products: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // ✅ Get unique categories
  static async getCategories() {
    let connection;
    try {
      connection = await pool.getConnection();

      const [rows] = await connection.query(
        "SELECT DISTINCT category FROM product WHERE category IS NOT NULL ORDER BY category"
      );

      return rows.map(row => row.category);
    } catch (err) {
      console.error("DB Error (getCategories):", err.message);
      throw new Error(`Error fetching categories: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  /**
   * Set a product's moderation status (admin approval workflow).
   * Also records the approval timestamp when approving.
   */
  static async setApproval(id, { status, note = null }) {
    let connection;
    try {
      if (!id || isNaN(id)) throw new Error('Invalid product ID');
      if (!['pending', 'approved', 'rejected', 'changes_requested'].includes(status)) {
        throw new Error('Invalid approval status');
      }

      connection = await pool.getConnection();
      const approvedAt = status === 'approved' ? new Date() : null;
      await connection.execute(
        `UPDATE product
         SET approvalStatus = ?, approvalNote = ?, approvedAt = ?
         WHERE id = ?`,
        [status, note, approvedAt, parseInt(id)]
      );
      return await Product.findById(id);
    } catch (err) {
      console.error("DB Error (setApproval):", err.message);
      throw new Error(`Error updating product approval: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
}

export default Product;