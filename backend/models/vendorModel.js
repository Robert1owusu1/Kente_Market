// models/vendorModel.js
import pool from '../config/db.js';

// Safe JSON/CSV parser
function safeParse(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

class Vendor {
  constructor(data) {
    this.id = data.id;
    this.userId = data.userId;
    this.businessName = data.businessName;
    this.contactPhone = data.contactPhone;
    this.payoutType = data.payoutType || 'bank';
    this.bankName = data.bankName;
    this.accountNumber = data.accountNumber;
    this.bankCode = data.bankCode;
    this.momoProvider = data.momoProvider;
    this.momoNumber = data.momoNumber;
    this.recipientCode = data.recipientCode;
    this.recipientType = data.recipientType;
    this.platformFeeRate = parseFloat(data.platformFeeRate) || 0.1;
    this.status = data.status;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    // Storefront fields
    this.slug = data.slug || null;
    this.logo = data.logo || null;
    this.coverImage = data.coverImage || null;
    this.businessDescription = data.businessDescription || null;
    this.weaverStory = data.weaverStory || null;
    this.yearsExperience = parseInt(data.yearsExperience) || 0;
    this.location = data.location || null;
    this.workshop = data.workshop || null;
    this.socialMedia = safeParse(data.socialMedia) || {};
    this.verificationLevel = data.verificationLevel || 'pending';
    this.badges = safeParse(data.badges) || [];
    // Joined user info
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.email = data.email;
  }

  /** Sanitized public view - never exposes payout/bank details to customers. */
  toPublic() {
    return {
      id: this.id,
      userId: this.userId,
      slug: this.slug,
      businessName: this.businessName,
      logo: this.logo,
      coverImage: this.coverImage,
      businessDescription: this.businessDescription,
      weaverStory: this.weaverStory,
      yearsExperience: this.yearsExperience,
      location: this.location,
      workshop: this.workshop,
      contactPhone: this.contactPhone,
      socialMedia: this.socialMedia,
      verificationLevel: this.verificationLevel,
      badges: this.badges,
      status: this.status,
      firstName: this.firstName,
      lastName: this.lastName,
    };
  }

  static async findByUserId(userId) {
    const [rows] = await pool.execute(
      `SELECT v.*, u.firstName, u.lastName, u.email
       FROM vendors v
       JOIN users u ON u.id = v.userId
       WHERE v.userId = ?`,
      [userId]
    );
    return rows.length > 0 ? new Vendor(rows[0]) : null;
  }

  static async findBySlug(slug) {
    const [rows] = await pool.execute(
      `SELECT v.*, u.firstName, u.lastName, u.email
       FROM vendors v
       JOIN users u ON u.id = v.userId
       WHERE v.slug = ?`,
      [slug]
    );
    return rows.length > 0 ? new Vendor(rows[0]) : null;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      `SELECT v.*, u.firstName, u.lastName, u.email
       FROM vendors v
       JOIN users u ON u.id = v.userId
       WHERE v.id = ?`,
      [id]
    );
    return rows.length > 0 ? new Vendor(rows[0]) : null;
  }

  static async findAll(options = {}) {
    const { status = null, search = null } = options;
    const conditions = [];
    const params = [];
    if (status) {
      conditions.push('v.status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('(v.businessName LIKE ? OR u.firstName LIKE ? OR u.lastName LIKE ? OR u.email LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT v.*, u.firstName, u.lastName, u.email
       FROM vendors v
       JOIN users u ON u.id = v.userId
       ${whereClause}
       ORDER BY v.created_at DESC`,
      params
    );
    return rows.map((r) => new Vendor(r));
  }

  static async create(data) {
    const fields = [
      'userId', 'businessName', 'contactPhone', 'payoutType', 'bankName',
      'accountNumber', 'bankCode', 'momoProvider', 'momoNumber',
      'recipientCode', 'recipientType', 'platformFeeRate', 'status',
      'slug', 'logo', 'coverImage', 'businessDescription', 'weaverStory',
      'yearsExperience', 'location', 'workshop', 'socialMedia',
      'verificationLevel', 'badges'
    ];
    const cols = [];
    const placeholders = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined && data[f] !== null) {
        cols.push(f);
        placeholders.push('?');
        values.push(data[f] !== null && typeof data[f] === 'object' ? JSON.stringify(data[f]) : data[f]);
      }
    }
    if (cols.length === 0) throw new Error('No vendor fields provided');

    const [result] = await pool.execute(
      `INSERT INTO vendors (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values
    );
    return Vendor.findById(result.insertId);
  }

  static async update(id, data) {
    const fields = [
      'businessName', 'contactPhone', 'payoutType', 'bankName', 'accountNumber',
      'bankCode', 'momoProvider', 'momoNumber', 'recipientCode', 'recipientType',
      'platformFeeRate', 'status', 'slug', 'logo', 'coverImage',
      'businessDescription', 'weaverStory', 'yearsExperience', 'location',
      'workshop', 'socialMedia', 'verificationLevel', 'badges'
    ];
    const sets = [];
    const values = [];
    for (const f of fields) {
      // Allow explicit nulls to be written (clears stale data when switching
      // payout method), but skip undefined values.
      if (data[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(data[f] === null || typeof data[f] === 'object' ? (data[f] === null ? null : JSON.stringify(data[f])) : data[f]);
      }
    }
    if (sets.length === 0) throw new Error('No vendor fields to update');
    values.push(id);
    await pool.execute(
      `UPDATE vendors SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return Vendor.findById(id);
  }

  /**
   * Escrow summary for a vendor: held (in escrow) and available (released to
   * balance, awaiting withdrawal) payouts, plus wallet balances.
   */
  static async getEscrowSummary(vendorUserId) {
    const [rows] = await pool.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN ea.status = 'held' THEN ea.payoutAmount END), 0) AS pendingPayout,
         COALESCE(SUM(CASE WHEN ea.status = 'available' THEN ea.payoutAmount END), 0) AS availablePayout,
         COALESCE(SUM(CASE WHEN ea.status IN ('releasing', 'released') THEN ea.payoutAmount END), 0) AS withdrawnPayout,
         COALESCE(SUM(CASE WHEN ea.status = 'held' THEN ea.platformFee END), 0) AS pendingFee,
         COALESCE(SUM(CASE WHEN ea.status = 'failed' THEN 1 ELSE 0 END), 0) AS failedCount
       FROM escrow_allocations ea
       WHERE ea.vendorId = ?`,
      [vendorUserId]
    );
    const [walletRows] = await pool.execute(
      `SELECT available_balance, total_earned, total_withdrawn
       FROM vendor_wallets WHERE vendorId = ?`,
      [vendorUserId]
    );
    const summary = rows[0] || {};
    const wallet = walletRows[0] || { available_balance: 0, total_earned: 0, total_withdrawn: 0 };
    return {
      ...summary,
      availableBalance: parseFloat(wallet.available_balance) || 0,
      totalEarned: parseFloat(wallet.total_earned) || 0,
      totalWithdrawn: parseFloat(wallet.total_withdrawn) || 0,
    };
  }

  /**
   * Wallet transaction history for a vendor (credits from escrow releases,
   * withdrawals).
   */
  static async getWalletTransactions(vendorUserId) {
    const [rows] = await pool.execute(
      `SELECT id, type, amount, reference, allocationId, note, status, created_at
       FROM wallet_transactions
       WHERE vendorId = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [vendorUserId]
    );
    return rows.map((r) => ({
      ...r,
      amount: parseFloat(r.amount) || 0,
    }));
  }

  /**
   * Payout history (allocations + order refs) for a vendor.
   */
  static async getPayoutHistory(vendorUserId) {
    const [rows] = await pool.execute(
      `SELECT ea.*, o.orderNumber, o.created_at AS orderPlacedAt
       FROM escrow_allocations ea
       JOIN orders o ON o.id = ea.orderId
       WHERE ea.vendorId = ?
       ORDER BY ea.updated_at DESC
       LIMIT 200`,
      [vendorUserId]
    );
    return rows.map((r) => ({
      ...r,
      platformFeeRate: parseFloat(r.platformFeeRate) || 0,
      platformFee: parseFloat(r.platformFee) || 0,
      payoutAmount: parseFloat(r.payoutAmount) || 0,
      amount: parseFloat(r.amount) || 0,
    }));
  }

  /**
   * Public storefront summary: vendor profile (sanitized) + aggregated rating,
   * review count, product count, and product list. Only approved vendors with
   * approved products are shown to the public.
   */
  static async getPublicStorefront(identifier, { limit = 12, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(parseInt(limit) || 12, 100));
    const safeOffset = Math.max(0, parseInt(offset) || 0);

    const vendor = /^\d+$/.test(String(identifier))
      ? await Vendor.findById(parseInt(identifier))
      : await Vendor.findBySlug(identifier);
    if (!vendor) return null;

    const [prodRows] = await pool.execute(
      `SELECT COALESCE(AVG(r.rating), 0) AS avgRating,
              COUNT(r.id) AS reviewCount
       FROM reviews r
       JOIN product p ON p.id = r.productId
       WHERE p.vendorId = ? AND r.status = 'approved'`,
      [vendor.userId]
    );
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM product WHERE vendorId = ? AND approvalStatus = 'approved'`,
      [vendor.userId]
    );

    const [products] = await pool.execute(
      `SELECT p.id, p.title, p.img, p.price, p.originalPrice, p.category, p.tag,
              p.rating, p.reviews, p.stock, p.material, p.yards, p.patternName
       FROM product p
       WHERE p.vendorId = ? AND p.approvalStatus = 'approved'
       ORDER BY p.created_at DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [vendor.userId]
    );

    return {
      vendor: vendor.toPublic(),
      rating: parseFloat(prodRows[0]?.avgRating || 0).toFixed(1),
      reviewCount: prodRows[0]?.reviewCount || 0,
      productCount: countRow?.total || 0,
      products: products.map((p) => ({
        ...p,
        price: parseFloat(p.price) || 0,
        originalPrice: parseFloat(p.originalPrice) || null,
        rating: parseFloat(p.rating) || 0,
      })),
    };
  }
}

export default Vendor;