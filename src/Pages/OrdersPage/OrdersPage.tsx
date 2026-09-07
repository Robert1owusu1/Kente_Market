// Pages/OrdersPage/OrdersPage.jsx
import { Link } from 'react-router-dom';
import { useGetMyOrdersQuery } from '../../slices/ordersApiSlice';
import Loader from '../../components/loader/Loader';
import { FaShoppingBag, FaShieldAlt } from 'react-icons/fa';

const escrowMap = { held: 'Escrow', released: 'Released', releasing: 'Releasing', failed: 'Failed', none: '' } as const;
const escrowLabel = (s: string) => (escrowMap[s as keyof typeof escrowMap] || '');

const fmt = (n: unknown) => `GH₵${(parseFloat(String(n)) || 0).toFixed(2)}`;

const OrdersPage = () => {
  const { data: orders, isLoading, isError, error } = useGetMyOrdersQuery();
  const err = error as { data?: { message?: string }; message?: string; error?: string } | undefined;

  if (isLoading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader /></div>;
  }

  if (isError) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-red-500 mb-4">{err?.data?.message || err?.message || 'Failed to load orders'}</p>
        <Link to="/" className="text-primary hover:underline">Back to home</Link>
      </div>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <FaShoppingBag className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-6" />
        <h1 className="text-2xl font-bold text-gray-600 dark:text-gray-400 mb-4">No orders yet</h1>
        <p className="text-gray-500 dark:text-gray-500 mb-6">Start shopping to see your orders here.</p>
        <Link to="/products" className="inline-flex items-center gap-2 bg-primary text-white px-8 py-3 rounded-lg hover:bg-primary/90 font-semibold">
          <FaShoppingBag /> Browse Products
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold mb-6">My Orders</h1>
      <div className="space-y-4">
        {orders.map((order) => (
          <Link
            key={order.id}
            to={`/order/${order.id}`}
            className="block bg-white dark:bg-gray-800 rounded-lg p-5 shadow-md hover:shadow-lg transition-shadow"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Order</p>
                <p className="font-mono font-semibold text-gray-900 dark:text-white text-sm truncate">
                  {order.orderNumber || `#${order.id}`}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Date</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {new Date(order.created_at || '').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
                <p className="text-sm font-bold text-primary">{fmt(order.totalAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                <div className="flex flex-wrap gap-1">
                  <span className="px-2 py-0.5 rounded-full text-xs capitalize bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                    {order.orderStatus}
                  </span>
                  {Boolean(order.escrowStatus) && order.escrowStatus !== 'none' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400">
                      <FaShieldAlt /> {escrowLabel(String(order.escrowStatus))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default OrdersPage;