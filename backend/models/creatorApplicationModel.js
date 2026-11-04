// FILE LOCATION: backend/models/creatorApplicationModel.js
// DESCRIPTION: Data access for creator/affiliate applications (Phase 3, Step 6).
import pool from '../config/db.js';

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

class CreatorApplication {
  constructor(data) {
    this.id = data.id;
    this.userId = data.userId;
    this.status = data.status;
    this.platforms = parseJson(data.platforms, []);
    this.socialLinks = parseJson(data.socialLinks, []);
    this.audienceSize = data.audienceSize == null ? null : Number(data.audienceSize);
    this.niche = data.niche ?? null;
    this.pitch = data.pitch ?? null;
    this.requestedRate = data.requestedRate == null ? null : Number(data.requestedRate);
    this.approvedRate = data.approvedRate == null ? null : Number(data.approvedRate);
    this.reviewedBy = data.reviewedBy ?? null;
    this.reviewNote = data.reviewNote ?? null;
    this.reviewedAt = data.reviewedAt ?? null;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    // Joined user fields (admin list).
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.email = data.email;
    this.referralCode = data.referralCode;
  }

  static async findByUserId(userId) {
    const [rows] = await pool.execute(`SELECT * FROM creator_applications WHERE userId = ?`, [userId]);
    return rows.length ? new CreatorApplication(rows[0]) : null;
  }

  static async findById(id) {
    const [rows] = await pool.execute(`SELECT * FROM creator_applications WHERE id = ?`, [id]);
    return rows.length ? new CreatorApplication(rows[0]) : null;
  }

  /** @param {{ status?: string, search?: string }} [opts] */
  static async findAll({ status = null, search = null } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('ca.status = ?'); params.push(status); }
    if (search) {
      where.push('(LOWER(u.firstName) LIKE ? OR LOWER(u.lastName) LIKE ? OR LOWER(u.email) LIKE ?)');
      const t = `%${String(search).toLowerCase()}%`;
      params.push(t, t, t);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT ca.*, u.firstName, u.lastName, u.email, u.referralCode
         FROM creator_applications ca
         JOIN users u ON u.id = ca.userId
         ${clause}
        ORDER BY ca.created_at DESC
        LIMIT 200`,
      params
    );
    return rows.map((r) => new CreatorApplication(r));
  }

  /** Create or re-submit (upsert) an application. Resets a non-approved row to pending. */
  static async submit(userId, data) {
    await pool.execute(
      `INSERT INTO creator_applications
         (userId, status, platforms, socialLinks, audienceSize, niche, pitch, requestedRate)
       VALUES (?, 'pending', CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = IF(status = 'approved', 'approved', 'pending'),
         platforms = VALUES(platforms), socialLinks = VALUES(socialLinks),
         audienceSize = VALUES(audienceSize), niche = VALUES(niche),
         pitch = VALUES(pitch), requestedRate = VALUES(requestedRate),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        JSON.stringify(data.platforms ?? []),
        JSON.stringify(data.socialLinks ?? []),
        data.audienceSize ?? null,
        data.niche ?? null,
        data.pitch ?? null,
        data.requestedRate ?? null,
      ]
    );
    return CreatorApplication.findByUserId(userId);
  }

  /** @param {number} id @param {{ status:string, approvedRate?:number|null, reviewedBy:number, reviewNote?:string }} review */
  static async review(id, { status, approvedRate = null, reviewedBy, reviewNote = null }) {
    await pool.execute(
      `UPDATE creator_applications
          SET status = ?, approvedRate = ?, reviewedBy = ?, reviewNote = ?, reviewedAt = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [status, approvedRate, reviewedBy, reviewNote, id]
    );
    return CreatorApplication.findById(id);
  }
}

export default CreatorApplication;
