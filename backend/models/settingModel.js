// FILE LOCATION: models/settingModel.js
// DESCRIPTION: Database model for application settings

import pool from '../config/db.js';

class Setting {
  // Get all settings as key-value pairs
  static async getAll() {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        'SELECT * FROM settings ORDER BY settingKey'
      );

      const settings = {};
      rows.forEach(row => {
        let value = row.settingValue;
        
        // Parse value based on type
        switch(row.settingType) {
          case 'number':
            value = parseFloat(value);
            break;
          case 'boolean':
            value = value === 'true' || value === '1';
            break;
          case 'json':
            try {
              value = JSON.parse(value);
            } catch (e) {
              value = null;
            }
            break;
        }
        
        settings[row.settingKey] = value;
      });

      return settings;
    } catch (error) {
      throw new Error('Error fetching settings: ' + error.message);
    } finally {
      connection.release();
    }
  }

  // Get single setting by key
  static async get(key) {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        'SELECT * FROM settings WHERE settingKey = ?',
        [key]
      );

      if (rows.length === 0) return null;

      const row = rows[0];
      let value = row.settingValue;

      switch(row.settingType) {
        case 'number':
          value = parseFloat(value);
          break;
        case 'boolean':
          value = value === 'true' || value === '1';
          break;
        case 'json':
          try {
            value = JSON.parse(value);
          } catch (e) {
            value = null;
          }
          break;
      }

      return value;
    } catch (error) {
      throw new Error('Error fetching setting: ' + error.message);
    } finally {
      connection.release();
    }
  }

  // Update single setting
  static async update(key, value, type = 'string') {
    const connection = await pool.getConnection();
    try {
      // Convert value to string for storage
      let stringValue = value;
      if (type === 'json') {
        stringValue = JSON.stringify(value);
      } else if (type === 'boolean') {
        stringValue = value ? 'true' : 'false';
      } else {
        stringValue = String(value);
      }

      const [result] = await connection.execute(
        `INSERT INTO settings (settingKey, settingValue, settingType) 
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE settingValue = ?, settingType = ?`,
        [key, stringValue, type, stringValue, type]
      );

      return result.affectedRows > 0;
    } catch (error) {
      throw new Error('Error updating setting: ' + error.message);
    } finally {
      connection.release();
    }
  }

  // Update multiple settings at once
  static async updateMany(settings) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const [key, config] of Object.entries(settings)) {
        const { value, type = 'string' } = typeof config === 'object' && config.value !== undefined
          ? config
          : { value: config, type: 'string' };

        let stringValue = value;
        if (type === 'json') {
          stringValue = JSON.stringify(value);
        } else if (type === 'boolean') {
          stringValue = value ? 'true' : 'false';
        } else {
          stringValue = String(value);
        }

        await connection.execute(
          `INSERT INTO settings (settingKey, settingValue, settingType) 
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE settingValue = ?, settingType = ?`,
          [key, stringValue, type, stringValue, type]
        );
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw new Error('Error updating settings: ' + error.message);
    } finally {
      connection.release();
    }
  }

  // Delete setting
  static async delete(key) {
    const connection = await pool.getConnection();
    try {
      const [result] = await connection.execute(
        'DELETE FROM settings WHERE settingKey = ?',
        [key]
      );

      return result.affectedRows > 0;
    } catch (error) {
      throw new Error('Error deleting setting: ' + error.message);
    } finally {
      connection.release();
    }
  }
}

export default Setting;