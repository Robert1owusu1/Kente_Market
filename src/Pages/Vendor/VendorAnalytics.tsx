// Pages/Vendor/VendorAnalytics.jsx
// Vendor analytics: revenue trends, top products, order breakdown
import { useGetVendorAnalyticsQuery } from '../../slices/vendorsApiSlice';
import { formatCurrency } from '../../utils/formatCurrency';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import Loader from '../../components/loader/Loader';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const VendorAnalytics = () => {
  const { data: analytics, isLoading } = useGetVendorAnalyticsQuery();

  if (isLoading) return <div className="py-10 flex items-center justify-center"><Loader /></div>;
  if (!analytics) return null;

  const { totalRevenue, avgOrderValue, totalOrders, ordersByStatus, salesChartData, topProducts, wallet } = analytics;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Analytics & Reports</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-sm text-gray-600 dark:text-gray-400 mb-2">Total Revenue</h3>
          <p className="text-3xl font-bold text-indigo-600">{formatCurrency(totalRevenue || 0, 'GHS')}</p>
          <p className="text-sm text-gray-500 mt-2">From {totalOrders} orders</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-sm text-gray-600 dark:text-gray-400 mb-2">Average Order Value</h3>
          <p className="text-3xl font-bold text-green-600">{formatCurrency(avgOrderValue, 'GHS')}</p>
          <p className="text-sm text-gray-500 mt-2">Per transaction</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-sm text-gray-600 dark:text-gray-400 mb-2">Total Earned</h3>
          <p className="text-3xl font-bold text-amber-600">{formatCurrency(wallet?.total_earned || 0, 'GHS')}</p>
          <p className="text-sm text-gray-500 mt-2">Lifetime earnings</p>
        </div>
      </div>

      {/* Sales Trend */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Sales Trend</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={salesChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: '#f9fafb' }}
                formatter={(value) => formatCurrency(Number(value) || 0, 'GHS')}
              />
              <Line type="monotone" dataKey="sales" stroke="#4f46e5" strokeWidth={2} dot={{ fill: '#4f46e5', r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Order Status Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Order Status Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ordersByStatus}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {ordersByStatus.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Orders by Month */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Orders by Month</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: '#f9fafb' }} />
                <Bar dataKey="orders" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Products */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Top Selling Products</h3>
        {topProducts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No sales data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Product</th>
                  <th className="pb-2 pr-4">Quantity Sold</th>
                  <th className="pb-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <td className="py-3 pr-4 font-bold text-gray-400">{i + 1}</td>
                    <td className="py-3 pr-4 font-medium text-gray-900 dark:text-white">{p.name}</td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{p.quantity}</td>
                    <td className="py-3 font-semibold text-primary">{formatCurrency(p.revenue, 'GHS')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default VendorAnalytics;
