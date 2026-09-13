// Pages/OrderDetails/OrderDetails.jsx
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  useGetOrderByIdQuery,
  useConfirmOrderReceivedMutation,
} from '../../slices/ordersApiSlice';
import Loader from '../../components/loader/Loader';
import {
  IoMdArrowBack,
} from 'react-icons/io';
import {
  FaShoppingBag,
  FaTruck,
  FaCheckCircle,
  FaShieldAlt,
  FaExclamationTriangle,
  FaUndo,
} from 'react-icons/fa';
import ReturnRequestModal from '../../components/ReturnRequest/ReturnRequestModal';

const orderStatusStyles = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  packaging: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  shipped: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  arrived: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
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

type EscrowStatusKey = 'none' | 'held' | 'releasing' | 'released' | 'failed';

type LineItem = {
  name?: string;
  title?: string;
  quantity?: number | string;
  qty?: number | string;
  price?: number | string;
  basePrice?: number | string;
  image?: string;
  img?: string;
  selectedColor?: string | null;
  selectedSize?: string | null;
  yards?: string | number | null;
  isCustomizable?: boolean;
};

interface EscrowAllocation {
  id?: number | string;
  status?: string;
  payoutReference?: string;
  businessName?: string;
  vendorId?: number | string;
  payoutAmount?: number | string;
  amount?: number | string;
}

const fmt = (n?: number | string | null) =>
  `GH₵${(parseFloat(String(n)) || 0).toFixed(2)}`;

const itemName = (it: LineItem) => it?.name || it?.title || 'Product';
const itemQty = (it: LineItem) => parseInt(String(it?.quantity || it?.qty || 1), 10);
const itemPrice = (it: LineItem) => parseFloat(String(it?.price || it?.basePrice || 0)) || 0;
const itemImg = (it: LineItem) => it?.image || it?.img || '';

const OrderDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);

  const {
    data: order,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetOrderByIdQuery(id as number | string);
  const orderError = error as { data?: { message?: string }; message?: string } | undefined;

  const [confirmOrderReceived] = useConfirmOrderReceivedMutation();

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await confirmOrderReceived(id as number | string).unwrap();
      toast.success('Receipt confirmed. Escrow released to the seller(s). 🎉');
      refetch();
    } catch (err) {
      const apiErr = err as { data?: { message?: string }; message?: string } | undefined;
      toast.error(apiErr?.data?.message || apiErr?.message || 'Failed to confirm receipt');
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
          {orderError?.data?.message || orderError?.message || 'The order could not be found.'}
        </p>
        <Link to="/orders" className="text-primary hover:underline">
          Back to my orders
        </Link>
      </div>
    );
  }

  const items: LineItem[] = Array.isArray(order.items) ? (order.items as unknown as LineItem[]) : [];
  const escrowStatus = order.escrowStatus as EscrowStatusKey | undefined;
  const escrow = escrowMeta[escrowStatus as EscrowStatusKey] || escrowMeta.none;
  const allocations = (Array.isArray(order.escrowAllocations) ? order.escrowAllocations : []) as unknown as EscrowAllocation[];
  const canConfirm = escrowStatus === 'held' && order.orderStatus === 'delivered';
  const productionNote = order.productionNote as string | undefined;
  const escrowReleaseDeadline = order.escrowReleaseDeadline as string | undefined;
  const shippingAddress = (order.shippingAddress || {}) as Record<string, string | undefined>;

  // Customised (custom-woven) order progress
  const isCustomised = items.some((it) => it.isCustomizable);
  let completionDate: Date | null = null;
  let daysLeft: number | null = null;
  if (order.expectedCompletionDate) {
    completionDate = new Date(order.expectedCompletionDate as string);
    if (!isNaN(completionDate.getTime())) {
      daysLeft = Math.ceil((completionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    }
  }
  const productionPipeline = ['processing', 'packaging', 'shipped', 'arrived', 'delivered'];
  const currentStepIdx = productionPipeline.indexOf(order.orderStatus as string);
  const productionStep = (label: string, key: string) => (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${
      currentStepIdx >= productionPipeline.indexOf(key)
        ? 'text-blue-600 dark:text-blue-400'
        : 'text-gray-400 dark:text-gray-500'
    }`}>
      <span className={`w-2.5 h-2.5 rounded-full ${
        currentStepIdx > productionPipeline.indexOf(key)
          ? 'bg-green-500'
          : currentStepIdx === productionPipeline.indexOf(key)
            ? 'bg-blue-500 animate-pulse'
            : 'bg-gray-300 dark:bg-gray-600'
      }`} />
      {label}
    </span>
  );

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
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${orderStatusStyles[order.orderStatus as keyof typeof orderStatusStyles] || orderStatusStyles.pending}`}>
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

      {/* Customised order — weaving progress */}
      {isCustomised && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🧶</span>
            <h2 className="font-semibold text-gray-900 dark:text-white">Custom woven order</h2>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              Being woven to order
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {completionDate && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Expected completion</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {completionDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
                {daysLeft !== null && (
                  <p className={`text-sm font-bold ${daysLeft >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}`}>
                    {daysLeft >= 0 ? `~${daysLeft} day${daysLeft === 1 ? '' : 's'} left to finish weaving` : 'Completed ahead of schedule'}
                  </p>
                )}
              </div>
            )}
            <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Status</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {productionStep('Processing', 'processing')}
                {productionStep('Packaging', 'packaging')}
                {productionStep('On its way', 'shipped')}
                {productionStep('Arrived', 'arrived')}
                {productionStep('Delivered', 'delivered')}
              </div>
            </div>
          </div>

          {productionNote && (
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3">
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">Latest update from the seller</p>
              <p className="text-sm text-blue-900 dark:text-blue-200">{productionNote}</p>
            </div>
          )}
        </div>
      )}

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

                {escrowReleaseDeadline && order.escrowStatus === 'held' && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                    If no action is taken, funds auto-release on{' '}
                    {new Date(escrowReleaseDeadline).toLocaleString('en-US', {
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

      {/* Return Request */}
      {order.orderStatus === 'delivered' && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <FaUndo className="text-red-500 mt-1" />
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Need to return this order?</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Request a return or refund if something isn't right with your delivered items.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowReturnModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium text-sm"
            >
              <FaUndo /> Request Return
            </button>
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
                  {(it.selectedColor || it.selectedSize || it.yards) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {[it.selectedColor, it.yards != null ? `${it.yards} yd` : it.selectedSize]
                        .filter(Boolean).join(' / ')}
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
                <span>{fmt(Number(order.totalAmount) - (Number(order.shippingCost) || 0) + (Number(order.discount) || 0))}</span>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Discount</span>
                  <span>- {fmt(order.discount)}</span>
                </div>
              )}
              {Number(order.shippingCost) > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Shipping</span>
                  <span>{fmt(order.shippingCost)}</span>
                </div>
              )}
              {Number(order.tax) > 0 && (
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
              <h3 className="font-semibold text-lg mb-3">
                {shippingAddress.deliveryMethod === 'pickup' ? 'Pickup Details' : 'Shipping Address'}
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {shippingAddress.firstName || shippingAddress.fullName} {shippingAddress.lastName}
                <br />
                {shippingAddress.address}
                <br />
                {[shippingAddress.city, shippingAddress.state, shippingAddress.zipCode || shippingAddress.postalCode].filter(Boolean).join(', ')}
                {shippingAddress.country ? `, ${shippingAddress.country}` : ''}
              </p>
              {shippingAddress.phone && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{shippingAddress.phone}</p>
              )}
              {shippingAddress.deliveryMethod === 'pickup' && shippingAddress.pickupStation && (
                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <span className="inline-block px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full mb-2">Pickup</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {shippingAddress.pickupStation}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Collect your order from this station once it's delivered.
                  </p>
                </div>
              )}
              {shippingAddress.deliveryMethod === 'home' && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Door-to-door delivery to your address.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Return Request Modal */}
      {showReturnModal && (
        <ReturnRequestModal
          orderId={Number(id!)}
          onClose={() => setShowReturnModal(false)}
          onSuccess={() => {
            setShowReturnModal(false);
            toast.success('Return request submitted');
          }}
        />
      )}
    </div>
  );
};

export default OrderDetails;