// Pages/Vendor/VendorCoupons.jsx
// Create/manage vendor coupons
import { useState } from 'react';
import { FaPercent, FaPlus, FaTrash, FaEdit, FaSpinner, FaTimes } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetVendorCouponsQuery,
  useCreateVendorCouponMutation,
  useUpdateVendorCouponMutation,
  useDeleteVendorCouponMutation,
} from '../../slices/vendorsApiSlice';
import Loader from '../../components/loader/Loader.jsx';

const emptyForm = { code: '', discountType: 'percentage', discountValue: '', minPurchase: '', maxUses: '', expiresAt: '', isActive: true };

const VendorCoupons = () => {
  const { data: coupons = [], isLoading } = useGetVendorCouponsQuery();
  const [createCoupon, { isLoading: creating }] = useCreateVendorCouponMutation();
  const [updateCoupon, { isLoading: updating }] = useUpdateVendorCouponMutation();
  const [deleteCoupon] = useDeleteVendorCouponMutation();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const resetForm = () => { setForm(emptyForm); setEditing(null); setShowForm(false); };

  const handleEdit = (c) => {
    setEditing(c);
    setForm({
      code: c.code,
      discountType: c.discountType,
      discountValue: c.discountValue,
      minPurchase: c.minPurchase || '',
      maxUses: c.maxUses || '',
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '',
      isActive: !!c.isActive,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.code.trim()) return toast.error('Coupon code is required');
    if (!form.discountValue || isNaN(form.discountValue) || parseFloat(form.discountValue) <= 0) {
      return toast.error('Discount value must be greater than 0');
    }
    try {
      if (editing) {
        await updateCoupon({ id: editing.id, ...form }).unwrap();
        toast.success('Coupon updated');
      } else {
        await createCoupon(form).unwrap();
        toast.success('Coupon created');
      }
      resetForm();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to save coupon');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteCoupon(id).unwrap();
      toast.success('Coupon deleted');
      setDeleteConfirm(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to delete coupon');
    }
  };

  if (isLoading) return <div className="py-10 flex items-center justify-center"><Loader /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Coupons</h2>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90">
          <FaPlus /> Create Coupon
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">{editing ? 'Edit Coupon' : 'Create Coupon'}</h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><FaTimes /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Code *</label>
                <input name="code" value={form.code} onChange={handleChange} disabled={!!editing} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 uppercase disabled:opacity-60" placeholder="e.g. SUMMER20" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Type *</label>
                  <select name="discountType" value={form.discountType} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed Amount (GH₵)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Value *</label>
                  <input name="discountValue" type="number" step="0.01" value={form.discountValue} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="10" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Min Purchase (GH₵)</label>
                  <input name="minPurchase" type="number" step="0.01" value={form.minPurchase} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Max Uses</label>
                  <input name="maxUses" type="number" value={form.maxUses} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="Unlimited" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Expires At</label>
                <input name="expiresAt" type="date" value={form.expiresAt} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" name="isActive" checked={form.isActive} onChange={handleChange} className="w-4 h-4" />
                Active
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={resetForm} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
                <button type="submit" disabled={creating || updating} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-60">
                  {(creating || updating) ? <FaSpinner className="animate-spin" /> : <FaPercent />}
                  {editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Coupons Table */}
      {coupons.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
          <FaPercent className="text-4xl text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No coupons yet</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 text-left text-gray-500 dark:text-gray-400">
                  <th className="px-6 py-3">Code</th>
                  <th className="px-6 py-3">Discount</th>
                  <th className="px-6 py-3">Min Purchase</th>
                  <th className="px-6 py-3">Uses</th>
                  <th className="px-6 py-3">Expires</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 font-mono font-bold text-gray-900 dark:text-white">{c.code}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                      {c.discountType === 'percentage' ? `${c.discountValue}%` : `GH₵${parseFloat(c.discountValue).toFixed(2)}`}
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">GH₵{parseFloat(c.minPurchase || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{c.usesUsed || 0}/{c.maxUses || '∞'}</td>
                    <td className="px-6 py-4 text-gray-500 text-xs">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : 'Never'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${c.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEdit(c)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"><FaEdit /></button>
                        <button onClick={() => setDeleteConfirm(c)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"><FaTrash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Delete Coupon</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Are you sure you want to delete coupon "{deleteConfirm.code}"?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorCoupons;
