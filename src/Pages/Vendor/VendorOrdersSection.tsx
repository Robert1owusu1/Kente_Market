// Pages/Vendor/VendorOrdersSection.jsx
// Integrated order management with filters, status tracking, export
import { useState } from 'react';
import { FaTruck, FaMapMarkerAlt, FaBoxOpen, FaCheckCircle, FaClock, FaStickyNote, FaCalendarAlt, FaSpinner, FaSearch, FaDownload } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetVendorOrdersQuery,
  useUpdateVendorOrderStatusMutation,
} from '../../slices/vendorsApiSlice';
import Loader from '../../components/loader/Loader';
import type { KeyedState, Order, OrderItem } from '../../types/domain';

interface VendorOrderItem extends OrderItem {
  isCustomizable?: boolean;
}

interface VendorOrderRow extends Order {
  firstName?: string;
  lastName?: string;
  productionNote?: string;
  created_at?: string;
}

const itemName = (it: OrderItem) => it?.name || it?.title || 'Product';
const itemQty = (it: OrderItem) => parseInt(String(it?.quantity || it?.qty || 1), 10);

const statusBadge: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  packaging: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  shipped: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  arrived: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const PIPELINE = ['processing', 'packaging', 'shipped', 'arrived', 'delivered'];
const nextStatus: Record<string, { status: string; label: string; Icon: any }> = {
  processing: { status: 'packaging', label: 'Mark as Packaging', Icon: FaBoxOpen },
  packaging: { status: 'shipped', label: 'Mark as On its way', Icon: FaTruck },
  shipped: { status: 'arrived', label: 'Mark as Arrived', Icon: FaTruck },
  arrived: { status: 'delivered', label: 'Mark as Delivered', Icon: FaCheckCircle },
};

const VendorOrdersSection = () => {
  const { data, isLoading, refetch } = useGetVendorOrdersQuery();
  const orders = (data || []) as VendorOrderRow[];
  const [updateStatus, { isLoading: updating }] = useUpdateVendorOrderStatusMutation();
  const [busyOrderId, setBusyOrderId] = useState<number | string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [noteText, setNoteText] = useState<KeyedState<string, string>>({});
  const [completionDate, setCompletionDate] = useState<KeyedState<string, string>>({});

  const filteredOrders = orders.filter((o) => {
    const matchesSearch = !searchTerm || 
      (o.orderNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.firstName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.lastName || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !filterStatus || o.orderStatus === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const statuses = [...new Set(orders.map((o) => o.orderStatus))];

  const handleStatus = async (order: VendorOrderRow, status: string) => {
    setBusyOrderId(order.id);
    try {
      await updateStatus({ orderId: order.id, orderStatus: status }).unwrap();
      toast.success(`Order ${order.orderNumber} updated to ${status}`);
      refetch();
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || 'Failed to update order status');
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleProgress = async (order: VendorOrderRow) => {
    setBusyOrderId(order.id);
    try {
      await updateStatus({
        orderId: order.id,
        orderStatus: order.orderStatus,
        productionNote: noteText[String(order.id)] || undefined,
        expectedCompletionDate: completionDate[String(order.id)] || undefined,
      }).unwrap();
      toast.success('Order updated — customer has been notified');
      setNoteText((s) => ({ ...s, [String(order.id)]: '' }));
      setCompletionDate((s) => ({ ...s, [String(order.id)]: '' }));
      refetch();
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || 'Failed to save update');
    } finally {
      setBusyOrderId(null);
    }
  };

  const exportCSV = () => {
    const headers = ['Order #', 'Customer', 'Date', 'Items', 'Total', 'Status', 'Payment'];
    const rows = filteredOrders.map((o) => [
      o.orderNumber || `#${o.id}`,
      `${o.firstName || ''} ${o.lastName || ''}`.trim(),
      new Date(o.created_at || '').toLocaleDateString(),
      (Array.isArray(o.items) ? o.items.map((it) => `${itemName(it)} x${itemQty(it)}`).join('; ') : ''),
      o.totalAmount || 0,
      o.orderStatus,
      o.paymentStatus,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendor-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Orders exported');
  };

  if (isLoading) {
    return <div className="py-10 flex items-center justify-center"><Loader /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Orders</h2>
        <div className="flex items-center gap-3">
          <button onClick={refetch} className="text-sm text-primary hover:underline">Refresh</button>
          <button onClick={exportCSV} className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
            <FaDownload /> Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by order #, customer name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">All Statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
          <div className="text-5xl mb-3">📦</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No orders found</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {orders.length === 0 ? 'Customer orders containing your products will appear here.' : 'No orders match your filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const isCustomised = (Array.isArray(order.items) ? (order.items as VendorOrderItem[]) : []).some((it) => !!it.isCustomizable);
            const currentIdx = PIPELINE.indexOf(order.orderStatus || '');
            const step = currentIdx >= 0 && currentIdx < PIPELINE.length - 1 ? nextStatus[order.orderStatus || ''] : null;
            const lastNote = order.productionNote;

            return (
              <div key={order.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-5">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {order.orderNumber || `#${order.id}`}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {order.firstName ? `${order.firstName} ${order.lastName || ''}` : 'Customer'} ·{' '}
                      {new Date(order.created_at || '').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isCustomised && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                        Custom
                      </span>
                    )}
                    {typeof (order as { stockShortfall?: number }).stockShortfall === 'number' && (order as { stockShortfall?: number }).stockShortfall! > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                        Short of stock
                      </span>
                    )}
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${statusBadge[order.orderStatus || ''] || statusBadge.pending}`}>
                      {order.orderStatus}
                    </span>
                  </div>
                </div>

                {/* Items */}
                <div className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                  {(Array.isArray(order.items) ? order.items : []).map((it, i) => (
                    <span key={i} className="inline-flex items-center rounded-lg bg-gray-100 dark:bg-gray-700/50 px-2 py-1 mr-2 mb-1">
                      {itemName(it)} × {itemQty(it)}
                    </span>
                  ))}
                </div>

                {/* Delivery preference */}
                {(() => {
                  const sa = typeof order.shippingAddress === 'string'
                    ? (() => { try { return JSON.parse(order.shippingAddress as string); } catch { return {}; } })()
                    : (order.shippingAddress || {});
                  const del = sa as { deliveryMethod?: string; pickupStation?: string };
                  if (del && del.deliveryMethod === 'pickup') {
                    return (
                      <div className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 mb-3 text-xs font-medium">
                        <FaMapMarkerAlt /> Pickup: {String(del.pickupStation || 'station TBC')}
                      </div>
                    );
                  }
                  return (
                    <div className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-1 mb-3 text-xs font-medium">
                      <FaTruck /> Door-to-door delivery
                    </div>
                  );
                })()}

                {/* Progress pipeline */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4">
                  {PIPELINE.map((s, idx) => (
                    <span key={s} className={`flex items-center gap-1.5 text-xs font-medium ${
                      idx < currentIdx ? 'text-green-600 dark:text-green-400'
                      : idx === currentIdx ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-400 dark:text-gray-500'
                    }`}>
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        idx < currentIdx ? 'bg-green-500'
                        : idx === currentIdx ? 'bg-blue-500 animate-pulse'
                        : 'bg-gray-300 dark:bg-gray-600'
                      }`} />
                      {s}
                    </span>
                  ))}
                </div>

                {/* Customised production controls */}
                {isCustomised && order.orderStatus !== 'delivered' && (
                  <div className="mb-4 bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1">
                        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 mb-1">
                          <FaCalendarAlt /> Expected completion date
                        </label>
                        <input
                          type="date"
                          value={completionDate[String(order.id)] || ''}
                          onChange={(e) => setCompletionDate((s) => ({ ...s, [String(order.id)]: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 mb-1">
                          <FaStickyNote /> Progress note to customer
                        </label>
                        <input
                          type="text"
                          value={noteText[String(order.id)] || ''}
                          onChange={(e) => setNoteText((s) => ({ ...s, [String(order.id)]: e.target.value }))}
                          placeholder="e.g. Warp mounting complete, weaving underway"
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div className="sm:self-end">
                        <button
                          onClick={() => handleProgress(order)}
                          disabled={updating && busyOrderId === order.id}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium"
                        >
                          {updating && busyOrderId === order.id ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
                          Save Update
                        </button>
                      </div>
                    </div>
                    {lastNote && (
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        Last note: "{lastNote}"
                      </p>
                    )}
                  </div>
                )}

                {/* Next action button */}
                <div className="flex justify-end">
                  {step ? (
                    <button
                      onClick={() => handleStatus(order, step.status)}
                      disabled={updating && busyOrderId === order.id}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:opacity-90 disabled:opacity-60 font-medium"
                    >
                      {updating && busyOrderId === order.id ? <FaSpinner className="animate-spin" /> : <step.Icon />}
                      {step.label}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sm text-gray-400">
                      {order.orderStatus === 'delivered'
                        ? <><FaCheckCircle className="text-green-500" /> Delivered — awaiting customer confirmation</>
                        : <><FaClock /> Delivery complete</>}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default VendorOrdersSection;
