// controllers/vendorController.js
import Vendor from '../models/vendorModel.js';
import pool from '../config/db.js';
import paystackServices from '../Services/paystackservices.js';
import { PLATFORM_FEE_RATE } from '../config/businessConfig.js';

// @desc    Apply to become a vendor / update bank details
// @route   POST /api/vendors/apply
// @access  Private
export const applyVendor = async (req, res) => {
  try {
    const { businessName, contactPhone, bankName, accountNumber, bankCode } = req.body;

    if (!businessName) return res.status(400).json({ message: 'Business name is required' });
    if (!bankName || !accountNumber || !bankCode) {
      return res.status(400).json({ message: 'Bank details are required' });
    }

    // Verify the account number resolves to a real account before creating a recipient
    let resolvedName = businessName;
    try {
      const resolved = await paystackServices.resolveAccountNumber(accountNumber, bankCode);
      resolvedName = resolved?.data?.data?.account_name || businessName;
    } catch (e) {
      console.warn(`⚠️ Account resolution skipped/ failed: ${e.message}`);
    }

    // Create (or reuse) a Paystack transfer recipient for the vendor
    let recipientCode = null;
    try {
      const recipient = await paystackServices.createTransferRecipient(
        'nuban',
        resolvedName,
        accountNumber,
        bankCode
      );
      recipientCode = recipient?.data?.data?.recipient_code || null;
    } catch (e) {
      console.warn(`⚠️ Recipient creation failed: ${e.message}`);
    }

    const existing = await Vendor.findByUserId(req.user.id);

    let vendor;
    if (existing) {
      vendor = await Vendor.update(existing.id, {
        businessName,
        contactPhone: contactPhone || existing.contactPhone,
        bankName,
        accountNumber,
        bankCode,
        recipientCode: recipientCode || existing.recipientCode,
        status: 'pending',
      });
    } else {
      vendor = await Vendor.create({
        userId: req.user.id,
        businessName,
        contactPhone,
        bankName,
        accountNumber,
        bankCode,
        recipientCode,
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
    res.status(500).json({ message: error.message });
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
    res.json({ vendor, summary, payouts });
  } catch (error) {
    console.error('Error fetching vendor profile:', error);
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
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
    const vendor = await Vendor.update(req.params.id, { status });
    res.json({ message: `Vendor ${status}`, vendor });
  } catch (error) {
    console.error('Error updating vendor status:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get products belonging to the requesting vendor
// @route   GET /api/vendors/myproducts
// @access  Private (vendor or admin)
export const getMyProducts = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, title, img, price, category, featured, isCustomizable, created_at
       FROM product
       WHERE vendorId = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching vendor products:', error);
    res.status(500).json({ message: error.message });
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
    } = req.body;

    if (!title || !img || !price || !category) {
      return res.status(400).json({ message: 'Title, image, price and category are required' });
    }

    const [result] = await pool.execute(
      `INSERT INTO product
        (title, img, price, category, tag, productionTime, material, printType,
         isCustomizable, colors, sizes, vendorId, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        img,
        price,
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
      ]
    );
    const [product] = await pool.execute(`SELECT * FROM product WHERE id = ?`, [result.insertId]);
    res.status(201).json({ message: 'Product created', product: product[0] });
  } catch (error) {
    console.error('Error creating vendor product:', error);
    res.status(500).json({ message: error.message });
  }
};