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
    this.tag = data.tag;
    this.fabricType = data.fabricType;
    this.productionTime = data.productionTime;
    this.featured = !!data.featured;
    this.basePrice = data.basePrice;
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
      } = options;

      // Validate and sanitize limit and offset
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 1000));
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      let query = "SELECT * FROM product WHERE 1=1";
      const params = [];

      // Filter by category
      if (category) {
        query += " AND category = ?";
        params.push(category);
      }

      // Filter by featured
      if (featured !== null) {
        query += " AND featured = ?";
        params.push(featured ? 1 : 0);
      }

      // Search in title, category, or tag
      if (search) {
        query += " AND (title LIKE ? OR category LIKE ? OR tag LIKE ?)";
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      // Price range filters
      if (minPrice !== null) {
        query += " AND price >= ?";
        params.push(parseFloat(minPrice));
      }

      if (maxPrice !== null) {
        query += " AND price <= ?";
        params.push(parseFloat(maxPrice));
      }

      // Add LIMIT and OFFSET
      query += ` ORDER BY id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

      console.log('Executing product query:', query);
      console.log('With params:', params);

      const [rows] = params.length > 0 
        ? await connection.execute(query, params)
        : await connection.query(query);

      console.log(`✅ Found ${rows.length} products`);

      return rows.map(
        (row) =>
          new Product({
            ...row,
            sizes: safeParse(row.sizes),
            colors: safeParse(row.colors),
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
        "SELECT * FROM product WHERE id = ?",
        [parseInt(id)]
      );

      if (rows.length === 0) return null;

      return new Product({
        ...rows[0],
        sizes: safeParse(rows[0].sizes),
        colors: safeParse(rows[0].colors),
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
        SELECT * FROM product 
        WHERE 1=1
        ORDER BY 
          (COALESCE(rating, 0) * 0.6 + (COALESCE(reviews, 0) / 100) * 0.4) DESC,
          id DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;

      console.log('Executing trending products query:', query);

      const [rows] = await connection.query(query);

      console.log(`✅ Found ${rows.length} trending products`);

      return rows.map(
        (row) =>
          new Product({
            ...row,
            sizes: safeParse(row.sizes),
            colors: safeParse(row.colors),
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

      if (!productData.price || isNaN(productData.price)) {
        throw new Error('Valid product price is required');
      }

      const [result] = await connection.execute(
        `INSERT INTO product (
          title, img, rating, price, originalPrice, color, category, 
          sizes, printType, material, reviews, isCustomizable, colors, 
          tag, fabricType, productionTime, featured, basePrice
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ]
      );

      console.log('Product created successfully with ID:', result.insertId);
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

      const setClause = [];
      const values = [];

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] !== undefined) {
          if (key === "sizes" || key === "colors") {
            setClause.push(`${key} = ?`);
            values.push(JSON.stringify(updateData[key]));
          } else if (key === "isCustomizable" || key === "featured") {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] ? 1 : 0);
          } else if (key === "price" || key === "originalPrice" || key === "basePrice") {
            setClause.push(`${key} = ?`);
            values.push(parseFloat(updateData[key]));
          } else if (key === "reviews") {
            setClause.push(`${key} = ?`);
            values.push(parseInt(updateData[key]));
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

      console.log('Product updated successfully:', id);
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

      console.log('Product deleted:', id);
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
}

export default Product;