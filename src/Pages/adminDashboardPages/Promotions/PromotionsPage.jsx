import React, { useState } from 'react';
import {
  useGetPromotionsQuery,
  useCreatePromotionMutation,
  useUpdatePromotionMutation,
  useDeletePromotionMutation,
} from '../../../slices/promotionsApiSlice';
import { useUploadImageMutation } from '../../../slices/uploadApiSlice';
import { FaPlus, FaEdit, FaTrash, FaEye, FaEyeSlash, FaImage } from 'react-icons/fa';

const emptyForm = {
  title: '',
  description: '',
  image: '',
  type: 'banner',
  priority: 0,
  link: '',
  linkText: '',
  bgColor: '#f59e0b',
  textColor: '#ffffff',
  startDate: '',
  endDate: '',
  isActive: true,
  showAsPopup: false,
  popupDismissedExpiryHours: 24,
};

const typeColors = {
  banner: 'bg-blue-100 text-blue-700',
  popup: 'bg-purple-100 text-purple-700',
  event: 'bg-green-100 text-green-700',
  discount: 'bg-red-100 text-red-700',
  giveaway: 'bg-yellow-100 text-yellow-700',
  promo: 'bg-pink-100 text-pink-700',
};

const PromotionsPage = () => {
  const { data: promotions = [], isLoading } = useGetPromotionsQuery();
  const [createPromotion] = useCreatePromotionMutation();
  const [updatePromotion] = useUpdatePromotionMutation();
  const [deletePromotion] = useDeletePromotionMutation();
  const [uploadImage] = useUploadImageMutation();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState('all');
  const [uploading, setUploading] = useState(false);

  const filtered = promotions.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'active') return p.isActive;
    if (filter === 'inactive') return !p.isActive;
    return p.type === filter;
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (promo) => {
    setEditing(promo);
    setForm({
      title: promo.title || '',
      description: promo.description || '',
      image: promo.image || '',
      type: promo.type || 'banner',
      priority: promo.priority || 0,
      link: promo.link || '',
      linkText: promo.linkText || '',
      bgColor: promo.bgColor || '#f59e0b',
      textColor: promo.textColor || '#ffffff',
      startDate: promo.startDate ? promo.startDate.slice(0, 16) : '',
      endDate: promo.endDate ? promo.endDate.slice(0, 16) : '',
      isActive: !!promo.isActive,
      showAsPopup: !!promo.showAsPopup,
      popupDismissedExpiryHours: promo.popupDismissedExpiryHours || 24,
    });
    setShowForm(true);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const result = await uploadImage(formData).unwrap();
      setForm((prev) => ({ ...prev, image: result.image }));
    } catch (err) {
      console.error('Upload error:', err);
      if (err?.status === 401 || err?.data?.message?.includes('Not authorized')) {
        alert('Session expired. Please log in again.');
      } else {
        alert(err?.data?.message || 'Image upload failed');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        priority: parseInt(form.priority) || 0,
        popupDismissedExpiryHours: parseInt(form.popupDismissedExpiryHours) || 24,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
      };

      if (editing) {
        await updatePromotion({ id: editing.id, ...payload }).unwrap();
      } else {
        await createPromotion(payload).unwrap();
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditing(null);
    } catch (err) {
      alert(err?.data?.message || 'Failed to save promotion');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this promotion?')) return;
    try {
      await deletePromotion(id).unwrap();
    } catch {
      alert('Failed to delete');
    }
  };

  const toggleActive = async (promo) => {
    try {
      await updatePromotion({ id: promo.id, isActive: !promo.isActive }).unwrap();
    } catch {
      alert('Failed to update');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Promotions & Banners</h2>
          <p className="text-sm text-gray-500 mt-1">Manage hero banners, popups, events, and discount flyers</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-semibold"
        >
          <FaPlus /> New Promotion
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {['all', 'active', 'inactive', 'banner', 'popup', 'event', 'discount', 'giveaway', 'promo'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition ${
              filter === f
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Promo list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl shadow">
          <FaImage className="mx-auto text-5xl text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">No promotions yet</p>
          <p className="text-gray-400 text-sm mt-1">Click "New Promotion" to create your first banner or popup</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((promo) => (
            <div
              key={promo.id}
              className={`bg-white dark:bg-gray-800 rounded-xl shadow-md p-4 flex flex-col sm:flex-row gap-4 items-start transition ${
                !promo.isActive ? 'opacity-60' : ''
              }`}
            >
              {/* Thumbnail */}
              {promo.image ? (
                <img
                  src={promo.image}
                  alt={promo.title}
                  className="w-full sm:w-32 h-24 object-cover rounded-lg flex-shrink-0"
                />
              ) : (
                <div
                  className="w-full sm:w-32 h-24 rounded-lg flex-shrink-0 flex items-center justify-center text-2xl font-bold"
                  style={{ backgroundColor: promo.bgColor, color: promo.textColor }}
                >
                  {promo.title?.charAt(0)}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-gray-800 dark:text-white truncate">{promo.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${typeColors[promo.type] || 'bg-gray-100 text-gray-600'}`}>
                    {promo.type}
                  </span>
                  {promo.showAsPopup && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                      Popup
                    </span>
                  )}
                </div>
                {promo.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{promo.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                  <span>Priority: {promo.priority}</span>
                  {promo.startDate && <span>From: {new Date(promo.startDate).toLocaleDateString()}</span>}
                  {promo.endDate && <span>Until: {new Date(promo.endDate).toLocaleDateString()}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleActive(promo)}
                  className={`p-2 rounded-lg transition ${promo.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                  title={promo.isActive ? 'Active' : 'Inactive'}
                >
                  {promo.isActive ? <FaEye /> : <FaEyeSlash />}
                </button>
                <button
                  onClick={() => openEdit(promo)}
                  className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 transition"
                  title="Edit"
                >
                  <FaEdit />
                </button>
                <button
                  onClick={() => handleDelete(promo.id)}
                  className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition"
                  title="Delete"
                >
                  <FaTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowForm(false)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-800 dark:text-white">
                {editing ? 'Edit Promotion' : 'New Promotion'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title *</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. 30% Off Independence Day Sale"
                  className="w-full px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  placeholder="Tell customers about this promotion..."
                  className="w-full px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                />
              </div>

              {/* Image upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Image</label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition text-sm">
                    <FaImage className="text-gray-400" />
                    {uploading ? 'Uploading...' : 'Choose Image'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                  {form.image && (
                    <img src={form.image} alt="Preview" className="h-16 w-24 object-cover rounded-lg" />
                  )}
                </div>
              </div>

              {/* Type + Priority */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                  >
                    <option value="banner">Banner (Hero Slider)</option>
                    <option value="popup">Popup (On Visit)</option>
                    <option value="event">Event</option>
                    <option value="discount">Discount</option>
                    <option value="giveaway">Giveaway</option>
                    <option value="promo">Promo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                    placeholder="0 = lowest"
                  />
                  <p className="text-xs text-gray-400 mt-1">Higher = shown first</p>
                </div>
              </div>

              {/* Link */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CTA Link</label>
                  <input
                    value={form.link}
                    onChange={(e) => setForm({ ...form, link: e.target.value })}
                    placeholder="/products"
                    className="w-full px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CTA Button Text</label>
                  <input
                    value={form.linkText}
                    onChange={(e) => setForm({ ...form, linkText: e.target.value })}
                    placeholder="Shop Now"
                    className="w-full px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Colors */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Background Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.bgColor}
                      onChange={(e) => setForm({ ...form, bgColor: e.target.value })}
                      className="w-10 h-10 rounded cursor-pointer"
                    />
                    <input
                      value={form.bgColor}
                      onChange={(e) => setForm({ ...form, bgColor: e.target.value })}
                      className="flex-1 px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white font-mono text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Text Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.textColor}
                      onChange={(e) => setForm({ ...form, textColor: e.target.value })}
                      className="w-10 h-10 rounded cursor-pointer"
                    />
                    <input
                      value={form.textColor}
                      onChange={(e) => setForm({ ...form, textColor: e.target.value })}
                      className="flex-1 px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
                  <input
                    type="datetime-local"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
                  <input
                    type="datetime-local"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.showAsPopup}
                    onChange={(e) => setForm({ ...form, showAsPopup: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Show as Popup</span>
                </label>
              </div>

              {form.showAsPopup && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Re-show After Dismiss (hours)
                  </label>
                  <input
                    type="number"
                    value={form.popupDismissedExpiryHours}
                    onChange={(e) => setForm({ ...form, popupDismissedExpiryHours: e.target.value })}
                    className="w-32 px-4 py-2.5 border rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-5 py-2.5 rounded-lg border text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition"
                >
                  {editing ? 'Save Changes' : 'Create Promotion'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromotionsPage;
