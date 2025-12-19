import React, { useState, useMemo, useCallback } from 'react';
import { FaUsers, FaSearch, FaEye, FaTrash, FaSync, FaTimes, FaSpinner } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { 
  useGetUsersQuery, 
  useDeleteUserMutation, 
  useUpdateUserMutation 
} from '../../../slices/usersApiSlice';

// Utility functions
const sanitizeString = (str) => {
  if (!str) return '';
  return String(str).trim();
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(dateString));
  } catch {
    return 'Invalid Date';
  }
};

// Loading spinner component
const LoadingSpinner = ({ message = 'Loading...' }) => (
  <div className="p-8 text-center">
    <FaSpinner className="animate-spin h-12 w-12 text-indigo-600 mx-auto" />
    <p className="mt-4 text-gray-600 dark:text-gray-400">{message}</p>
  </div>
);

// Error display component
const ErrorDisplay = ({ message }) => (
  <div className="p-8 text-center">
    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-6">
      <p className="text-red-600 dark:text-red-400 font-medium">Error: {message}</p>
      <button 
        onClick={() => window.location.reload()} 
        className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
      >
        Retry
      </button>
    </div>
  </div>
);

// Customer Details Modal Component
const CustomerDetailsModal = ({ customer, onClose, onUpdate, onDelete }) => {
  const [isUpdating, setIsUpdating] = useState(false);

  if (!customer) return null;

  const handleRoleChange = async (newRole) => {
    if (!window.confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;
    setIsUpdating(true);
    await onUpdate(customer.id, { role: newRole });
    setIsUpdating(false);
    onClose();
  };

  const handleStatusToggle = async () => {
    const newStatus = !customer.isActive;
    if (!window.confirm(`Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} this user?`)) return;
    setIsUpdating(true);
    await onUpdate(customer.id, { isActive: newStatus });
    setIsUpdating(false);
    onClose();
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to permanently delete this user? This action cannot be undone.')) return;
    setIsUpdating(true);
    await onDelete(customer.id);
    setIsUpdating(false);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b dark:border-gray-700 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800 z-10">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Customer Details</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100">
            <FaTimes size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <section>
            <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-white">Personal Information</h3>
            <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-700 p-4 rounded">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">First Name</p>
                <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(customer.firstName)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Last Name</p>
                <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(customer.lastName)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Email</p>
                <p className="font-medium break-all text-gray-800 dark:text-white">{sanitizeString(customer.email)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Phone</p>
                <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(customer.phone) || 'Not provided'}</p>
              </div>
            </div>
          </section>

          {(customer.address || customer.city || customer.state) && (
            <section>
              <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-white">Address</h3>
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded text-gray-800 dark:text-white">
                {customer.address && <p>{sanitizeString(customer.address)}</p>}
                <p>{[customer.city, customer.state, customer.zipCode].filter(Boolean).map(sanitizeString).join(', ')}</p>
                {customer.country && <p>{sanitizeString(customer.country)}</p>}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-white">Account Information</h3>
            <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-700 p-4 rounded">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Role</p>
                <p className="font-medium capitalize text-gray-800 dark:text-white">{customer.role}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Status</p>
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                  customer.isActive 
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                }`}>
                  {customer.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Joined</p>
                <p className="font-medium text-gray-800 dark:text-white">{formatDate(customer.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Last Updated</p>
                <p className="font-medium text-gray-800 dark:text-white">{formatDate(customer.updated_at)}</p>
              </div>
              {customer.isEmailVerified !== undefined && (
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Email Verified</p>
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                    customer.isEmailVerified 
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                  }`}>
                    {customer.isEmailVerified ? 'Verified' : 'Not Verified'}
                  </span>
                </div>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <select
                onChange={(e) => handleRoleChange(e.target.value)}
                defaultValue={customer.role}
                disabled={isUpdating}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 disabled:opacity-50 text-gray-800 dark:text-white"
              >
                <option value="customer">Customer</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={handleStatusToggle}
                disabled={isUpdating}
                className={`flex-1 px-6 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                  customer.isActive
                    ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {isUpdating ? 'Processing...' : (customer.isActive ? 'Deactivate' : 'Activate')}
              </button>
            </div>
            <button
              onClick={handleDelete}
              disabled={isUpdating || customer.role === 'admin'}
              className="w-full px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {customer.role === 'admin' ? 'Cannot Delete Admin' : (isUpdating ? 'Processing...' : 'Delete Customer')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main Customers Page Component
const CustomersPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // RTK Query hooks
  const { data: customers = [], isLoading, error, refetch } = useGetUsersQuery();
  const [deleteUserMutation] = useDeleteUserMutation();
  const [updateUserMutation] = useUpdateUserMutation();

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    if (!Array.isArray(customers)) return [];
    
    let filtered = [...customers];

    // Filter by role
    if (roleFilter !== 'all') {
      filtered = filtered.filter(c => c.role === roleFilter);
    }

    // Filter by status
    if (statusFilter === 'active') {
      filtered = filtered.filter(c => c.isActive);
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter(c => !c.isActive);
    }

    // Search filter
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(customer => {
        const firstName = sanitizeString(customer.firstName).toLowerCase();
        const lastName = sanitizeString(customer.lastName).toLowerCase();
        const email = sanitizeString(customer.email).toLowerCase();
        const role = (customer.role || '').toLowerCase();
        
        return firstName.includes(query) || lastName.includes(query) || email.includes(query) || role.includes(query);
      });
    }

    return filtered;
  }, [customers, searchQuery, roleFilter, statusFilter]);

  // Customer statistics
  const stats = useMemo(() => ({
    total: customers.length,
    active: customers.filter(c => c.isActive).length,
    inactive: customers.filter(c => !c.isActive).length,
    admins: customers.filter(c => c.role === 'admin').length,
    verified: customers.filter(c => c.isEmailVerified).length,
  }), [customers]);

  // Customer operations
  const handleUpdateCustomer = useCallback(async (userId, updateData) => {
    try {
      await updateUserMutation({ userId, ...updateData }).unwrap();
      toast.success('Customer updated successfully');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update customer');
    }
  }, [updateUserMutation, refetch]);

  const handleDeleteCustomer = useCallback(async (userId) => {
    if (!window.confirm('Are you sure you want to delete this customer?')) return;
    try {
      await deleteUserMutation(userId).unwrap();
      toast.success('Customer deleted successfully');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to delete customer');
    }
  }, [deleteUserMutation, refetch]);

  if (isLoading) return <LoadingSpinner message="Loading customers..." />;
  if (error) return <ErrorDisplay message={error?.data?.message || 'Failed to load customers'} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Customer Management</h2>
        <button 
          onClick={refetch} 
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
        >
          <FaSync className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Customers</p>
          <p className="text-2xl font-bold text-indigo-600">{stats.total}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Active</p>
          <p className="text-2xl font-bold text-green-600">{stats.active}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Inactive</p>
          <p className="text-2xl font-bold text-red-600">{stats.inactive}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Admins</p>
          <p className="text-2xl font-bold text-purple-600">{stats.admins}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Verified</p>
          <p className="text-2xl font-bold text-blue-600">{stats.verified}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <input 
            type="text" 
            placeholder="Search by name, email, or role..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-gray-800 dark:text-white" 
          />
          <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
        </div>
        <select 
          value={roleFilter} 
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
        >
          <option value="all">All Roles</option>
          <option value="customer">Customer</option>
          <option value="admin">Admin</option>
        </select>
        <select 
          value={statusFilter} 
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Customers Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {filteredCustomers.length === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">
            <FaUsers className="mx-auto text-4xl mb-4 opacity-50" />
            <p>{searchQuery ? 'No customers match your search' : 'No customers found'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="p-4">Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-4">
                      <div>
                        <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(customer.firstName)} {sanitizeString(customer.lastName)}</p>
                        {customer.isEmailVerified && <span className="text-xs text-blue-600 dark:text-blue-400">✓ Verified</span>}
                      </div>
                    </td>
                    <td className="text-sm truncate max-w-xs text-gray-800 dark:text-white">{sanitizeString(customer.email)}</td>
                    <td className="text-sm text-gray-800 dark:text-white">{sanitizeString(customer.phone) || 'N/A'}</td>
                    <td>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        customer.role === 'admin' 
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' 
                          : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                      }`}>
                        {customer.role}
                      </span>
                    </td>
                    <td>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        customer.isActive 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }`}>
                        {customer.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="text-sm text-gray-800 dark:text-white">
                      {new Date(customer.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => { setSelectedCustomer(customer); setShowModal(true); }} 
                          className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded"
                          title="View Details"
                        >
                          <FaEye />
                        </button>
                        <button 
                          onClick={() => handleDeleteCustomer(customer.id)} 
                          disabled={customer.role === 'admin'} 
                          className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded disabled:opacity-50"
                          title={customer.role === 'admin' ? 'Cannot delete admin' : 'Delete Customer'}
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer Details Modal */}
      {showModal && selectedCustomer && (
        <CustomerDetailsModal 
          customer={selectedCustomer} 
          onClose={() => { setShowModal(false); setSelectedCustomer(null); }} 
          onUpdate={handleUpdateCustomer} 
          onDelete={handleDeleteCustomer} 
        />
      )}
    </div>
  );
};

export default CustomersPage;