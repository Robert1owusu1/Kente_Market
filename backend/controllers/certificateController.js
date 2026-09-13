// FILE LOCATION: backend/controllers/certificateController.js
// DESCRIPTION: Kente authenticity certificates with a scannable QR token.
//              Issued against paid deliveries so buyers can verify the weaver,
//              workshop and pattern — the "provenance" moat of the marketplace.
import pool from '../config/db.js';

// @desc    Issue an authenticity certificate for a delivered order
// @route   POST /api/certificates
// @access  Private/Admin
export const issueCertificate = async (req, res) => {
  try {
    const { orderId, productId } = req.body;
    if (!orderId) return res.status(400).json({ message: 'Order ID is required' });
    const { issueCertificateForOrder } = await import('../Services/certificateService.js');
    const { message, issued, certificate } = await issueCertificateForOrder(orderId, {
      productId,
      issuedTo: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Verified Customer',
    });
    if (!issued && !certificate) {
      // Still not found or invalid — mirror previous status codes.
      if (message === 'Order not found') return res.status(404).json({ message });
      return res.status(400).json({ message });
    }
    if (!issued && certificate) {
      return res.json({ message, certificate });
    }
    res.status(201).json({ message, certificate });
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