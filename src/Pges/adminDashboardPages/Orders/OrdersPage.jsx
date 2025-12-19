import React, { useState, useMemo, useCallback } from 'react';
import { FaShoppingCart, FaSearch, FaEye, FaTrash, FaCheck, FaTimes, FaDownload, FaSpinner } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { 
  useGetAllOrdersQuery, 
  useUpdateOrderMutation, 
  useDeleteOrderMutation,
  useUpdateOrderToDeliveredMutation 
} from '../../../slices/ordersApiSlice';

// Utility functions
const sanitizeString = (str) => {
  if (!str) return '';
  return String(str).trim();
};

const safeParseJSON = (data, fallback = null) => {
  if (!data) return fallback;
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(data);
  } catch {
    return fallback;
  }
};

const formatCurrency = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(num);
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

// Status badge component
const StatusBadge = ({ status }) => {
  const statusConfig = {
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', darkBg: 'dark:bg-yellow-900', darkText: 'dark:text-yellow-200' },
    processing: { bg: 'bg-blue-100', text: 'text-blue-800', darkBg: 'dark:bg-blue-900', darkText: 'dark:text-blue-200' },
    delivered: { bg: 'bg-green-100', text: 'text-green-800', darkBg: 'dark:bg-green-900', darkText: 'dark:text-green-200' },
    cancelled: { bg: 'bg-red-100', text: 'text-red-800', darkBg: 'dark:bg-red-900', darkText: 'dark:text-red-200' }
  };

  const config = statusConfig[status] || statusConfig.pending;
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text} ${config.darkBg} ${config.darkText}`}>
      {label}
    </span>
  );
};

// Payment badge component
const PaymentBadge = ({ status }) => {
  const isPaid = status === 'paid';
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
      isPaid 
        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    }`}>
      {isPaid ? 'Paid' : 'Unpaid'}
    </span>
  );
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

// Order Details Modal Component
const OrderDetailsModal = ({ order, onClose, onUpdate, onDelete }) => {
  const [isUpdating, setIsUpdating] = useState(false);

  if (!order) return null;

  const items = safeParseJSON(order.items, []);
  const shippingAddress = safeParseJSON(order.shippingAddress, {});

  const handleStatusChange = async (newStatus) => {
    setIsUpdating(true);
    await onUpdate(order.id, newStatus);
    setIsUpdating(false);
    onClose();
  };

  const handleDelete = async () => {
    setIsUpdating(true);
    await onDelete(order.id);
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
        className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b dark:border-gray-700 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800 z-10">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Order Details - {sanitizeString(order.orderNumber)}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100">
            <FaTimes size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <section>
            <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-white">Customer Information</h3>
            <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-700 p-4 rounded">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Name</p>
                <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(order.firstName)} {sanitizeString(order.lastName)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Email</p>
                <p className="font-medium break-all text-gray-800 dark:text-white">{sanitizeString(order.email)}</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-white">Order Information</h3>
            <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-700 p-4 rounded">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Order Date</p>
                <p className="font-medium text-gray-800 dark:text-white">{formatDate(order.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Payment Method</p>
                <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(order.paymentMethod).replace('_', ' ').toUpperCase()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Order Status</p>
                <StatusBadge status={order.orderStatus} />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Payment Status</p>
                <PaymentBadge status={order.paymentStatus} />
              </div>
            </div>
          </section>

          {shippingAddress && Object.keys(shippingAddress).length > 0 && (
            <section>
              <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-white">Shipping Address</h3>
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded text-gray-800 dark:text-white">
                <p>{sanitizeString(shippingAddress.street)}</p>
                <p>{sanitizeString(shippingAddress.city)}, {sanitizeString(shippingAddress.state)} {sanitizeString(shippingAddress.zip)}</p>
              </div>
            </section>
          )}

          <section>
            <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-white">Order Items</h3>
            <div className="space-y-2">
              {items.length > 0 ? items.map((item, index) => (
                <div key={index} className="flex justify-between items-center bg-gray-50 dark:bg-gray-700 p-3 rounded">
                  <div>
                    <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(item.name || item.productName || 'Product')}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Qty: {Number(item.quantity || item.qty || 1)}</p>
                  </div>
                  <p className="font-semibold text-gray-800 dark:text-white">{formatCurrency((Number(item.price) || 0) * (Number(item.quantity || item.qty) || 1))}</p>
                </div>
              )) : (
                <p className="text-gray-500 text-center py-4">No items found</p>
              )}
            </div>
            
            <div className="mt-4 pt-4 border-t dark:border-gray-700 space-y-2 text-gray-800 dark:text-white">
              {Number(order.shippingCost) > 0 && (
                <div className="flex justify-between">
                  <span>Shipping:</span>
                  <span>{formatCurrency(order.shippingCost)}</span>
                </div>
              )}
              {Number(order.tax) > 0 && (
                <div className="flex justify-between">
                  <span>Tax:</span>
                  <span>{formatCurrency(order.tax)}</span>
                </div>
              )}
              {Number(order.discount) > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount:</span>
                  <span>-{formatCurrency(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-xl font-bold pt-2 border-t dark:border-gray-700">
                <span>Total:</span>
                <span>{formatCurrency(order.totalAmount)}</span>
              </div>
            </div>
          </section>

          <div className="flex gap-3 flex-col sm:flex-row">
            <select
              onChange={(e) => handleStatusChange(e.target.value)}
              defaultValue={order.orderStatus}
              disabled={isUpdating}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 disabled:opacity-50 text-gray-800 dark:text-white"
            >
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button
              onClick={handleDelete}
              disabled={isUpdating}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {isUpdating ? 'Processing...' : 'Delete Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main Orders Page Component
const OrdersPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('date-desc');
  const [showModal, setShowModal] = useState(false);

  // RTK Query hooks
  const { data: orders = [], isLoading, error, refetch } = useGetAllOrdersQuery();
  const [updateOrder] = useUpdateOrderMutation();
  const [deleteOrderMutation] = useDeleteOrderMutation();
  const [updateOrderToDelivered] = useUpdateOrderToDeliveredMutation();

  // Memoized filtered and sorted orders
  const filteredOrders = useMemo(() => {
    if (!Array.isArray(orders) || orders.length === 0) return [];
    
    let filtered = [...orders];

    if (filterStatus !== 'all') {
      filtered = filtered.filter(order => order.orderStatus === filterStatus);
    }

    const query = searchQuery.toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(order => {
        const orderNumber = sanitizeString(order.orderNumber).toLowerCase();
        const fullName = `${sanitizeString(order.firstName)} ${sanitizeString(order.lastName)}`.toLowerCase();
        const email = sanitizeString(order.email).toLowerCase();
        
        return orderNumber.includes(query) || fullName.includes(query) || email.includes(query);
      });
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        case 'date-asc':
          return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        case 'amount-desc':
          return (Number(b.totalAmount) || 0) - (Number(a.totalAmount) || 0);
        case 'amount-asc':
          return (Number(a.totalAmount) || 0) - (Number(b.totalAmount) || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [orders, searchQuery, filterStatus, sortBy]);

  // Statistics
  const stats = useMemo(() => ({
    totalSales: orders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0),
    totalOrders: orders.length,
    pendingOrders: orders.filter(o => o.orderStatus === 'pending').length,
    deliveredOrders: orders.filter(o => o.orderStatus === 'delivered').length,
  }), [orders]);

  // Order operations
  const handleUpdateStatus = useCallback(async (orderId, newStatus) => {
    try {
      await updateOrder({ orderId, orderStatus: newStatus }).unwrap();
      toast.success('Order status updated successfully');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update order status');
    }
  }, [updateOrder, refetch]);

  const handleMarkDelivered = useCallback(async (orderId) => {
    try {
      await updateOrderToDelivered(orderId).unwrap();
      toast.success('Order marked as delivered');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to mark order as delivered');
    }
  }, [updateOrderToDelivered, refetch]);

  const handleDeleteOrder = useCallback(async (orderId) => {
    if (!window.confirm('Are you sure you want to delete this order?')) return;
    try {
      await deleteOrderMutation(orderId).unwrap();
      toast.success('Order deleted successfully');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to delete order');
    }
  }, [deleteOrderMutation, refetch]);

  const handleExportOrders = useCallback(() => {
    try {
      const csv = [
        ['Order Number', 'Customer', 'Email', 'Date', 'Amount', 'Status', 'Payment'],
        ...filteredOrders.map(order => [
          order.orderNumber,
          `${order.firstName} ${order.lastName}`,
          order.email,
          formatDate(order.created_at),
          order.totalAmount,
          order.orderStatus,
          order.paymentStatus
        ])
      ].map(row => row.join(',')).join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Orders exported successfully');
    } catch (err) {
      toast.error('Failed to export orders');
    }
  }, [filteredOrders]);

  if (isLoading) return <LoadingSpinner message="Loading orders..." />;
  if (error) return <ErrorDisplay message={error?.data?.message || 'Failed to load orders'} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Order Management</h2>
          <button 
            onClick={handleExportOrders} 
            disabled={filteredOrders.length === 0} 
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <FaDownload /> Export Orders
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder="Search by order number, customer name, or email..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-gray-800 dark:text-white" 
            />
            <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>
          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)} 
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)} 
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="amount-desc">Highest Amount</option>
            <option value="amount-asc">Lowest Amount</option>
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">
            <FaShoppingCart className="mx-auto text-4xl mb-4 opacity-50" />
            <p>No orders found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="p-4">Order #</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-4 font-medium text-gray-800 dark:text-white">{sanitizeString(order.orderNumber)}</td>
                    <td>
                      <div>
                        <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(order.firstName)} {sanitizeString(order.lastName)}</p>
                        <p className="text-sm text-gray-500 truncate max-w-xs">{sanitizeString(order.email)}</p>
                      </div>
                    </td>
                    <td className="text-sm text-gray-800 dark:text-white">{formatDate(order.created_at)}</td>
                    <td className="font-semibold text-gray-800 dark:text-white">{formatCurrency(order.totalAmount)}</td>
                    <td><PaymentBadge status={order.paymentStatus} /></td>
                    <td><StatusBadge status={order.orderStatus} /></td>
                    <td>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => { setSelectedOrder(order); setShowModal(true); }} 
                          className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded"
                          title="View Details"
                        >
                          <FaEye />
                        </button>
                        <button 
                          onClick={() => handleMarkDelivered(order.id)} 
                          className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900 rounded"
                          title="Mark as Delivered"
                        >
                          <FaCheck />
                        </button>
                        <button 
                          onClick={() => handleDeleteOrder(order.id)} 
                          className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded"
                          title="Delete Order"
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

      {/* Statistics Cards */}
      {filteredOrders.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
            <p className="text-sm text-gray-600 dark:text-gray-400">Filtered Orders</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{filteredOrders.length}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Revenue</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{formatCurrency(filteredOrders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0))}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
            <p className="text-sm text-gray-600 dark:text-gray-400">Pending</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{filteredOrders.filter(o => o.orderStatus === 'pending').length}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
            <p className="text-sm text-gray-600 dark:text-gray-400">Delivered</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{filteredOrders.filter(o => o.orderStatus === 'delivered').length}</p>
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      {showModal && selectedOrder && (
        <OrderDetailsModal 
          order={selectedOrder} 
          onClose={() => { setShowModal(false); setSelectedOrder(null); }} 
          onUpdate={handleUpdateStatus} 
          onDelete={handleDeleteOrder} 
        />
      )}
    </div>
  );
};

export default OrdersPage;