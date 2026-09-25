// @ts-check
// FILE LOCATION: backend/Services/certificateService.js
// DESCRIPTION: Programmatic authenticity-certificate issuance. Extracted from
//              controllers/certificateController.js so paid custom kente orders
//              can auto-issue their certificate the moment payment lands, while
//              the admin endpoint reuses the exact same (transactional) flow.
import crypto from 'crypto';
import pool from '../config/db.js';

const CERT_PREFIX = 'KT';
const CERT_SEQUENCE_KEY = 'certificate_last_seq';

/** @param {Awaited<ReturnType<typeof pool.getConnection>>} connection */
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

/**
 * Issue an authenticity certificate for a paid order. Idempotent per
 * (orderId, productId). Safe to call from payment-adjacent flows: it never
 * throws on duplicate certificate requests, it returns the existing one.
 * @param {number | string} orderId
 * @param {{ productId?: number | string | null, issuedTo?: string }} [options]
 * @returns {Promise<{ certificate?: Record<string, unknown>, message: string, issued: boolean }>}
 */
export const issueCertificateForOrder = async (orderId, { productId = null, issuedTo = 'Verified Customer' } = {}) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT GET_LOCK(?, 5)', ['certificate_issue']);

    const [[order]] = await connection.execute(
      `SELECT id, userId, orderNumber, items, paymentStatus, orderStatus
       FROM orders WHERE id = ?`,
      [Number(orderId)]
    );
    if (!order) {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']);
      await connection.rollback();
      return { message: 'Order not found', issued: false };
    }
    if (order.paymentStatus !== 'paid') {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']);
      await connection.rollback();
      return { message: 'Order is not paid', issued: false };
    }

    /** @type {any[]} */
    let items = [];
    try { items = typeof order.items === 'string' ? JSON.parse(order.items || '[]') : order.items || []; } catch { items = []; }

    let targetId = productId || null;
    if (!targetId) {
      const vendorItem = items.find((it) => it.vendorId);
      targetId = vendorItem?.productId || vendorItem?.product || items[0]?.productId || items[0]?.product || null;
    }
    if (!targetId) {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']);
      await connection.rollback();
      return { message: 'No product to certify', issued: false };
    }

    // Reject duplicates (idempotent), returning the existing certificate.
    const [dupRows] = await connection.execute(
      `SELECT id FROM authenticity_certificates WHERE orderId = ? AND productId = ?`,
      [order.id, Number(targetId)]
    );
    if (dupRows.length > 0) {
      const [[dup]] = await connection.execute(
        `SELECT * FROM authenticity_certificates WHERE id = ?`,
        [dupRows[0].id]
      );
      await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']);
      await connection.commit();
      return { message: 'Certificate already issued', issued: false, certificate: dup };
    }

    const [[product]] = await connection.execute(
      `SELECT p.id, p.title, p.patternName, p.patternMeaning, p.origin,
              p.weavingTechnique, p.vendorId,
              v.businessName, v.workshop, v.location
       FROM product p
       LEFT JOIN vendors v ON v.userId = p.vendorId
       WHERE p.id = ?`,
      [Number(targetId)]
    );
    if (!product) {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']);
      await connection.rollback();
      return { message: 'Product not found', issued: false };
    }

    // Custom orders: the purchased unit is the weave itself, so certify the
    // base product that inspired it but surface the custom composition.
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
        String(issuedTo).trim() || 'Verified Customer',
        qrToken,
      ]
    );

    await connection.execute('SELECT RELEASE_LOCK(?)', ['certificate_issue']);
    await connection.commit();

    const [[cert]] = await connection.execute(
      `SELECT * FROM authenticity_certificates WHERE id = ?`,
      [result.insertId]
    );
    return { message: 'Certificate issued', issued: true, certificate: cert };
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }
};