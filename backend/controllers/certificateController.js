// FILE LOCATION: backend/controllers/certificateController.js
// DESCRIPTION: Kente authenticity certificates with a scannable QR token.
//              Issued against paid deliveries so buyers can verify the weaver,
//              workshop and pattern — the "provenance" moat of the marketplace.
import crypto from 'crypto';
import pool from '../config/db.js';

const CERT_PREFIX = 'KT';
const CERT_SEQUENCE_KEY = 'certificate_last_seq';

const nextCertificateNumber = async (connection) => {
  const [rows] = await connection.execute(
    `SELECT settingValue FROM settings WHERE settingKey = ? FOR UPDATE`,
    [CERT_SEQUENCE_KEY]
  );
  const lastSeq = rows.length > 0 ? parseInt(rows[0].settingValue) || 0 : 0;
  const seq = lastSeq + 1;
  await connection.execute(
    `INSERT INTO settings (settingKey, settingValue, settingType)
     VALUES (?, ?, 'int')
     ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
    [CERT_SEQUENCE_KEY, String(seq)]
  );
  const year = new Date().getFullYear();
  return `${CERT_PREFIX}-${year}-${String(seq).padStart(5, '0')}`;
};

// @desc    Issue an authenticity certificate for a delivered order
// @route   POST /api/certificates
// @access  Private/Admin
export const issueCertificate = async (req, res) => {
  try {
    const { orderId, productId } = req.body;
    if (!orderId) return res.status(400).json({ message: 'Order ID is required' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT GET_LOCK(?, 5)', ['certificate_issue']);

      const [[order]] = await connection.execute(
        `SELECT id, userId, orderNumber, items, paymentStatus, orderStatus
         FROM orders WHERE id = ?`,
        [parseInt(orderId)]
      );
      if (!order) { await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']); return res.status(404).json({ message: 'Order not found' }); }
      if (order.paymentStatus !== 'paid') { await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']); return res.status(400).json({ message: 'Order is not paid' }); }

      // Determine the product to certify: explicit productId (defaults to the
      // first vendor product in the order).
      let items = [];
      try { items = JSON.parse(order.items || '[]'); } catch { items = []; }
      let targetId = productId;
      if (!targetId) {
        const vendorItems = items.find((it) => it.vendorId);
        targetId = vendorItems?.productId || vendorItems?.product || items[0]?.productId || items[0]?.product;
      }
      if (!targetId) { await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']); return res.status(400).json({ message: 'No product to certify' }); }

      // Reject if a certificate was already issued for this order+product.
      const [dupRows] = await connection.execute(
        `SELECT id FROM authenticity_certificates WHERE orderId = ? AND productId = ?`,
        [order.id, parseInt(targetId)]
      );
      if (dupRows.length > 0) {
        const [[dup]] = await connection.execute(
          `SELECT * FROM authenticity_certificates WHERE id = ?`,
          [dupRows[0].id]
        );
        await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']);
        return res.json({ message: 'Certificate already issued', certificate: dup });
      }

      const [[product]] = await connection.execute(
        `SELECT p.id, p.title, p.patternName, p.patternMeaning, p.origin,
                p.weavingTechnique, p.vendorId,
                v.businessName, v.workshop, v.location
         FROM product p
         LEFT JOIN vendors v ON v.userId = p.vendorId
         WHERE p.id = ?`,
        [parseInt(targetId)]
      );
      if (!product) { await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']); return res.status(404).json({ message: 'Product not found' }); }

      const certificateNumber = await nextCertificateNumber(connection);
      const qrToken = crypto.randomBytes(16).toString('hex');

      const [result] = await connection.execute(
        `INSERT INTO authenticity_certificates
          (certificateNumber, productId, vendorId, orderId, customerId,
           patternName, weaverName, workshop, village, patternMeaning,
           dateRegistered, issuedTo, qrToken)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
        [
          certificateNumber,
          product.id,
          product.vendorId || null,
          order.id,
          order.userId,
          product.patternName || product.title || null,
          product.businessName || null,
          product.workshop || null,
          product.location || null,
          product.patternMeaning || null,
          `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Verified Customer',
          qrToken,
        ]
      );

      await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']);
      await connection.commit();

      const [[cert]] = await connection.execute(
        `SELECT * FROM authenticity_certificates WHERE id = ?`,
        [result.insertId]
      );
      res.status(201).json({ message: 'Certificate issued', certificate: cert });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error issuing certificate:', error);
    res.status(500).json({ message: 'Failed to issue certificate' });
  }
};

// @desc    Public certificate verification (via QR token or certificate number)
// @route   GET /api/certificates/verify/:tokenOrNumber
// @access  Public
export const verifyCertificate = async (req, res) => {
  try {
    const token = String(req.params.tokenOrNumber).trim();
    if (!token) return res.status(400).json({ message: 'Certificate token required' });

    const [[cert]] = await pool.execute(
      `SELECT certificateNumber, productId, vendorId, orderId, patternName,
              weaverName, workshop, village, patternMeaning, dateRegistered,
              status, qrToken
       FROM authenticity_certificates
       WHERE qrToken = ? OR certificateNumber = ?
       LIMIT 1`,
      [token, token]
    );
    if (!cert) return res.status(404).json({ message: 'Certificate not found' });
    if (cert.status === 'revoked') {
      return res.json({ verified: false, message: 'This certificate has been revoked', certificate: cert });
    }

    res.json({
      verified: true,
      certificate: {
        certificateNumber: cert.certificateNumber,
        patternName: cert.patternName,
        weaverName: cert.weaverName,
        workshop: cert.workshop || cert.village,
        village: cert.village,
        patternMeaning: cert.patternMeaning,
        dateRegistered: cert.dateRegistered,
      },
    });
  } catch (error) {
    console.error('Error verifying certificate:', error);
    res.status(500).json({ message: 'Failed to verify certificate' });
  }
};

// @desc    List certificates for a customer (their purchases)
// @route   GET /api/certificates/mine
// @access  Private (customer)
export const getMyCertificates = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id, c.certificateNumber, c.patternName, c.weaverName, c.workshop,
              c.village, c.dateRegistered, c.qrToken, c.status,
              p.title AS productTitle, p.img AS productImage,
              o.orderNumber
       FROM authenticity_certificates c
       LEFT JOIN product p ON p.id = c.productId
       LEFT JOIN orders o ON o.id = c.orderId
       WHERE c.customerId = ?
       ORDER BY c.created_at DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching certificates:', error);
    res.status(500).json({ message: 'Failed to fetch certificates' });
  }
};

// @desc    Admin list all certificates
// @route   GET /api/certificates
// @access  Private/Admin
export const listCertificates = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.*, p.title AS productTitle, o.orderNumber
       FROM authenticity_certificates c
       LEFT JOIN product p ON p.id = c.productId
       LEFT JOIN orders o ON o.id = c.orderId
       ORDER BY c.created_at DESC
       LIMIT 500`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing certificates:', error);
    res.status(500).json({ message: 'Failed to list certificates' });
  }
};