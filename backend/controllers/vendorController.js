// controllers/vendorController.js
import Vendor from '../models/vendorModel.js';
import Order from '../models/orderModel.js';
import pool from '../config/db.js';
import paystackServices from '../Services/paystackservices.js';
import { getWallet } from '../Services/walletService.js';
import { getAvailableAllocationsForVendor, payoutAllocation } from '../Services/escrowService.js';
import { PLATFORM_FEE_RATE } from '../config/businessConfig.js';
import { hasInvalidYards, INVALID_YARDS_MESSAGE } from '../utils/yards.js';
<<<<<<< HEAD
=======
import { toNonNegativeInt } from '../utils/nonNegativeInt.js';
import { clearCache } from '../middleware/cacheMiddleware.js';
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d

// Create a URL-safe slug from a business name (Ghanaian accents transliterated
// to ASCII; everything else stripped).
const slugify = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190);

// @desc    Apply to become a vendor / update bank details
// @route   POST /api/vendors/apply
// @access  Private
export const applyVendor = async (req, res) => {
  try {
    const { businessName, contactPhone, payoutType, bankName, accountNumber, bankCode, momoProvider, momoNumber } = req.body;

    if (!businessName) return res.status(400).json({ message: 'Business name is required' });

    const type = payoutType === 'momo' ? 'momo' : 'bank';

    if (type === 'momo') {
      if (!momoProvider || !momoNumber) {
        return res.status(400).json({ message: 'Mobile money provider and number are required' });
      }
    } else {
      if (!bankName || !accountNumber || !bankCode) {
        return res.status(400).json({ message: 'Bank details are required' });
      }
    }

    const recipientName = businessName;

    // Create (or reuse) a Paystack transfer recipient for the chosen payout method.
    // CRITICAL: If recipient creation fails, we must NOT silently create a vendor
    // with recipientCode=null — every future payout would permanently fail with no
    // notification. Instead, abort the application so the vendor can fix their
    // details and retry.
    let recipientCode = null;
    let recipientType = null;
    try {
      if (type === 'momo') {
        const recipient = await paystackServices.createMomoRecipient(recipientName, momoNumber, momoProvider);
        recipientCode = recipient?.data?.recipient_code || null;
        recipientType = 'mobile_money';
      } else {
        const recipient = await paystackServices.createTransferRecipient(
          'nuban',
          recipientName,
          accountNumber,
          bankCode
        );
        recipientCode = recipient?.data?.recipient_code || null;
        recipientType = 'nuban';
      }
    } catch (e) {
 console.error(` Recipient creation failed for vendor ${req.user.id}: ${e.message}`);
      // The Paystack error text can echo back submitted account details and
      // provider internals, so it is logged but not returned.
      return res.status(400).json({
        message: `Could not create a payout recipient with your ${type === 'momo' ? 'mobile money' : 'bank'} details. Please verify the information and try again.`,
      });
    }

    // Paystack responded but did not return a recipient code — treat as failure.
    if (!recipientCode) {
 console.error(` Paystack returned no recipient_code for vendor ${req.user.id}`);
      return res.status(400).json({
        message: 'Payment provider did not confirm a payout recipient. Please try again later.',
      });
    }

    const existing = await Vendor.findByUserId(req.user.id);

    // Build the payout fields based on the chosen type. Values from the
    // non-selected method are cleared so stale bank/momo data never lingers.
    const payoutFields = type === 'momo'
      ? { payoutType: 'momo', momoProvider, momoNumber, bankName: null, accountNumber: null, bankCode: null }
      : { payoutType: 'bank', bankName, accountNumber, bankCode, momoProvider: null, momoNumber: null };

    let vendor;
    if (existing) {
      // C5: do NOT reset `status` here. The old payload always wrote
      // status='pending' on a re-application, which had two consequences once
      // vendor paths started enforcing approval:
      //
      //   * an APPROVED store re-pended itself — its products then disappear
      //     from the storefront (N-6 hides everything not 'approved') and the
      //     owner is locked out of their own dashboard until an admin notices;
      //   * a SUSPENDED store re-pended itself, silently erasing the
      //     sanction. Suspension is the administrator's decision to lift, not
      //     the vendor's to reset by submitting a form again.
      //
      // A re-application from an existing store is a payout-detail update, not
      // a new application. Vendor.update skips `undefined`, so omitting the
      // field leaves whatever state the store is in untouched.
      vendor = await Vendor.update(existing.id, {
        businessName,
        contactPhone: contactPhone || existing.contactPhone,
        ...payoutFields,
        recipientCode: recipientCode || existing.recipientCode,
        recipientType: recipientType || existing.recipientType,
      });
    } else {
      vendor = await Vendor.create({
        userId: req.user.id,
        businessName,
        contactPhone,
        ...payoutFields,
        recipientCode,
        recipientType,
        platformFeeRate: PLATFORM_FEE_RATE,
        status: 'pending',
      });
      // Promote the user to the vendor role
      await pool.execute(`UPDATE users SET role = 'vendor' WHERE id = ?`, [req.user.id]);
    }

    res.status(201).json({
      message: 'Vendor application submitted for review',
      vendor,
    });
  } catch (error) {
    console.error('Error applying as vendor:', error);
    res.status(500).json({ message: 'Failed to apply as vendor' });
  }
};

// @desc    Get own vendor profile + escrow summary
// @route   GET /api/vendors/me
// @access  Private (vendor or admin)
export const getMyVendorProfile = async (req, res) => {
  try {
    const vendor = await Vendor.findByUserId(req.user.id);
    if (!vendor) {
      return res.status(404).json({ message: 'No vendor application found' });
    }
    const summary = await Vendor.getEscrowSummary(req.user.id);
    const payouts = await Vendor.getPayoutHistory(req.user.id);
    const walletTransactions = await Vendor.getWalletTransactions(req.user.id);
    res.json({ vendor, summary, payouts, walletTransactions });
  } catch (error) {
    console.error('Error fetching vendor profile:', error);
    res.status(500).json({ message: 'Failed to fetch vendor profile' });
  }
};

// @desc    List vendors
// @route   GET /api/vendors
// @access  Private/Admin
export const listVendors = async (req, res) => {
  try {
    const { status, search } = req.query;
    const vendors = await Vendor.findAll({ status, search });
    res.json(vendors);
  } catch (error) {
    console.error('Error listing vendors:', error);
    res.status(500).json({ message: 'Failed to list vendors' });
  }
};

// @desc    Change vendor status (approve / suspend)
// @route   PUT /api/vendors/:id/status
// @access  Private/Admin
export const updateVendorStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'suspended', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Invalid vendor status' });
    }

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    // Validation: do not approve a vendor whose payout details are broken.
    // Without a Paystack recipient_code, every future payout would silently
    // fail.
    if (status === 'approved') {
      const problems = [];
      if (!vendor.recipientCode) {
        problems.push('Paystack recipient code is missing');
      }
      if (vendor.payoutType === 'bank' && (!vendor.bankName || !vendor.accountNumber || !vendor.bankCode)) {
        problems.push('Bank details are incomplete');
      }
      if (vendor.payoutType === 'momo' && (!vendor.momoProvider || !vendor.momoNumber)) {
        problems.push('Mobile money details are incomplete');
      }
      if (problems.length > 0) {
        return res.status(400).json({
          message: `Cannot approve vendor: ${problems.join('; ')}. Ask the vendor to fix their payout details.`,
          problems,
        });
      }
    }

    const updatedVendor = await Vendor.update(req.params.id, { status });

    // N-6: suspending a vendor now hides their products from every public
    // query, but the product listing is served from the 'products' cache.
    // Without this the storefront kept handing out the suspended vendor's
    // stock until the TTL expired, and the database fix looked like it had
    // done nothing. productController already clears this key on every
    // product mutation; a vendor-status change moves all of their products at
    // once and was the one path that forgot.
    clearCache('products');

    // Keep the user's role in sync with their vendor status. Approving a
    // vendor promotes the user to 'vendor' so the vendor middleware lets them
    // in; suspending (or un-approving) drops them back to 'customer'.
    if (updatedVendor && updatedVendor.userId) {
      const role = status === 'approved' ? 'vendor' : 'customer';
      await pool.execute(`UPDATE users SET role = ? WHERE id = ?`, [role, updatedVendor.userId]);
    }

    res.json({ message: `Vendor ${status}`, vendor: updatedVendor });
  } catch (error) {
    console.error('Error updating vendor status:', error);
    res.status(500).json({ message: 'Failed to update vendor status' });
  }
};

// @desc    Get products belonging to the requesting vendor
// @route   GET /api/vendors/myproducts
// @access  Private (vendor or admin)
export const getMyProducts = async (req, res) => {
  try {
    // Every field the vendor edit form prefills must be present, otherwise a
    // vendor who only changes the price would save empty values over the
    // product's real description/colours/yard ladder/threads.
    const [rows] = await pool.execute(
      `SELECT id, title, img, price, originalPrice, category, tag, featured,
              isCustomizable, description, material, printType, productionTime,
              isRentable, madeToOrder, rentPricePerDay,
              colors, sizes, threadTypes, dominantThread,
              created_at, stock, sku, lowStockThreshold,
              approvalStatus, approvalNote,
              CASE
                WHEN stock = 0 THEN 'out_of_stock'
                WHEN lowStockThreshold > 0 AND stock <= lowStockThreshold THEN 'low_stock'
                ELSE 'in_stock'
              END AS stockStatus,
              (SELECT COUNT(*) FROM orders WHERE JSON_CONTAINS(items, JSON_OBJECT('productId', product.id))) AS salesCount
       FROM product
       WHERE vendorId = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching vendor products:', error);
    res.status(500).json({ message: 'Failed to fetch vendor products' });
  }
};

// @desc    Get a vendor's inventory summary (stock levels, alerts, SKUs)
// @route   GET /api/vendors/inventory
// @access  Private (vendor or admin)
export const getVendorInventory = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, title, sku, stock, lowStockThreshold,
              CASE
                WHEN stock = 0 THEN 'out_of_stock'
                WHEN lowStockThreshold > 0 AND stock <= lowStockThreshold THEN 'low_stock'
                ELSE 'in_stock'
              END AS stockStatus
       FROM product
       WHERE vendorId = ?
       ORDER BY stock ASC`,
      [req.user.id]
    );

    const lowStock = rows.filter((r) => r.stockStatus === 'low_stock').length;
    const outOfStock = rows.filter((r) => r.stockStatus === 'out_of_stock').length;
    const inStock = rows.filter((r) => r.stockStatus === 'in_stock').length;

    res.json({ items: rows, summary: { inStock, lowStock, outOfStock } });
  } catch (error) {
    console.error('Error fetching vendor inventory:', error);
    res.status(500).json({ message: 'Failed to fetch vendor inventory' });
  }
};

// @desc    Create a product which the vendor owns
// @route   POST /api/vendors/products
// @access  Private (approved vendor or admin)
export const createVendorProduct = async (req, res) => {
  try {
    const pendingVendor = await Vendor.findByUserId(req.user.id);
    if (req.user.role !== 'admin' && (!pendingVendor || pendingVendor.status !== 'approved')) {
      return res.status(403).json({ message: 'Vendor application must be approved to add products' });
    }

    const {
      title, img, price, category, tags, description,
      productionTime, material, printType, isCustomizable, colors, sizes,
      patternName, patternMeaning, culturalSignificance, origin, weavingTechnique,
      yards, occasions, designStory, careInstructions, weight, wholesalePrice,
      retailPrice, madeToOrder, video, gallery, sku, stock, lowStockThreshold,
<<<<<<< HEAD
      isRentable, rentPricePerDay, threadTypes, dominantThread,
=======
      isRentable, rentPricePerDay, threadTypes, dominantThread, advanceRatio,
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d
    } = req.body;

    if (!title || !img || !price || !category) {
      return res.status(400).json({ message: 'Title, image, price and category are required' });
    }

    // Kente is sold by the yard in even lengths only — reject odd/non-numeric
    // sizes (or legacy clothing sizes) even if the frontend check is bypassed.
    if (hasInvalidYards(sizes)) {
      return res.status(400).json({ message: INVALID_YARDS_MESSAGE });
    }

    // Vendor-created products enter the moderation queue (pending) unless the
    // platform admin is creating/inviting on behalf of the vendor.
    const isAdmin = req.user.role === 'admin';
    const approvalStatus = isAdmin ? 'approved' : 'pending';
    const approvedAt = isAdmin ? new Date() : null;
    const autoSku = sku || `BK-${req.user.id}-${Date.now().toString(36).toUpperCase()}`;

    const [result] = await pool.execute(
      `INSERT INTO product
        (title, img, price, category, tag, productionTime, material, printType,
         isCustomizable, colors, sizes, vendorId, description,
         patternName, patternMeaning, culturalSignificance, origin, weavingTechnique,
         yards, occasions, designStory, careInstructions, weight, wholesalePrice,
         retailPrice, madeToOrder, video, gallery,
         approvalStatus, approvalNote, approvedAt, stock, sku, lowStockThreshold,
<<<<<<< HEAD
         isRentable, rentPricePerDay, threadTypes, dominantThread)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
=======
         isRentable, rentPricePerDay, threadTypes, dominantThread, advanceRatio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d
      [
        title,
        img,
        parseFloat(price),
        category,
        tags || null,
        productionTime || 1,
        material || null,
        printType || null,
        isCustomizable ? 1 : 0,
        colors ? JSON.stringify(colors) : null,
        sizes ? JSON.stringify(sizes) : null,
        req.user.id,
        description || null,
        patternName || null,
        patternMeaning || null,
        culturalSignificance || null,
        origin || null,
        weavingTechnique || null,
        yards ?? null,
        occasions ? JSON.stringify(occasions) : null,
        designStory || null,
        careInstructions || null,
        weight ?? null,
        wholesalePrice ?? null,
        retailPrice ?? null,
        madeToOrder ? 1 : 0,
        video || null,
        gallery ? JSON.stringify(gallery) : null,
        approvalStatus,
        isAdmin ? null : 'Awaiting review by the platform team.',
        approvedAt,
        toNonNegativeInt(stock),
        autoSku,
<<<<<<< HEAD
        parseInt(lowStockThreshold) || 0,
=======
        toNonNegativeInt(lowStockThreshold),
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d
        isRentable ? 1 : 0,
        rentPricePerDay != null && rentPricePerDay !== '' ? parseFloat(rentPricePerDay) : null,
        threadTypes && threadTypes.length ? JSON.stringify(threadTypes) : null,
        dominantThread || null,
<<<<<<< HEAD
=======
        advanceRatio !== undefined && advanceRatio !== '' ? parseFloat(advanceRatio) : null,
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d
      ]
    );
    const [product] = await pool.execute(`SELECT * FROM product WHERE id = ?`, [result.insertId]);
    res.status(201).json({
      message: isAdmin ? 'Product created' : 'Product submitted for review',
      product: product[0],
    });
  } catch (error) {
    console.error('Error creating vendor product:', error);
    res.status(500).json({ message: 'Failed to create product' });
  }
};

// @desc    Update a product owned by the vendor
// @route   PUT /api/vendors/products/:id
// @access  Private (approved vendor — own products only)
export const updateVendorProduct = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    if (!productId) return res.status(400).json({ message: 'Invalid product ID' });

    const [[existing]] = await pool.execute(
      `SELECT id, vendorId FROM product WHERE id = ?`, [productId]
    );
    if (!existing) return res.status(404).json({ message: 'Product not found' });
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update this product' });
    }

    // Same even-yard rule as create: old odd/size values can't creep back in.
    if (hasInvalidYards(req.body.sizes)) {
      return res.status(400).json({ message: INVALID_YARDS_MESSAGE });
    }

    const allowedFields = [
      'title', 'img', 'price', 'originalPrice', 'category', 'tag', 'description',
      'productionTime', 'material', 'printType', 'isCustomizable', 'colors', 'sizes',
      'patternName', 'patternMeaning', 'culturalSignificance', 'origin', 'weavingTechnique',
      'yards', 'occasions', 'designStory', 'careInstructions', 'weight', 'wholesalePrice',
      'retailPrice', 'madeToOrder', 'video', 'gallery', 'stock', 'sku', 'lowStockThreshold',
      'isRentable', 'rentPricePerDay',
      'threadTypes', 'dominantThread',
<<<<<<< HEAD
=======
      'advanceRatio',
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d
    ];
    const sets = [];
    const values = [];
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        if (['colors', 'sizes', 'occasions', 'gallery', 'threadTypes'].includes(key)) {
          sets.push(`${key} = ?`);
          values.push(req.body[key] ? JSON.stringify(req.body[key]) : null);
        } else if (['isCustomizable', 'madeToOrder', 'isRentable'].includes(key)) {
          sets.push(`${key} = ?`);
          values.push(req.body[key] ? 1 : 0);
        } else if (['price', 'originalPrice', 'yards', 'weight', 'wholesalePrice', 'retailPrice', 'rentPricePerDay'].includes(key)) {
          sets.push(`${key} = ?`);
          values.push(req.body[key] !== '' && req.body[key] != null ? parseFloat(req.body[key]) : null);
        } else if (['stock', 'lowStockThreshold'].includes(key)) {
          sets.push(`${key} = ?`);
          values.push(toNonNegativeInt(req.body[key]));
        } else {
          sets.push(`${key} = ?`);
          values.push(req.body[key]);
        }
      }
    }
    if (sets.length === 0) return res.status(400).json({ message: 'No fields to update' });
    values.push(productId);
    await pool.execute(`UPDATE product SET ${sets.join(', ')} WHERE id = ?`, values);

    const [[updated]] = await pool.execute(`SELECT * FROM product WHERE id = ?`, [productId]);

    // Fast path for back-in-stock alerts (safety-net sweep also runs hourly).
    try {
      const { processRestockForProduct } = await import('../Services/wishlistRestockService.js');
      await processRestockForProduct(productId);
    } catch (alertErr) {
<<<<<<< HEAD
      console.warn(`⚠️ Restock alert skipped: ${alertErr.message}`);
=======
 console.warn(` Restock alert skipped: ${alertErr.message}`);
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d
    }

    // Fast path for price-drop alerts — notify wishlisted buyers who see a
    // lower price than the snapshot they saved.
    try {
      const { processPriceDropsForProduct } = await import('../Services/wishlistPriceDropService.js');
      await processPriceDropsForProduct(productId);
    } catch (alertErr) {
<<<<<<< HEAD
      console.warn(`⚠️ Price-drop alert skipped: ${alertErr.message}`);
=======
 console.warn(` Price-drop alert skipped: ${alertErr.message}`);
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d
    }

    res.json({ message: 'Product updated', product: updated });
  } catch (error) {
    console.error('Error updating vendor product:', error);
    res.status(500).json({ message: 'Failed to update product' });
  }
};

// @desc    Delete a product owned by the vendor
// @route   DELETE /api/vendors/products/:id
// @access  Private (approved vendor — own products only)
export const deleteVendorProduct = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    if (!productId) return res.status(400).json({ message: 'Invalid product ID' });

    const [[existing]] = await pool.execute(
      `SELECT id, vendorId FROM product WHERE id = ?`, [productId]
    );
    if (!existing) return res.status(404).json({ message: 'Product not found' });
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this product' });
    }

    await pool.execute(`DELETE FROM product WHERE id = ?`, [productId]);
    res.json({ message: 'Product deleted' });
  } catch (error) {
    console.error('Error deleting vendor product:', error);
    res.status(500).json({ message: 'Failed to delete product' });
  }
};

// @desc    Get vendor analytics (sales, top products, order stats)
// @route   GET /api/vendors/analytics
// @access  Private (vendor)
export const getVendorAnalytics = async (req, res) => {
  try {
    const vendorUserId = req.user.id;

    // Total products
    const [[productCount]] = await pool.execute(
      `SELECT COUNT(*) AS totalProducts FROM product WHERE vendorId = ?`, [vendorUserId]
    );

    // Orders containing vendor products.
    //
    // Line items MAY carry an inline vendorId, but many rows (anything written
    // before that field existed) don't — ownership is then derived from the
    // product's vendorId, exactly like the GET /api/vendors/orders list does.
    // Checking only the inline field made the dashboard disagree with the
    // Orders tab (6 vs 8 orders for the same vendor).
    const [ownedProducts] = await pool.execute(
      `SELECT id FROM product WHERE vendorId = ?`, [vendorUserId]
    );
    const ownedProductIds = new Set(ownedProducts.map(p => String(p.id)));
    const isVendorItem = (it) => {
      if (it.vendorId != null && parseInt(it.vendorId, 10) === vendorUserId) return true;
      return ownedProductIds.has(String(it.product ?? it.productId ?? it.id));
    };
    // Checkout lines store `qty` and custom-order lines store `quantity`
    // (some store both) — reading only `quantity` counted every standard
    // line as 1 and underreported revenue on multi-unit orders.
    const itemQty = (it) => parseInt(it.quantity ?? it.qty, 10) || 1;

    const [allOrders] = await pool.execute(
      `SELECT o.* FROM orders o ORDER BY o.created_at DESC`
    );
    const vendorOrders = allOrders.filter(o => {
      const items = Order.safeParse(o.items, []);
      return items.some(isVendorItem);
    });

    const totalOrders = vendorOrders.length;
    const paidOrders = vendorOrders.filter(o => o.paymentStatus === 'paid');
    const totalRevenue = paidOrders.reduce((sum, o) => {
      const items = Order.safeParse(o.items, []);
      const vendorItems = items.filter(isVendorItem);
      return sum + vendorItems.reduce((s, it) => s + (parseFloat(it.price) || 0) * itemQty(it), 0);
    }, 0);
    const avgOrderValue = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0;

    const pendingOrders = vendorOrders.filter(o => o.orderStatus === 'pending').length;
    const processingOrders = vendorOrders.filter(o => o.orderStatus === 'processing').length;
    const deliveredOrders = vendorOrders.filter(o => o.orderStatus === 'delivered').length;
    const cancelledOrders = vendorOrders.filter(o => o.orderStatus === 'cancelled').length;

    const ordersByStatus = [
      { name: 'Pending', value: pendingOrders },
      { name: 'Processing', value: processingOrders },
      { name: 'Delivered', value: deliveredOrders },
      { name: 'Cancelled', value: cancelledOrders },
    ].filter(item => item.value > 0);

    // Sales chart data (last 8 months)
    const now = new Date();
    const monthsData = {};
    for (let i = 7; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = date.toLocaleString('default', { month: 'short' });
      monthsData[monthKey] = { month: monthKey, sales: 0, orders: 0 };
    }
    vendorOrders.forEach(o => {
      const monthKey = new Date(o.created_at).toLocaleString('default', { month: 'short' });
      if (monthsData[monthKey]) {
        if (o.paymentStatus === 'paid') {
          const items = Order.safeParse(o.items, []);
          const vendorItems = items.filter(isVendorItem);
          monthsData[monthKey].sales += vendorItems.reduce((s, it) => s + (parseFloat(it.price) || 0) * itemQty(it), 0);
        }
        monthsData[monthKey].orders += 1;
      }
    });

    // Top products
    const productSales = {};
    vendorOrders.forEach(o => {
      if (o.paymentStatus === 'paid') {
        const items = Order.safeParse(o.items, []);
        items.filter(isVendorItem).forEach(it => {
          // Custom lines also carry `product` (their base product) — keying
          // them by it would merge one-off custom orders into the base
          // product's row. Group custom lines by their own name instead.
          const key = it.customRequestId != null
            ? `custom:${it.name || it.title}`
            : (it.product ?? it.productId ?? it.id ?? it.name);
          if (!productSales[key]) productSales[key] = { name: it.name || it.title, quantity: 0, revenue: 0 };
          productSales[key].quantity += itemQty(it);
          productSales[key].revenue += (parseFloat(it.price) || 0) * itemQty(it);
        });
      }
    });
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Wallet summary
    const [[wallet]] = await pool.execute(
      `SELECT available_balance, total_earned, total_withdrawn FROM vendor_wallets WHERE vendorId = ?`,
      [vendorUserId]
    );

    res.json({
      totalProducts: productCount.totalProducts,
      totalOrders,
      totalRevenue,
      avgOrderValue,
      pendingOrders,
      processingOrders,
      deliveredOrders,
      cancelledOrders,
      ordersByStatus,
      salesChartData: Object.values(monthsData),
      topProducts,
      wallet: wallet || { available_balance: 0, total_earned: 0, total_withdrawn: 0 },
    });
  } catch (error) {
    console.error('Error fetching vendor analytics:', error);
    res.status(500).json({ message: 'Failed to fetch vendor analytics' });
  }
};

// @desc    Get reviews on vendor's products
// @route   GET /api/vendors/reviews
// @access  Private (vendor)
export const getVendorReviews = async (req, res) => {
  try {
    const vendorUserId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT r.*, u.firstName, u.lastName, u.profile_picture, p.title AS productTitle
       FROM reviews r
       LEFT JOIN users u ON u.id = r.userId
       LEFT JOIN product p ON p.id = r.productId
       WHERE p.vendorId = ?
       ORDER BY r.created_at DESC`,
      [vendorUserId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching vendor reviews:', error);
    res.status(500).json({ message: 'Failed to fetch vendor reviews' });
  }
};

// @desc    Get returns for vendor's products
// @route   GET /api/vendors/returns
// @access  Private (vendor)
export const getVendorReturns = async (req, res) => {
  try {
    const vendorUserId = parseInt(req.user.id, 10);
    // Candidate returns: inline item.vendorId match (new orders) OR any of
    // the vendor's products referenced by the order lines (legacy orders that
    // predate the inline field — the same LIKE prefilter technique as the
    // vendor orders list; the JS ownership check below stays authoritative).
    const clauses = [];
    const params = [];
    const pushLikes = (key, value) => {
      for (const pattern of [`%"${key}":${value}%`, `%"${key}": ${value}%`]) {
        clauses.push(`o.items LIKE ?`);
        params.push(pattern);
      }
    };
    if (Number.isFinite(vendorUserId)) {
      pushLikes('vendorId', vendorUserId);
      try {
        const [owned] = await pool.execute(
          `SELECT id FROM product WHERE vendorId = ? LIMIT 300`,
          [vendorUserId]
        );
        for (const prod of owned) {
          pushLikes('product', prod.id);
          pushLikes('productId', prod.id);
        }
      } catch {
        // product table unavailable — inline match only
      }
    }
    const where = clauses.length > 0 ? `WHERE (${clauses.join(' OR ')})` : 'WHERE 1=0';
    const [rows] = await pool.execute(
      `SELECT rr.*, o.orderNumber, o.items, u.firstName
       FROM return_requests rr
       LEFT JOIN orders o ON o.id = rr.orderId
       LEFT JOIN users u ON u.id = rr.userId
       ${where}
       ORDER BY rr.created_at DESC`,
      params
    );
    // Authoritative ownership: keep returns whose order holds at least one of
    // the caller's lines (inline vendorId wins, else the product row).
    const pids = [...new Set(
      rows.flatMap((r) => {
        let items = r.items;
        if (typeof items === 'string') {
          try { items = JSON.parse(items); } catch { return []; }
        }
        return Array.isArray(items) ? items : [];
      }).map((it) => it.product ?? it.productId ?? it.id).filter((v) => v != null)
    )];
    const productVendor = new Map();
    if (pids.length > 0) {
      const placeholders = pids.map(() => '?').join(', ');
      const [prows] = await pool.execute(
        `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
        pids
      );
      for (const pr of prows) productVendor.set(String(pr.id), parseInt(pr.vendorId, 10));
    }
    const parseItems = (raw) => {
      let items = raw;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch { return []; }
      }
      return Array.isArray(items) ? items : [];
    };
    const projected = [];
    for (const r of rows) {
      const items = parseItems(r.items);
      const own = items.filter((it) => {
        if (it.vendorId != null && parseInt(it.vendorId, 10) === vendorUserId) return true;
        return productVendor.get(String(it.product ?? it.productId ?? it.id)) === vendorUserId;
      });
      if (own.length === 0) continue;
      // P0-2-class redaction (same policy as the vendor orders list): own
      // lines only, no order total, no buyer surname/email/addresses.
      projected.push({
        id: r.id,
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        firstName: r.firstName || null,
        reason: r.reason,
        description: r.description,
        status: r.status,
        adminNotes: r.adminNotes || null,
        created_at: r.created_at,
        items: own.map((it) => ({
          product: it.product ?? it.productId ?? it.id ?? null,
          name: it.name || it.title || 'Product',
          qty: parseInt(it.qty ?? it.quantity, 10) || 1,
          price: Number(it.price) || 0,
        })),
      });
    }
    res.json(projected);
  } catch (error) {
    console.error('Error fetching vendor returns:', error);
    res.status(500).json({ message: 'Failed to fetch vendor returns' });
  }
};

// @desc    Get vendor's coupons
// @route   GET /api/vendors/coupons
// @access  Private (vendor)
export const getVendorCoupons = async (req, res) => {
  try {
    const vendorUserId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT * FROM coupons WHERE vendorId = ? ORDER BY created_at DESC`,
      [vendorUserId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching vendor coupons:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Create a vendor coupon
// @route   POST /api/vendors/coupons
// @access  Private (vendor)
export const createVendorCoupon = async (req, res) => {
  try {
    const vendorUserId = req.user.id;
    const { code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive } = req.body;

    if (!code || !/^[a-zA-Z0-9]{3,50}$/.test(code.trim())) {
      return res.status(400).json({ message: 'Code must be 3-50 alphanumeric characters' });
    }
    if (!discountType || !['percentage', 'fixed'].includes(discountType)) {
      return res.status(400).json({ message: "Discount type must be 'percentage' or 'fixed'" });
    }
    if (discountValue === undefined || isNaN(discountValue) || parseFloat(discountValue) <= 0) {
      return res.status(400).json({ message: 'Discount value must be greater than 0' });
    }
    // Vendors may not issue near-free coupons: escrow is now allocated net of
    // discounts (so the platform can no longer be driven negative per order),
    // but a 90% vendor coupon still underprices the catalogue and undercuts
    // other vendors. Platform (admin) coupons are not subject to this cap.
    if (discountType === 'percentage' && parseFloat(discountValue) > 50) {
      return res.status(400).json({ message: 'Vendor percentage coupons are capped at 50%' });
    }

    const [result] = await pool.execute(
      `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive, vendorId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code.toUpperCase().trim(),
        discountType,
        parseFloat(discountValue),
        parseFloat(minPurchase) || 0,
        maxUses ? parseInt(maxUses) : null,
        expiresAt || null,
        isActive !== undefined ? (isActive ? 1 : 0) : 1,
        vendorUserId,
      ]
    );
    const [[coupon]] = await pool.execute(`SELECT * FROM coupons WHERE id = ?`, [result.insertId]);
    res.status(201).json({ message: 'Coupon created', coupon });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Coupon with this code already exists' });
    }
    console.error('Error creating vendor coupon:', error);
    res.status(500).json({ message: 'Failed to create coupon' });
  }
};

// @desc    Update a vendor coupon
// @route   PUT /api/vendors/coupons/:id
// @access  Private (vendor — own coupons only)
export const updateVendorCoupon = async (req, res) => {
  try {
    const couponId = parseInt(req.params.id);
    const [[existing]] = await pool.execute(
      `SELECT id, vendorId, discountType, discountValue FROM coupons WHERE id = ?`,
      [couponId]
    );
    if (!existing) return res.status(404).json({ message: 'Coupon not found' });
    // Platform (vendorId NULL) coupons are admin-owned — a vendor may only touch
    // their own coupons. The old `existing.vendorId &&` check was falsy for NULL,
    // which let any vendor modify/delete global coupons (broken access control).
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Same vendor cap as createVendorCoupon: a vendor-owned percentage coupon
    // may not exceed 50% (admin/platform coupons are unrestricted). Evaluate
    // the EFFECTIVE values so sending only one of the two fields can't sneak
    // a >50% coupon through.
    if (existing.vendorId != null) {
      const nextType = req.body.discountType !== undefined ? req.body.discountType : existing.discountType;
      const nextValue = req.body.discountValue !== undefined
        ? parseFloat(req.body.discountValue)
        : parseFloat(existing.discountValue);
      if (nextType === 'percentage' && Number.isFinite(nextValue) && nextValue > 50) {
        return res.status(400).json({ message: 'Vendor percentage coupons are capped at 50%' });
      }
    }

    const allowedColumns = ['discountType', 'discountValue', 'minPurchase', 'maxUses', 'expiresAt', 'isActive'];
    const sets = [];
    const vals = [];
    for (const key of allowedColumns) {
      if (req.body[key] !== undefined) {
        if (key === 'isActive') {
          sets.push(`${key} = ?`);
          vals.push(req.body[key] ? 1 : 0);
        } else if (key === 'discountValue' || key === 'minPurchase') {
          sets.push(`${key} = ?`);
          vals.push(parseFloat(req.body[key]));
        } else if (key === 'maxUses') {
          sets.push(`${key} = ?`);
          vals.push(req.body[key] ? parseInt(req.body[key]) : null);
        } else {
          sets.push(`${key} = ?`);
          vals.push(req.body[key]);
        }
      }
    }
    if (sets.length === 0) return res.status(400).json({ message: 'No fields to update' });
    vals.push(couponId);
    await pool.execute(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`, vals);
    const [[coupon]] = await pool.execute(`SELECT * FROM coupons WHERE id = ?`, [couponId]);
    res.json({ message: 'Coupon updated', coupon });
  } catch (error) {
    console.error('Error updating vendor coupon:', error);
    res.status(500).json({ message: 'Failed to update coupon' });
  }
};

// @desc    Delete a vendor coupon
// @route   DELETE /api/vendors/coupons/:id
// @access  Private (vendor — own coupons only)
export const deleteVendorCoupon = async (req, res) => {
  try {
    const couponId = parseInt(req.params.id);
    const [[existing]] = await pool.execute(`SELECT id, vendorId FROM coupons WHERE id = ?`, [couponId]);
    if (!existing) return res.status(404).json({ message: 'Coupon not found' });
    // Same admin-owned guard as updateVendorCoupon (platform coupons are NULL).
    if (existing.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await pool.execute(`DELETE FROM coupons WHERE id = ?`, [couponId]);
    res.json({ message: 'Coupon deleted' });
  } catch (error) {
    console.error('Error deleting vendor coupon:', error);
    res.status(500).json({ message: 'Failed to delete coupon' });
  }
};

// @desc    Update vendor business/storefront profile
// @route   PUT /api/vendors/profile
// @access  Private (vendor)
export const updateVendorProfile = async (req, res) => {
  try {
    const vendor = await Vendor.findByUserId(req.user.id);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile found' });

    const {
      businessName, contactPhone, logo, coverImage, businessDescription,
      weaverStory, yearsExperience, location, workshop, socialMedia, weaverVideo,
    } = req.body;
    const updates = {};
    if (businessName && businessName.trim()) {
      updates.businessName = businessName.trim();
      if (!vendor.slug) {
        // Auto-generated human-friendly slug on first storefront save.
        updates.slug = vendor.slug || `${slugify(businessName.trim())}-${vendor.id}`;
      }
    }
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (logo !== undefined) updates.logo = logo;
    if (coverImage !== undefined) updates.coverImage = coverImage;
    if (businessDescription !== undefined) updates.businessDescription = businessDescription;
    if (weaverStory !== undefined) updates.weaverStory = weaverStory;
    if (yearsExperience !== undefined) updates.yearsExperience = parseInt(yearsExperience) || 0;
    if (location !== undefined) updates.location = location;
    if (workshop !== undefined) updates.workshop = workshop;
    if (weaverVideo !== undefined) updates.weaverVideo = weaverVideo;
    if (socialMedia !== undefined) {
      // Store only a whitelisted set of social fields (no arbitrary keys).
      const allowedSocial = ['facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'whatsapp'];
      const cleaned = {};
      for (const key of allowedSocial) {
        const val = typeof socialMedia === 'object' ? socialMedia[key] : undefined;
        if (typeof val === 'string' && val.trim()) cleaned[key] = val.trim().slice(0, 300);
      }
      updates.socialMedia = cleaned;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const updated = await Vendor.update(vendor.id, updates);
    res.json({ message: 'Profile updated', vendor: updated });
  } catch (error) {
    console.error('Error updating vendor profile:', error);
    res.status(500).json({ message: 'Failed to update vendor profile' });
  }
};

// @desc    Get a public vendor storefront (approved vendors only)
// @route   GET /api/vendors/store/:slugOrId
// @access  Public
export const getPublicStorefront = async (req, res) => {
  try {
    const { slugOrId } = req.params;
    const storefront = await Vendor.getPublicStorefront(slugOrId, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (!storefront) {
      return res.status(404).json({ message: 'Store not found' });
    }
    // Only approved vendors get public storefronts.
    if (storefront.vendor.status !== 'approved') {
      return res.status(404).json({ message: 'Store not found' });
    }
    res.json(storefront);
  } catch (error) {
    console.error('Error fetching storefront:', error);
    res.status(500).json({ message: 'Failed to fetch storefront' });
  }
};

// @desc    List approved vendors for the storefront directory
// @route   GET /api/vendors/directory
// @access  Public
export const getVendorDirectory = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT v.id, v.userId, v.slug, v.businessName, v.logo, v.coverImage,
              v.location, v.verificationLevel, v.badges, v.yearsExperience,
              (SELECT COALESCE(AVG(r.rating), 0) FROM reviews r
                JOIN product p ON p.id = r.productId
                WHERE p.vendorId = v.userId AND r.status = 'approved') AS rating,
              (SELECT COUNT(*) FROM product p
                WHERE p.vendorId = v.userId AND p.approvalStatus = 'approved') AS productCount
       FROM vendors v
       WHERE v.status = 'approved'
       ORDER BY v.verificationLevel DESC, v.businessName ASC
       LIMIT 200`
    );
    res.json(rows.map((r) => ({
      ...r,
      rating: parseFloat(r.rating).toFixed(1),
      badges: Array.isArray(r.badges) ? r.badges : (typeof r.badges === 'string' ? JSON.parse(r.badges || '[]') : []),
    })));
  } catch (error) {
    console.error('Error fetching vendor directory:', error);
    res.status(500).json({ message: 'Failed to fetch vendor directory' });
  }
};

// @desc    Set a vendor's verification level (admin)
// @route   PUT /api/vendors/:id/verification
// @access  Private/Admin
export const updateVendorVerification = async (req, res) => {
  try {
    const { level, badges } = req.body;
    if (!['pending', 'verified', 'trusted_artisan', 'master_weaver'].includes(level)) {
      return res.status(400).json({ message: 'Invalid verification level' });
    }
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const allowedBadges = [
      'top_weaver', 'verified_vendor', 'best_seller', 'international_seller',
      'five_star_vendor', 'master_artisan',
    ];
    const cleanedBadges = Array.isArray(badges)
      ? badges.filter((b) => allowedBadges.includes(b))
      : (vendor.badges || []);

    const updated = await Vendor.update(vendor.id, {
      verificationLevel: level,
      badges: cleanedBadges,
    });
    res.json({ message: 'Verification level updated', vendor: updated });
  } catch (error) {
    console.error('Error updating vendor verification:', error);
    res.status(500).json({ message: 'Failed to update verification level' });
  }
};

// @desc    Withdraw funds from the vendor's available wallet balance
// @route   POST /api/vendors/withdraw
// @access  Private (approoved vendor)
export const withdrawVendorBalance = async (req, res) => {
  const { amount } = req.body;
  const amountNum = parseFloat(amount);

  if (!amountNum || amountNum <= 0) {
    return res.status(400).json({ message: 'A valid withdrawal amount is required' });
  }

  try {
    const vendor = await Vendor.findByUserId(req.user.id);
    if (!vendor) {
      return res.status(404).json({ message: 'No vendor application found' });
    }
    if (vendor.status !== 'approved') {
      return res.status(403).json({ message: 'Vendor application must be approved to withdraw' });
    }

    const wallet = await getWallet(req.user.id);
    const available = parseFloat(wallet.available_balance) || 0;
    if (amountNum > available) {
      return res.status(400).json({
        message: `Insufficient available balance. Available: GH₵${available.toFixed(2)}`,
      });
    }

    const allocations = await getAvailableAllocationsForVendor(req.user.id);
    let remaining = amountNum;
    let paid = 0;
    let failed = 0;
    const results = [];

    // Vendors may withdraw any amount up to their available balance. Full
    // allocations pay out in one transfer and turn 'releasing'; if the request
    // only covers part of an allocation, that part is transferred and the
    // allocation stays 'available' so the remainder can be withdrawn later.
    for (const allocation of allocations) {
      if (remaining <= 0) break;
      const availableInAllocation = parseFloat(allocation.payoutAmount) || 0;
      if (availableInAllocation <= 0) continue;

      const take = Math.min(remaining, availableInAllocation);
      const updated = await payoutAllocation(allocation, take);
      results.push(updated);

      // The wallet is debited only by the signed transfer.success webhook.
      // A provider acknowledgement is not settlement; debiting here makes a
      // failed/reversed transfer silently lose vendor funds.
      if (updated.paid) {
        remaining = Math.round((remaining - take) * 100) / 100;
        paid += 1;
      } else {
        // Payout failed (e.g. invalid recipient) — balance stays available,
        // allocation stays retryable.
        failed += 1;
      }
    }

    const settled = Math.round((amountNum - remaining) * 100) / 100;

    if (paid === 0) {
      // Nothing moved — surface the real reason (e.g. Paystack blocked the
      // transfer for a starter business) instead of a vague payout-details hint.
      const firstFailure = results.find((r) => r && !r.paid && r.reason);
      const reason = firstFailure?.reason || 'payout details could not be used';
      return res.status(400).json({
        message: `Withdrawal failed: ${reason}`,
        requested: amountNum,
        settled,
        paid,
        failed,
        results,
      });
    }

    return res.json({
      message: `Withdrawal of GH₵${settled.toFixed(2)} initiated`,
      requested: amountNum,
      settled,
      paid,
      failed,
      results,
    });
  } catch (error) {
    console.error('Error processing vendor withdrawal:', error);
    return res.status(500).json({ message: 'Failed to process withdrawal' });
  }
};
// @desc    Public fulfilment scorecard for a vendor (on-time delivery %)
export const getVendorFulfilment = async (req, res) => {
  try {
    const vendorId = parseInt(req.params.vendorId);
    if (!vendorId || Number.isNaN(vendorId)) {
      return res.status(400).json({ message: 'Invalid vendor ID' });
    }
    const { getVendorFulfilment } = await import('../Services/fulfilmentService.js');
    const scorecard = await getVendorFulfilment(vendorId);
    res.json(scorecard);
  } catch (error) {
    console.error('Error fetching fulfilment scorecard:', error);
    res.status(500).json({ message: 'Failed to fetch fulfilment scorecard' });
  }
};

// @desc    Admin vendor scorecard — churn predictors per vendor: on-time %,
//          response time, review rating + verified orders. Kept as a separate
//          lightweight endpoint so the admin vendors table can enrich rows
//          without bloating the main list query.
// @route   GET /api/vendors/admin-scorecard
// @access  Private/Admin
export const getAdminVendorScorecard = async (req, res) => {
  try {
    const [vendors] = await pool.execute(
      `SELECT v.userId, v.businessName, v.status, v.verificationLevel
       FROM vendors v
       ORDER BY v.created_at DESC`
    );
    const { getVendorFulfilment } = await import('../Services/fulfilmentService.js');

    const scorecards = await Promise.all(
      vendors.map(async (v) => {
        let onTimeRate = null;
        try {
          const f = await getVendorFulfilment(v.userId);
          onTimeRate = f && f.withDeadline > 0 ? f.onTimeRate : null;
        } catch (err) {
<<<<<<< HEAD
          console.warn(`⚠️ Fulfilment scorecard failed for ${v.userId}: ${err.message}`);
=======
 console.warn(` Fulfilment scorecard failed for ${v.userId}: ${err.message}`);
>>>>>>> 37559fdb66a254f1db22b9be260383cbb25cc62d
        }

        const [[ratingRow]] = await pool.execute(
          `SELECT COALESCE(AVG(r.vendorRating), 0) AS avgRating,
                  COUNT(DISTINCT r.orderId) AS ratingCount
           FROM reviews r
           JOIN product p ON p.id = r.productId
           WHERE p.vendorId = ? AND r.status = 'approved' AND r.isVerified = 1`,
          [v.userId]
        );

        const [[slaRow]] = await pool.execute(
          `SELECT COALESCE(AVG(TIMESTAMPDIFF(HOUR, created_at, updated_at)), 0) AS avgHours,
                  COUNT(*) AS respondedCount
           FROM custom_requests
           WHERE vendorId = ? AND status IN ('quoted','accepted','paid','in_progress','completed')`,
          [v.userId]
        );

        return {
          userId: v.userId,
          businessName: v.businessName,
          status: v.status,
          verificationLevel: v.verificationLevel,
          onTimeRate: onTimeRate === null ? null : parseFloat(onTimeRate.toFixed(2)),
          avgResponseHours: slaRow?.avgHours && slaRow.respondedCount > 0
            ? Math.round(parseFloat(slaRow.avgHours))
            : null,
          responseCount: slaRow?.respondedCount || 0,
          reviewRating: ratingRow?.avgRating ? parseFloat(ratingRow.avgRating).toFixed(1) : null,
          verifiedOrders: ratingRow?.ratingCount || 0,
        };
      })
    );

    res.json(scorecards);
  } catch (error) {
    console.error('Error fetching admin vendor scorecard:', error);
    res.status(500).json({ message: 'Failed to fetch vendor scorecard' });
  }
};

// @desc    Vendor demand-prediction digest (which kente types buyers want)
// @route   GET /api/vendors/insights
// @access  Private (approved vendor, view_earnings)
export const getVendorInsights = async (req, res) => {
  try {
    const { computeTopProductTypes } = await import('../utils/marketInsights.js');
    const insights = await computeTopProductTypes(8);
    const focus = insights.topTypes[0] || null;
    res.json({
      demand: insights,
      focus,
      tip: focus
        ? `Focus weaving capacity on "${focus.category}" — it drives ${focus.share}% of marketplace sales.`
        : 'No sales history yet — list products to start appearing in the digest.',
    });
  } catch (error) {
    console.error('Error fetching vendor insights:', error);
    res.status(500).json({ message: 'Failed to fetch demand insights' });
  }
};

// @desc    Get vendor's shipping destinations
// @route   GET /api/vendors/shipping/destinations
// @access  Private (vendor, manage_orders)
export const getVendorShippingDestinations = async (req, res) => {
  try {
    const { getVendorShippingDestinations } = await import('../Services/shippingService.js');
    const destinations = await getVendorShippingDestinations(req.user.id);
    res.json({ destinations });
  } catch (error) {
    console.error('Error fetching vendor shipping destinations:', error);
    res.status(500).json({ message: 'Failed to fetch shipping destinations' });
  }
};

// @desc    Add or update a vendor shipping destination
// @route   POST /api/vendors/shipping/destinations
// @access  Private (vendor, manage_orders)
export const addVendorShippingDestination = async (req, res) => {
  try {
    const { countryCode, region, isActive } = req.body;
    if (!countryCode) {
      return res.status(400).json({ message: 'countryCode is required' });
    }
    const { setVendorShippingDestination, COUNTRY_CONFIG } = await import('../Services/shippingService.js');
    const destination = await setVendorShippingDestination(req.user.id, countryCode, region, isActive);
    res.status(201).json({ message: 'Shipping destination added', destination });
  } catch (error) {
    console.error('Error adding vendor shipping destination:', error);
    if (error.message.startsWith('Unsupported country') || error.message.startsWith('Invalid region')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Failed to add shipping destination' });
  }
};

// @desc    Remove a vendor shipping destination
// @route   DELETE /api/vendors/shipping/destinations/:id
// @access  Private (vendor, manage_orders)
export const removeVendorShippingDestination = async (req, res) => {
  try {
    const { removeVendorShippingDestination } = await import('../Services/shippingService.js');
    const deleted = await removeVendorShippingDestination(req.user.id, parseInt(req.params.id, 10));
    if (!deleted) {
      return res.status(404).json({ message: 'Destination not found' });
    }
    res.json({ message: 'Shipping destination removed' });
  } catch (error) {
    console.error('Error removing vendor shipping destination:', error);
    res.status(500).json({ message: 'Failed to remove shipping destination' });
  }
};
