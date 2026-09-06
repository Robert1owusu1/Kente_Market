// Pages/Vendor/VendorStaff.jsx
// Vendor staff management: invite team members with scoped permissions.
import { useState } from 'react';
import { FaUsers, FaSpinner, FaTrash, FaPlus, FaTimes, FaUserCog } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetVendorStaffQuery,
  useCreateVendorStaffMutation,
  useDeleteVendorStaffMutation,
} from '../../slices/marketplaceApiSlice';

const ALL_PERMISSIONS = [
  'manage_orders',
  'view_customers',
  'manage_inventory',
  'view_earnings',
  'manage_products',
  'manage_coupons',
  'reply_reviews',
  'manage_staff',
];

const permLabels = {
  manage_orders: 'Manage orders & fulfilment',
  view_customers: 'View customer details',
  manage_inventory: 'Manage inventory & stock',
  view_earnings: 'View earnings & payout',
  manage_products: 'Manage products',
  manage_coupons: 'Manage coupons',
  reply_reviews: 'Reply to reviews',
  manage_staff: 'Manage staff',
};

const statusBadge = (status) =>
  status === 'active'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';

const CreateStaffModal = ({ onClose }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [permissions, setPermissions] = useState(['manage_products', 'manage_orders']);
  const [createStaff, { isLoading }] = useCreateVendorStaffMutation();

  const toggle = (p) =>
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createStaff({ name: name.trim(), email: email.trim(), password, permissions }).unwrap();
      toast.success('Staff member added');
      onClose();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to add staff');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2"><FaUserCog /> Add staff member</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><FaTimes /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Temporary password (min 8 chars)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Permissions</label>
            <div className="space-y-2">
              {ALL_PERMISSIONS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={permissions.includes(p)}
                    onChange={() => toggle(p)}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  {permLabels[p] || p}
                </label>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isLoading ? <FaSpinner className="animate-spin" /> : <FaPlus />} Add staff
          </button>
        </form>
      </div>
    </div>
  );
};

const VendorStaff = () => {
  const [showCreate, setShowCreate] = useState(false);
  const { data: staff = [], isLoading, isError } = useGetVendorStaffQuery();
  const [deleteStaff, { isLoading: deleting }] = useDeleteVendorStaffMutation();

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Remove ${name}? They will lose access immediately.`)) return;
    try {
      await deleteStaff(id).unwrap();
      toast.success('Staff member removed');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to remove staff');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Team & Staff</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 inline-flex items-center gap-2 text-sm"
        >
          <FaPlus /> Add staff
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center">
          <FaSpinner className="animate-spin h-10 w-10 text-indigo-600 mx-auto" />
        </div>
      ) : isError ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-red-600 dark:text-red-400 font-medium">Failed to load staff.</p>
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
          <FaUsers className="mx-auto text-4xl mb-4 opacity-50" />
          <p>No staff members yet. Add your team to help manage the store.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {staff.map((s) => (
            <div key={s.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-300 font-bold">
                    {s.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{s.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{s.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge(s.status)}`}>
                    {s.status}
                  </span>
                  <button
                    onClick={() => handleDelete(s.id, s.name)}
                    disabled={deleting}
                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900 rounded"
                    title="Remove staff"
                  >
                    <FaTrash />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(s.permissions || []).map((p) => (
                  <span key={p} className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {permLabels[p] || p}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateStaffModal onClose={() => setShowCreate(false)} />}
    </div>
  );
};

export default VendorStaff;