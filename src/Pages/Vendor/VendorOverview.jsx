// Pages/Vendor/VendorOverview.jsx
// Dashboard overview with stats cards, sales chart, recent orders
import { FaChartLine, FaShoppingCart, FaBox, FaWallet } from 'react-icons/fa';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useGetVendorAnalyticsQuery } from '../../slices/vendorsApiSlice';
import { formatCurrency } from '../../utils/formatCurrency';
import Loader from '../../components/loader/Loader.jsx';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const VendorOverview = () => {
  const { data: analytics, isLoading } = useGetVendorAnalyticsQuery();

  if (isLoading) {
    return <div className="py-10 flex items-center justify-center"><Loader /></div>;
  }

  if (!analytics) return null;

  const {
    totalProducts, totalOrders, totalRevenue,
    pendingOrders, processingOrders, deliveredOrders, cancelledOrders,
    ordersByStatus, salesChartData, topProducts, wallet,
  } = analytics;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Dashboard Overview</h2>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Revenue</p>
              <p className="text-2xl font-bold text-indigo-600">{formatCurrency(totalRevenue)}</p>
            </div>
            <FaChartLine className="text-3xl text-indigo-600/70" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Orders</p>
              <p className="text-2xl font-bold text-blue-600">{totalOrders}</p>
            </div>
            <FaShoppingCart className="text-3xl text-blue-600/70" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Products</p>
              <p className="text-2xl font-bold text-green-600">{totalProducts}</p>
            </div>
            <FaBox className="text-3xl text-green-600/70" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Available Balance</p>
              <p className="text-2xl font-bold text-amber-600">{formatCurrency(wallet?.available_balance || 0)}</p>
            </div>
            <FaWallet className="text-3xl text-amber-600/70" />
          </div>
        </div>
      </div>

      {/* Order Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
          <p className="text-2xl font-bold text-yellow-600">{pendingOrders}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Pending</p>
        </div>
        <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-2xl font-bold text-blue-600">{processingOrders}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Processing</p>
        </div>
        <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p className="text-2xl font-bold text-green-600">{deliveredOrders}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Delivered</p>
        </div>
        <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-2xl font-bold text-red-600">{cancelledOrders}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Cancelled</p>
        </div>
      </div>

      {/* Sales Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Sales Overview</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesChartData}>
              <defs>
                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: '#f9fafb' }}
                formatter={(value) => formatCurrency(value)}
              />
              <Area type="monotone" dataKey="sales" stroke="#4f46e5" fillOpacity={1} fill="url(#colorSales)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Row: Order Status + Top Products */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Order Status</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ordersByStatus}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {ordersByStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Top Products</h3>
          {topProducts.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No sales data yet</p>
          ) : (
            <div className="space-y-3">
              {topProducts.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gray-400 w-6">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[200px]">{p.name}</p>
                      <p className="text-xs text-gray-500">{p.quantity} sold</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-primary">{formatCurrency(p.revenue)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VendorOverview;
