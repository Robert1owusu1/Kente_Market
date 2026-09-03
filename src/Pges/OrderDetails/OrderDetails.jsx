// Pges/OrderDetails/OrderDetails.jsx
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  useGetOrderByIdQuery,
  useConfirmOrderReceivedMutation,
} from '../../slices/ordersApiSlice';
import Loader from '../../components/loader/Loader.jsx';
import {
  IoMdArrowBack,
} from 'react-icons/io';
import {
  FaShoppingBag,
  FaTruck,
  FaCheckCircle,
  FaShieldAlt,
  FaExclamationTriangle,
} from 'react-icons/fa';

const orderStatusStyles = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  shipped: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const escrowMeta = {
  none: { label: 'Standard checkout', icon: null, cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  held: { label: 'Held in escrow', icon: FaShieldAlt, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  releasing: { label: 'Release in progress', icon: FaTruck, cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  released: { label: 'Released to vendor', icon: FaCheckCircle, cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  failed: { label: 'Release failed', icon: FaExclamationTriangle, cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

const fmt = (n) =>
  `GH₵${(parseFloat(n) || 0).toFixed(2)}`;

const itemName = (it) => it?.name || it?.title || 'Product';
const itemQty = (it) => parseInt(it?.quantity || it?.qty || 1, 10);
const itemPrice = (it) => parseFloat(it?.price || it?.basePrice || 0) || 0;
const itemImg = (it) => it?.image || it?.img || '';

const OrderDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const {
    data: order,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetOrderByIdQuery(id);

  const [confirmOrderReceived] = useConfirmOrderReceivedMutation();

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await confirmOrderReceived(id).unwrap();
      toast.success('Receipt confirmed. Escrow released to the seller(s). 🎉');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || err?.message || 'Failed to confirm receipt');
    } finally {
      setConfirming(false);
    }
  };

  if (isLoading) return <div className="min-h-[60vh] flex items-center justify-center"><Loader /></div>;

  if (isError || !order) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <FaExclamationTriangle className="text-5xl text-red-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Could not load order</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {error?.data?.message || error?.message || 'The order could not be found.'}
        </p>
        <Link to="/orders" className="text-primary hover:underline">
          Back to my orders
        </Link>
      </div>
    );
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const escrow = escrowMeta[order.escrowStatus] || escrowMeta.none;
  const allocations = Array.isArray(order.escrowAllocations) ? order.escrowAllocations : [];
  const canConfirm = order.escrowStatus === 'held' && order.orderStatus === 'delivered';

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors"
        >
          <IoMdArrowBack /> Back
        </button>
        <Link to="/orders" className="text-sm text-primary hover:underline">
          View all orders
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Order</p>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
              {order.orderNumber || `#${order.id}`}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${orderStatusStyles[order.orderStatus] || orderStatusStyles.pending}`}>
              {order.orderStatus}
            </span>
            {order.paymentStatus === 'paid' ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                <FaCheckCircle /> Paid
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                {order.paymentStatus}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${escrow.cls}`}>
              {escrow.icon ? <escrow.icon /> : null} {escrow.label}
            </span>
          </div>
        </div>
      </div>

      {/* Escrow banner */}
      {order.escrowStatus !== 'none' && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <FaShieldAlt className={`mt-1 ${order.escrowStatus === 'failed' ? 'text-red-400' : 'text-amber-500'}`} />
              <div className="flex-1">
                <h2 className="font-semibold text-gray-900 dark:text-white mb-1">Buyer protection escrow</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Your money is held safely until you receive your order.
                  {order.escrowStatus === 'held' && !canConfirm && ' It will be released to the seller(s) once your order is delivered, or automatically after the release window.'}
                </p>

                {canConfirm && (
                  <button
                    onClick={handleConfirm}
                    disabled={confirming}
                    className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors font-semibold disabled:opacity-60"
                  >
                    <FaCheckCircle />
                    {confirming ? 'Releasing...' : 'I received my order - Release payment'}
                  </button>
                )}

                {order.escrowReleaseDeadline && order.escrowStatus === 'held' && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                    If no action is taken, funds auto-release on{' '}
                    {new Date(order.escrowReleaseDeadline).toLocaleString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}
                  </p>
                )}

                {allocations.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {allocations.map((a) => (
                      <div key={a.id} className="flex items-center justify-between text-sm rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{a.businessName || `Seller #${a.vendorId}`}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {a.status}{a.payoutReference ? ` · ref ${a.payoutReference}` : ''}
                          </p>
                        </div>
                        <p className="font-semibold text-gray-900 dark:text-white">{fmt(a.payoutAmount || a.amount)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Items */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <FaShoppingBag className="text-primary" /> Items ({items.length})
          </h3>
          <div className="space-y-4">
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-4 border-b border-gray-100 dark:border-gray-700 pb-4 last:border-0 last:pb-0">
                {itemImg(it) ? (
                  <img
                    src={itemImg(it)}
                    alt={itemName(it)}
                    className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                    <FaShoppingBag className="text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">{itemName(it)}</p>
                  {(it.selectedColor || it.selectedSize) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {[it.selectedColor, it.selectedSize].filter(Boolean).join(' / ')}
                    </p>
                  )}
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {fmt(itemPrice(it))} × {itemQty(it)} = {fmt(itemPrice(it) * itemQty(it))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
            <h3 className="font-semibold text-lg mb-4">Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Items total</span>
                <span>{fmt(order.totalAmount - (parseFloat(order.shippingCost) || 0) + (parseFloat(order.discount) || 0))}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Discount</span>
                  <span>- {fmt(order.discount)}</span>
                </div>
              )}
              {order.shippingCost > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Shipping</span>
                  <span>{fmt(order.shippingCost)}</span>
                </div>
              )}
              {order.tax > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Tax</span>
                  <span>{fmt(order.tax)}</span>
                </div>
              )}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex justify-between font-bold text-gray-900 dark:text-white">
                <span>Total</span>
                <span>{fmt(order.totalAmount)}</span>
              </div>
            </div>
          </div>

          {order.shippingAddress && Object.keys(order.shippingAddress).length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
              <h3 className="font-semibold text-lg mb-3">Shipping Address</h3>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {order.shippingAddress.firstName || order.shippingAddress.fullName} {order.shippingAddress.lastName}
                <br />
                {order.shippingAddress.address}
                <br />
                {[order.shippingAddress.city, order.shippingAddress.state, order.shippingAddress.zipCode || order.shippingAddress.postalCode].filter(Boolean).join(', ')}
                {order.shippingAddress.country ? `, ${order.shippingAddress.country}` : ''}
              </p>
              {order.shippingAddress.phone && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{order.shippingAddress.phone}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderDetails;