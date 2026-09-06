// Pages/adminDashboardPages/Categories/CategoriesPage.jsx
import React, { useState } from 'react';
import { FaPlus, FaEdit, FaTrash, FaTimes, FaSpinner } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetAllCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
} from '../../../slices/categoriesApiSlice';

const emptyForm = { name: '', description: '', sortOrder: '', isActive: true };

const CategoriesPage = () => {
  const { data: categories = [], isLoading } = useGetAllCategoriesQuery();
  const [createCategory] = useCreateCategoryMutation();
  const [updateCategory] = useUpdateCategoryMutation();
  const [deleteCategory] = useDeleteCategoryMutation();

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [deleting, setDeleting] = useState(null);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (cat) => {
    setEditing(cat);
    setForm({
      name: cat.name || '',
      description: cat.description || '',
      sortOrder: cat.sortOrder || '',
      isActive: cat.isActive !== undefined ? !!cat.isActive : true,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Category name is required');
      return;
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      sortOrder: form.sortOrder ? parseInt(form.sortOrder, 10) : 0,
      isActive: form.isActive,
    };
    try {
      if (editing) {
        await updateCategory({ id: editing.id, ...payload }).unwrap();
        toast.success('Category updated');
      } else {
        await createCategory(payload).unwrap();
        toast.success('Category created');
      }
      setShowModal(false);
      setForm(emptyForm);
      setEditing(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to save category');
    }
  };

  const handleDelete = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}"? Existing products in it will be unlinked.`)) return;
    setDeleting(cat.id);
    try {
      await deleteCategory(cat.id).unwrap();
      toast.success('Category deleted');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to delete category');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleActive = async (cat) => {
    try {
      await updateCategory({ id: cat.id, isActive: !cat.isActive }).unwrap();
      toast.success(cat.isActive ? 'Category deactivated' : 'Category activated');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update category');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Categories</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage the categories the platform accepts. Changes take effect in the
            product forms, filters, and storefront.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90"
        >
          <FaPlus /> Add Category
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <FaSpinner className="animate-spin text-3xl text-primary" />
          </div>
        ) : categories.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-16">
            No categories yet. Click "Add Category" to create one.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                <th className="p-4">Order</th>
                <th className="p-4">Name</th>
                <th className="p-4">Description</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <td className="p-4 text-gray-500 dark:text-gray-400">{cat.sortOrder}</td>
                  <td className="p-4 font-medium text-gray-900 dark:text-white">{cat.name}</td>
                  <td className="p-4 text-gray-500 dark:text-gray-400 max-w-xs truncate">{cat.description || '—'}</td>
                  <td className="p-4">
                    <button
                      onClick={() => handleToggleActive(cat)}
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        cat.isActive
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {cat.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(cat)}
                        className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-gray-700 rounded"
                        title="Edit"
                      >
                        <FaEdit />
                      </button>
                      <button
                        onClick={() => handleDelete(cat)}
                        disabled={deleting === cat.id}
                        className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-gray-700 rounded"
                        title="Delete"
                      >
                        {deleting === cat.id ? <FaSpinner className="animate-spin" /> : <FaTrash />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {editing ? 'Edit Category' : 'Add Category'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-white">
                <FaTimes />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Name *</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="e.g. Double Weaving"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Description</label>
                <input
                  name="description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Short description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Display order</label>
                <input
                  name="sortOrder"
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="0"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4"
                />
                Active
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoriesPage;
