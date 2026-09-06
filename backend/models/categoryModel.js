// models/categoryModel.js
import pool from "../config/db.js";

class Category {
  // List categories. Public calls pass { activeOnly: true } to only get active
  // ones; admins can list all.
  static async findAll({ activeOnly = true } = {}) {
    const activeClause = activeOnly ? "WHERE isActive = 1" : "";
    const [rows] = await pool.query(
      `SELECT * FROM categories ${activeClause} ORDER BY sortOrder ASC, name ASC`
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      "SELECT * FROM categories WHERE id = ?",
      [parseInt(id)]
    );
    return rows[0] || null;
  }

  static async findByName(name) {
    const [rows] = await pool.execute(
      "SELECT * FROM categories WHERE name = ?",
      [String(name).trim()]
    );
    return rows[0] || null;
  }

  static async create({ name, description, sortOrder, isActive }) {
    try {
      const [result] = await pool.execute(
        `INSERT INTO categories (name, description, sortOrder, isActive)
         VALUES (?, ?, ?, ?)`,
        [
          String(name).trim(),
          description || null,
          sortOrder !== undefined && sortOrder !== null ? parseInt(sortOrder) : 0,
          isActive !== undefined ? (isActive ? 1 : 0) : 1,
        ]
      );
      return await Category.findById(result.insertId);
    } catch (err) {
      console.error("DB Error (Category.create):", err.message);
      if (err.code === "ER_DUP_ENTRY") {
        throw new Error("A category with this name already exists");
      }
      throw new Error(`Error creating category: ${err.message}`);
    }
  }

  static async update(id, { name, description, sortOrder, isActive }) {
    const existing = await Category.findById(id);
    if (!existing) throw new Error("Category not found");

    const newName = name !== undefined && name !== null ? String(name).trim() : existing.name;

    // Keep product.category rows in sync when the category is renamed so
    // existing products keep showing under the new name.
    if (existing.name !== newName) {
      await pool.execute(
        "UPDATE product SET category = ? WHERE category = ?",
        [newName, existing.name]
      );
    }

    const [result] = await pool.execute(
      `UPDATE categories
       SET name = ?,
           description = ?,
           sortOrder = ?,
           isActive = ?
       WHERE id = ?`,
      [
        newName,
        description !== undefined ? description : existing.description,
        sortOrder !== undefined && sortOrder !== null ? parseInt(sortOrder) : existing.sortOrder,
        isActive !== undefined ? (isActive ? 1 : 0) : existing.isActive,
        parseInt(id),
      ]
    );

    if (result.affectedRows === 0) {
      return Category.findById(id);
    }
    return Category.findById(id);
  }

  static async remove(id) {
    const existing = await Category.findById(id);
    if (!existing) return null;

    // Unlink products that pointed at this category so they don't break.
    await pool.execute(
      "UPDATE product SET category = NULL WHERE category = ?",
      [existing.name]
    );

    const [result] = await pool.execute(
      "DELETE FROM categories WHERE id = ?",
      [parseInt(id)]
    );
    return result.affectedRows > 0;
  }
}

export default Category;
