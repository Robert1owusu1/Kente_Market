// FILE: backend/models/productModel.js
import pool from "../config/db.js";
import { toNonNegativeInt } from "../utils/nonNegativeInt.js";

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

// Customer-facing text columns searched by findAll/count.
const SEARCH_COLS = ['title', 'description', 'patternName', 'patternMeaning', 'culturalSignificance', 'tag', 'category'];

// P1 search: 'match' when a composite FULLTEXT index exists (MySQL prod —
// relevance-ranked, multi-column incl. description/pattern fields), else
// 'like' (this TiDB: per-word AND-of-ORs across the same columns, a strict
// recall upgrade over the old title/category/tag LIKE). Probed once per
// process; LIKE is the steady state where FULLTEXT is unavailable.
let searchMode = null;
// Words FULLTEXT cannot honour must be DROPPED, not required: MySQL returns
// nothing at all for a required stopword or for a token shorter than
// innodb_ft_min_token_size (measured on MySQL 8.4 — '+the kente' and '+k kente'
// both match 0 rows while '+kente' matches the kente rows). The stopword list
// lives in information_schema.INNODB_FT_DEFAULT_STOPWORD, which is
// MySQL/MariaDB-only; if it cannot be read we keep the LIKE path rather than
// promise per-word semantics we cannot keep.
let ftMinTokenSize = 3;
let ftStopwords = new Set();

const detectSearchMode = async (connection) => {
  if (searchMode) return searchMode;
  try {
    await connection.execute(
      `SELECT COUNT(*) AS n FROM product
       WHERE MATCH(title, description, patternName, patternMeaning, culturalSignificance, tag, category)
       AGAINST (? IN NATURAL LANGUAGE MODE)`,
      ['kente']
    );
    const [[minTok]] = await connection.execute(
      'SELECT @@innodb_ft_min_token_size AS minToken',
      []
    );
    const [stopWords] = await connection.execute(
      'SELECT word FROM information_schema.INNODB_FT_DEFAULT_STOPWORD',
      []
    );
    ftMinTokenSize = Number(minTok?.minToken) || 3;
    ftStopwords = new Set(stopWords.map((r) => String(r.word).toLowerCase()));
    searchMode = 'match';
  } catch {
    searchMode = 'like';
  }
  return searchMode;
};

/**
 * Builds the search predicate for product list/count queries.
 */
const searchPredicate = async (connection, search, alias) => {
  const words = String(search || '').split(/\s+/).map((w) => w.trim()).filter((w) => w.length > 0).slice(0, 8);
  if (words.length === 0) return { where: '', params: [], relevance: null };
  const pfx = alias ? `${alias}.` : '';
  if ((await detectSearchMode(connection)) === 'match') {
    const cols = SEARCH_COLS.map((c) => `${pfx}${c}`).join(', ');
    // EVERY indexable word must match (AND) — the contract the 'like' path and
    // tests/productSearch.test.js already enforce. The previous single
    // NATURAL-LANGUAGE MATCH OR'd the words together, so prod MySQL returned
    // the REDCLOTH row for 'REDCLOTH nosuchwordxyz' while the TiDB dev database
    // (no FULLTEXT, so 'like') did not: the same query meant two different
    // things depending on which database served it.
    const indexable = words.filter(
      (w) => w.length >= ftMinTokenSize && !ftStopwords.has(w.toLowerCase())
    );
    if (indexable.length > 0) {
      return {
        where: ` AND ${indexable
          .map(() => `MATCH(${cols}) AGAINST (? IN NATURAL LANGUAGE MODE)`)
          .join(' AND ')}`,
        // One parameter per word; callers spread these where `where` is
        // appended, so order is preserved.
        params: [...indexable],
        // Relevance stays a single inline expression so ORDER BY needs no extra
        // parameter. The value is quoted by JSON.stringify and the words were
        // split from user input on whitespace — never concatenated raw.
        relevance: `MATCH(${cols}) AGAINST (${JSON.stringify(words.join(' '))} IN NATURAL LANGUAGE MODE)`,
      };
    }
    // Nothing indexable (e.g. 'the', '4m'): FULLTEXT cannot answer that query
    // at all, so fall through to substring matching instead of returning an
    // empty page for a search that used to work.
  }
  const groups = [];
  const params = [];
  for (const w of words) {
    const term = `%${w}%`;
    groups.push(`(${SEARCH_COLS.map((c) => `${pfx}${c} LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < SEARCH_COLS.length; i++) params.push(term);
  }
  return { where: ` AND ${groups.join(' AND ')}`, params, relevance: null };
};

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
    this.isRentable = !!data.isRentable;
    this.rentPricePerDay = data.rentPricePerDay ? parseFloat(data.rentPricePerDay) : null;
  }

  /**
   * Public-safe projection for storefront/browse responses.
   *
   * Anything an anonymous shopper has no business seeing is stripped: vendor
   * margin fields (wholesalePrice / retailPrice / basePrice), inventory
   * internals (stock, lowStockThreshold, sku) and moderation state
   * (approvalStatus, approvalNote, approvedAt). Multi-vendor order math and the
   * vendor panel keep using the full model — only these public routes strip it.
   */
  toPublic() {
    const safe = { ...this };
    for (const key of [
      'basePrice', 'wholesalePrice', 'retailPrice',
      'stock', 'lowStockThreshold', 'sku',
      'approvalStatus', 'approvalNote', 'approvedAt',
    ]) {
      delete safe[key];
    }

    // Inventory UX: storefronts need to distinguish sold-out (0) and low stock
    // (1..5) to render honest badges, but the exact on-hand count is business
    // data. Expose a bucket that preserves that behaviour exactly — real counts
    // only for 0..5, anything healthier collapses to 6.
    const onHand = Number(this.stock) || 0;
    safe.stock = onHand <= 5 ? Math.max(0, onHand) : 6;

    return safe;
  }

 // Get all products with proper LIMIT/OFFSET handling
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
        // Admin `?approvalStatus=all` only: show products regardless of vendor
        // status, so a moderator can actually reach a suspended vendor's stock.
        allVendors = false,
      } = options;

      // Validate and sanitize limit and offset
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 1000));
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      let query = `SELECT p.*, v.businessName AS vendorBusinessName, v.status AS vendorStatus
                   FROM product p
                   LEFT JOIN vendors v ON v.userId = p.vendorId
                   WHERE 1=1`;
      const params = [];

      // SECURITY FIX (N-6, revised): a suspended or unapproved vendor's
      // products must not be visible or purchasable.
      //
      // The first version of this guard fired only on `!approvalStatus &&
      // !vendorId`, which is the wrong test: the PUBLIC controller always
      // passes approvalStatus='approved' (publicApprovalFilter defaults every
      // non-admin caller to it), so the guard was skipped on precisely the
      // path it was written for — while the admin view, which passes nothing,
      // applied it. Suspended vendors' stock was the public storefront.
      //
      // `OR p.vendorId IS NULL` is load-bearing, not a loophole. The join is a
      // LEFT JOIN, but a WHERE clause on the right-hand table collapses it
      // back into an INNER JOIN, so without it every platform product
      // (`vendorId IS NULL` — "NULL = platform product" per the column's own
      // comment) would vanish from listings: the trap findById already fell
      // into. A NULL vendor has no status that can be suspended.
      //
      // Bypassed only where visibility is not the question:
      //   * vendorId   — one vendor's own inventory, already scoped to them
      //   * moderation — the admin queue asking for pending/rejected, which
      //                  must display these products in order to act on them
      //   * allVendors — the admin `?approvalStatus=all` view
      const moderationView = Boolean(approvalStatus) && approvalStatus !== 'approved';
      if (!vendorId && !moderationView && !allVendors) {
        query += " AND (v.status = 'approved' OR p.vendorId IS NULL)";
      }

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

      // P1 search predicate (MATCH with relevance when indexed, extended LIKE otherwise)
      let relevanceOrder = '';
      if (search) {
        const pred = await searchPredicate(connection, search, 'p');
        query += pred.where;
        params.push(...pred.params);
        if (pred.relevance) relevanceOrder = pred.relevance + ' DESC, ';
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
      query += ` ORDER BY ${relevanceOrder}p.id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

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

 // Get product by ID
  static async findById(id) {
    let connection;
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid product ID');
      }

      connection = await pool.getConnection();

      // SECURITY FIX (N-6): Public product detail must require vendor status = 'approved'.
      // Admin/moderation/vendor-inventory queries use separate controllers that don't call this.
      //
      // The `OR p.vendorId IS NULL` is load-bearing, not a loophole. The join
      // is a LEFT JOIN, but a WHERE clause on the right-hand table turns it
      // back into an INNER JOIN — so `AND v.status = 'approved'` alone filtered
      // out every row whose vendorId is NULL, i.e. every platform product
      // (`vendorId INT NULL COMMENT 'Owner vendor; NULL = platform product'`).
      // Those rows showed up in listings (which do not apply this filter) and
      // then 404'd on their detail page, while `Product.create`/`update` —
      // which return this method's result — handed back null instead of the
      // row they had just written. A NULL vendor has no status that can be
      // suspended, so admitting it does not weaken N-6.
      const [rows] = await connection.execute(
        `SELECT p.*, v.businessName AS vendorBusinessName, v.status AS vendorStatus
         FROM product p
         LEFT JOIN vendors v ON v.userId = p.vendorId
         WHERE p.id = ? AND (v.status = 'approved' OR p.vendorId IS NULL)`,
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

 // NEW: Get trending products (sorted by rating and reviews)
  static async findTrending(options = {}) {
    let connection;
    try {
      connection = await pool.getConnection();

      const {
        limit = 5,
        offset = 0,
        approvalStatus = null,
        allVendors = false,
      } = options;

      // Validate limit and offset
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 5, 100));
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      // Query to get trending products
      // Trending = high rating + high reviews + recent
      const params = [];
      let approvalClause = '';
      if (approvalStatus) {
        approvalClause = ' AND p.approvalStatus = ?';
        params.push(approvalStatus);
      }
      // SECURITY FIX (N-6, revised): same predicate as findAll. The old test
      // was `!approvalStatus`, but the public trending caller passes
      // approvalStatus='approved' — so, exactly as in findAll, the guard never
      // ran for the public and ran for the admin.
      const moderationView = Boolean(approvalStatus) && approvalStatus !== 'approved';
      if (!moderationView && !allVendors) {
        approvalClause += " AND (v.status = 'approved' OR p.vendorId IS NULL)";
      }
      const query = `
        SELECT p.*, v.businessName AS vendorBusinessName, v.status AS vendorStatus
        FROM product p
        LEFT JOIN vendors v ON v.userId = p.vendorId
        WHERE 1=1${approvalClause}
        ORDER BY 
          (COALESCE(p.rating, 0) * 0.6 + (COALESCE(p.reviews, 0) / 100) * 0.4) DESC,
          p.id DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;

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
      console.error("DB Error (findTrending):", err.message);
      console.error("Stack:", err.stack);
      throw new Error(`Error fetching trending products: ${err.message}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

 // Create new product
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
          approvalStatus, approvalNote, approvedAt, stock, sku, lowStockThreshold,
          isRentable, rentPricePerDay
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          toNonNegativeInt(productData.reviews),
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
          toNonNegativeInt(productData.stock),
          productData.sku || null,
          toNonNegativeInt(productData.lowStockThreshold),
          productData.isRentable ? 1 : 0,
          productData.rentPricePerDay != null && productData.rentPricePerDay !== ''
            ? parseFloat(productData.rentPricePerDay)
            : null,
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

 // Update product
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
        'stock', 'sku', 'lowStockThreshold', 'isRentable', 'rentPricePerDay'
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
            'wholesalePrice', 'retailPrice', 'rentPricePerDay'
          ]);
          const intColumns = new Set(['reviews', 'stock', 'lowStockThreshold']);
          const boolColumns = new Set(['isCustomizable', 'featured', 'madeToOrder', 'isRentable']);
          if (jsonColumns.has(key)) {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] ? JSON.stringify(updateData[key]) : null);
          } else if (floatColumns.has(key)) {
            setClause.push(`${key} = ?`);
            values.push(updateData[key] !== null && updateData[key] !== '' ? parseFloat(updateData[key]) : null);
          } else if (intColumns.has(key)) {
            setClause.push(`${key} = ?`);
            values.push(toNonNegativeInt(updateData[key]));
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

 // Delete product
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

 // Get product count
  static async count(options = {}) {
    let connection;
    try {
      connection = await pool.getConnection();

      // N-6: count() had no vendors join at all, so once findAll starts
      // hiding suspended vendors' products the pagination total would still
      // include them — `hasMore` would stay true past the last real row and
      // `includeCount` would over-report. Same predicate, same join.
      // (uq_vendors_userId guarantees one vendors row per product, so the
      // LEFT JOIN cannot duplicate rows and inflate the count.)
      let query = `SELECT COUNT(*) as count
                     FROM product p
                     LEFT JOIN vendors v ON v.userId = p.vendorId
                    WHERE 1=1`;
      const params = [];

      const moderationView =
        Boolean(options.approvalStatus) && options.approvalStatus !== 'approved';
      if (!options.vendorId && !moderationView && !options.allVendors) {
        query += " AND (v.status = 'approved' OR p.vendorId IS NULL)";
      }

      if (options.category) {
        query += " AND p.category = ?";
        params.push(options.category);
      }

      if (options.featured !== null && options.featured !== undefined) {
        query += " AND p.featured = ?";
        params.push(options.featured ? 1 : 0);
      }

      if (options.search) {
        const pred = await searchPredicate(connection, options.search, 'p');
        query += pred.where;
        params.push(...pred.params);
      }

      if (options.approvalStatus) {
        query += " AND p.approvalStatus = ?";
        params.push(options.approvalStatus);
      }

      // NOTE (P0-1 fix): guard with explicit undefined checks so an absent
      // bound does not inject `price >= NaN`, which matches zero rows and
      // broke every includeCount pagination total.
      if (options.minPrice !== null && options.minPrice !== undefined) {
        query += " AND p.price >= ?";
        params.push(parseFloat(options.minPrice));
      }

      if (options.maxPrice !== null && options.maxPrice !== undefined) {
        query += " AND p.price <= ?";
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

 // Get unique categories
  // `null` still means "every status" (the admin `?approvalStatus=all` view),
  // but an OMITTED argument now means 'approved' rather than null. Anything
  // that forgets to pass a filter gets the safe answer — N-6's whole lesson is
  // that a visibility guard whose default is "show" fails open.
  static async getCategories(approvalStatus = 'approved') {
    let connection;
    try {
      connection = await pool.getConnection();

      const params = [];
      let clause = 'WHERE p.category IS NOT NULL';

      // N-6: the category facet list is a public product query too — a
      // suspended vendor's categories must not reach the storefront filter,
      // because they name stock the shopper cannot buy. Only the 'approved'
      // facet needs the guard; every other value (including null = "all") is a
      // moderation view that has to see everything in order to act on it.
      if (approvalStatus === 'approved') {
        clause += " AND (v.status = 'approved' OR p.vendorId IS NULL)";
      }

      if (approvalStatus) {
        clause += ' AND p.approvalStatus = ?';
        params.push(approvalStatus);
      }

      const from = `FROM product p
                      LEFT JOIN vendors v ON v.userId = p.vendorId
                     ${clause}`;
      const [rows] = params.length > 0
        ? await connection.execute(`SELECT DISTINCT p.category ${from} ORDER BY p.category`, params)
        : await connection.query(`SELECT DISTINCT p.category ${from} ORDER BY p.category`);

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