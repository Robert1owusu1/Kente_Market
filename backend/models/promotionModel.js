import pool from '../config/db.js';

class Promotion {
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.description = data.description;
    this.image = data.image;
    this.type = data.type;
    this.priority = data.priority || 0;
    this.link = data.link;
    this.linkText = data.linkText;
    this.bgColor = data.bgColor || '#f59e0b';
    this.textColor = data.textColor || '#ffffff';
    this.startDate = data.startDate;
    this.endDate = data.endDate;
    this.isActive = data.isActive !== false && !!Number(data.isActive);
    this.showAsPopup = data.showAsPopup !== false && !!Number(data.showAsPopup);
    this.popupDismissedExpiryHours = data.popupDismissedExpiryHours || 24;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async findAll(options = {}) {
    const connection = await pool.getConnection();
    try {
      const { type, isActive, includeExpired = false } = options;
      let query = 'SELECT * FROM promotions WHERE 1=1';
      const params = [];

      if (type) {
        query += ' AND type = ?';
        params.push(type);
      }
      if (isActive !== undefined) {
        query += ' AND isActive = ?';
        params.push(isActive ? 1 : 0);
      }
      if (!includeExpired) {
        query += ' AND (endDate IS NULL OR endDate >= NOW())';
      }

      query += ' ORDER BY priority DESC, created_at DESC';
      const [rows] = await connection.execute(query, params);
      return rows.map(r => new Promotion(r));
    } catch (error) {
      throw new Error('Error fetching promotions: ' + error.message);
    } finally {
      connection.release();
    }
  }

  static async findById(id) {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute('SELECT * FROM promotions WHERE id = ?', [id]);
      return rows.length ? new Promotion(rows[0]) : null;
    } catch (error) {
      throw new Error('Error fetching promotion: ' + error.message);
    } finally {
      connection.release();
    }
  }

  static async findActiveForDisplay(options = {}) {
    const connection = await pool.getConnection();
    try {
      const { type, limit = 10 } = options;
      let query = `SELECT * FROM promotions 
                   WHERE isActive = 1 
                   AND (startDate IS NULL OR startDate <= NOW())
                   AND (endDate IS NULL OR endDate >= NOW())`;
      const params = [];

      if (type) {
        query += ' AND type = ?';
        params.push(type);
      }

      // LIMIT cannot be safely bound in a mysql2 prepared statement on some
      // server versions ("Incorrect arguments to mysqld_stmt_execute"), so
      // coerce to a bounded integer and inline it directly.
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 10, 100));
      query += ` ORDER BY priority DESC LIMIT ${safeLimit}`;

      const [rows] = await connection.execute(query, params);
      return rows.map(r => new Promotion(r));
    } catch (error) {
      throw new Error('Error fetching active promotions: ' + error.message);
    } finally {
      connection.release();
    }
  }

  static async create(data) {
    const connection = await pool.getConnection();
    try {
      const [result] = await connection.execute(
        `INSERT INTO promotions (title, description, image, type, priority, link, linkText,
         bgColor, textColor, startDate, endDate, isActive, showAsPopup, popupDismissedExpiryHours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.title,
          data.description || null,
          data.image || null,
          data.type || 'banner',
          data.priority || 0,
          data.link || null,
          data.linkText || null,
          data.bgColor || '#f59e0b',
          data.textColor || '#ffffff',
          data.startDate || null,
          data.endDate || null,
          data.isActive !== false ? 1 : 0,
          data.showAsPopup ? 1 : 0,
          data.popupDismissedExpiryHours || 24,
        ]
      );
      return await Promotion.findById(result.insertId);
    } catch (error) {
      throw new Error('Error creating promotion: ' + error.message);
    } finally {
      connection.release();
    }
  }

  static async update(id, data) {
    const connection = await pool.getConnection();
    try {
      const [check] = await connection.execute('SELECT id FROM promotions WHERE id = ?', [id]);
      if (check.length === 0) throw new Error('Promotion not found');

      const allowed = [
        'title', 'description', 'image', 'type', 'priority', 'link', 'linkText',
        'bgColor', 'textColor', 'startDate', 'endDate', 'isActive', 'showAsPopup',
        'popupDismissedExpiryHours'
      ];
      const fields = [];
      const values = [];

      for (const key of allowed) {
        if (data[key] !== undefined) {
          fields.push(`${key} = ?`);
          if (key === 'isActive' || key === 'showAsPopup') {
            values.push(data[key] ? 1 : 0);
          } else {
            values.push(data[key]);
          }
        }
      }

      if (fields.length === 0) throw new Error('No fields to update');

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await connection.execute(
        `UPDATE promotions SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      return await Promotion.findById(id);
    } catch (error) {
      throw new Error('Error updating promotion: ' + error.message);
    } finally {
      connection.release();
    }
  }

  static async delete(id) {
    const connection = await pool.getConnection();
    try {
      const [result] = await connection.execute('DELETE FROM promotions WHERE id = ?', [id]);
      return result.affectedRows > 0;
    } catch (error) {
      throw new Error('Error deleting promotion: ' + error.message);
    } finally {
      connection.release();
    }
  }
}

export default Promotion;
