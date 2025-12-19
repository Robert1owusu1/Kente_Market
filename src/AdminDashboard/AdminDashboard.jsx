// FILE LOCATION: src/components/AdminDashboard.jsx
// DESCRIPTION: Enhanced Admin Dashboard with real data, analytics, and settings

import React, { useState, useMemo, useEffect } from 'react';
import { FaHome, FaBox, FaShoppingCart, FaUsers, FaChartLine, FaCog } from 'react-icons/fa';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import ProductsPage from '../Pges/adminDashboardPages/products/ProductsPage';
import OrdersPage from '../Pges/adminDashboardPages/Orders/OrdersPage';
import CustomersPage from '../Pges/adminDashboardPages/Customers/CustomersPage';
import { useGetAllOrdersQuery } from '../slices/ordersApiSlice';
import { useGetSettingsQuery, useUpdateSettingsMutation } from '../slices/settingsApiSlice';

const formatCurrency = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(num);
};

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [settings, setSettings] = useState({
    siteName: 'Branding House',
    email: 'admin@brandinghouse.com',
    currency: 'USD',
    taxRate: 10,
    shippingCost: 5.00,
    notifications: true,
    emailNotifications: true,
    orderAlerts: true,
    lowStockAlert: 10,
    theme: 'light'
  });

  // Fetch real data from API
  const { data: ordersResponse = { orders: [], pagination: {} } } = useGetAllOrdersQuery({ limit: 1000 });
  const { data: apiSettings } = useGetSettingsQuery();
  const [updateSettingsMutation] = useUpdateSettingsMutation();

  const orders = Array.isArray(ordersResponse) ? ordersResponse : (ordersResponse.orders || []);

  // Update settings when API data loads
  useEffect(() => {
    if (apiSettings) {
      setSettings({
        siteName: apiSettings.site_name || 'Branding House',
        email: apiSettings.admin_email || 'admin@brandinghouse.com',
        currency: apiSettings.currency || 'USD',
        taxRate: apiSettings.tax_rate || 10,
        shippingCost: apiSettings.shipping_cost || 5.00,
        notifications: apiSettings.notifications_enabled !== undefined ? apiSettings.notifications_enabled : true,
        emailNotifications: apiSettings.email_notifications !== undefined ? apiSettings.email_notifications : true,
        orderAlerts: apiSettings.order_alerts !== undefined ? apiSettings.order_alerts : true,
        lowStockAlert: apiSettings.low_stock_threshold || 10,
        theme: apiSettings.theme || 'light'
      });
    }
  }, [apiSettings]);

  // Calculate sales chart data from real orders
  const salesChartData = useMemo(() => {
    const now = new Date();
    const monthsData = {};

    for (let i = 7; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = date.toLocaleString('default', { month: 'short' });
      monthsData[monthKey] = { month: monthKey, sales: 0, orders: 0 };
    }

    orders.forEach(order => {
      const orderDate = new Date(order.created_at);
      const monthKey = orderDate.toLocaleString('default', { month: 'short' });
      
      if (monthsData[monthKey]) {
        monthsData[monthKey].sales += Number(order.totalAmount) || 0;
        monthsData[monthKey].orders += 1;
      }
    });

    return Object.values(monthsData);
  }, [orders]);

  // Calculate real statistics
  const stats = useMemo(() => {
    const totalSales = orders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.orderStatus === 'pending').length;
    const deliveredOrders = orders.filter(o => o.orderStatus === 'delivered').length;
    const cancelledOrders = orders.filter(o => o.orderStatus === 'cancelled').length;
    const processingOrders = orders.filter(o => o.orderStatus === 'processing').length;
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    const ordersByStatus = [
      { name: 'Pending', value: pendingOrders },
      { name: 'Processing', value: processingOrders },
      { name: 'Delivered', value: deliveredOrders },
      { name: 'Cancelled', value: cancelledOrders }
    ].filter(item => item.value > 0);

    const paidOrders = orders.filter(o => o.paymentStatus === 'paid').length;
    const unpaidOrders = orders.filter(o => o.paymentStatus === 'pending').length;

    return {
      totalSales,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      avgOrderValue,
      ordersByStatus,
      paidOrders,
      unpaidOrders,
      processingOrders,
      cancelledOrders
    };
  }, [orders]);

  const menuItems = [
    { id: 'dashboard', name: 'Dashboard', icon: FaHome },
    { id: 'products', name: 'Products', icon: FaBox },
    { id: 'orders', name: 'Orders', icon: FaShoppingCart },
    { id: 'customers', name: 'Customers', icon: FaUsers },
    { id: 'analytics', name: 'Analytics', icon: FaChartLine },
    { id: 'settings', name: 'Settings', icon: FaCog },
  ];

  const handleSaveSettings = async () => {
    try {
      await updateSettingsMutation(settings).unwrap();
      alert('Settings saved successfully!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings. Please try again.');
    }
  };

  // ANALYTICS SECTION
  const renderAnalytics = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Analytics & Reports</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-sm text-gray-600 dark:text-gray-400 mb-2">Total Revenue</h3>
          <p className="text-3xl font-bold text-indigo-600">{formatCurrency(stats.totalSales)}</p>
          <p className="text-sm text-gray-500 mt-2">From {stats.totalOrders} orders</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-sm text-gray-600 dark:text-gray-400 mb-2">Average Order Value</h3>
          <p className="text-3xl font-bold text-green-600">{formatCurrency(stats.avgOrderValue)}</p>
          <p className="text-sm text-gray-500 mt-2">Per transaction</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-sm text-gray-600 dark:text-gray-400 mb-2">Conversion Rate</h3>
          <p className="text-3xl font-bold text-blue-600">
            {stats.totalOrders > 0 ? ((stats.deliveredOrders / stats.totalOrders) * 100).toFixed(1) : 0}%
          </p>
          <p className="text-sm text-gray-500 mt-2">Order completion</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Sales Trend</h3>
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
                contentStyle={{ 
                  backgroundColor: '#1f2937', 
                  border: 'none', 
                  borderRadius: '8px',
                  color: '#f9fafb'
                }}
                formatter={(value) => formatCurrency(value)}
              />
              <Area 
                type="monotone" 
                dataKey="sales" 
                stroke="#4f46e5" 
                fillOpacity={1} 
                fill="url(#colorSales)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Order Status Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.ordersByStatus}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {stats.ordersByStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Orders by Month</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1f2937', 
                    border: 'none', 
                    borderRadius: '8px',
                    color: '#f9fafb'
                  }}
                />
                <Bar dataKey="orders" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Payment Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{stats.paidOrders}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Paid</p>
          </div>
          <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
            <p className="text-2xl font-bold text-yellow-600">{stats.unpaidOrders}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Pending</p>
          </div>
          <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-2xl font-bold text-blue-600">{stats.processingOrders}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Processing</p>
          </div>
          <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-2xl font-bold text-red-600">{stats.cancelledOrders}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Cancelled</p>
          </div>
        </div>
      </div>
    </div>
  );

  // SETTINGS SECTION
  const renderSettings = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Settings</h2>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">General Settings</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Site Name
            </label>
            <input
              type="text"
              value={settings.siteName}
              onChange={(e) => setSettings({...settings, siteName: e.target.value})}
              className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Admin Email
            </label>
            <input
              type="email"
              value={settings.email}
              onChange={(e) => setSettings({...settings, email: e.target.value})}
              className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Currency
              </label>
              <select
                value={settings.currency}
                onChange={(e) => setSettings({...settings, currency: e.target.value})}
                className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              >
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="GBP">GBP - British Pound</option>
                <option value="GHS">GHS - Ghana Cedi</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Tax Rate (%)
              </label>
              <input
                type="number"
                value={settings.taxRate}
                onChange={(e) => setSettings({...settings, taxRate: parseFloat(e.target.value)})}
                className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Shipping Settings</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default Shipping Cost
            </label>
            <input
              type="number"
              step="0.01"
              value={settings.shippingCost}
              onChange={(e) => setSettings({...settings, shippingCost: parseFloat(e.target.value)})}
              className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Notifications</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-800 dark:text-white">Enable Notifications</p>
              <p className="text-sm text-gray-500">Receive system notifications</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.notifications}
                onChange={(e) => setSettings({...settings, notifications: e.target.checked})}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
            </label>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-800 dark:text-white">Email Notifications</p>
              <p className="text-sm text-gray-500">Get email updates</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.emailNotifications}
                onChange={(e) => setSettings({...settings, emailNotifications: e.target.checked})}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
            </label>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-800 dark:text-white">Order Alerts</p>
              <p className="text-sm text-gray-500">Get notified of new orders</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.orderAlerts}
                onChange={(e) => setSettings({...settings, orderAlerts: e.target.checked})}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Low Stock Alert Threshold
            </label>
            <input
              type="number"
              value={settings.lowStockAlert}
              onChange={(e) => setSettings({...settings, lowStockAlert: parseInt(e.target.value)})}
              className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSaveSettings}
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Save Settings
        </button>
      </div>
    </div>
  );

  // DASHBOARD SECTION
  const renderDashboard = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Dashboard Overview</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Sales</p>
              <p className="text-2xl font-bold text-indigo-600">{formatCurrency(stats.totalSales)}</p>
            </div>
            <FaChartLine className="text-3xl text-indigo-600/70" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Orders</p>
              <p className="text-2xl font-bold text-blue-600">{stats.totalOrders}</p>
            </div>
            <FaShoppingCart className="text-3xl text-blue-600/70" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Pending Orders</p>
              <p className="text-2xl font-bold text-yellow-600">{stats.pendingOrders}</p>
            </div>
            <FaCog className="text-3xl text-yellow-600/70" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Delivered</p>
              <p className="text-2xl font-bold text-green-600">{stats.deliveredOrders}</p>
            </div>
            <FaShoppingCart className="text-3xl text-green-600/70" />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Sales Overview</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={salesChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1f2937', 
                  border: 'none', 
                  borderRadius: '8px',
                  color: '#f9fafb'
                }}
                formatter={(value) => formatCurrency(value)}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="sales" 
                stroke="#4f46e5" 
                strokeWidth={2} 
                dot={{ fill: '#4f46e5', r: 4 }} 
                activeDot={{ r: 6 }} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <button
          onClick={() => setActiveSection('products')}
          className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow text-left"
        >
          <FaBox className="text-3xl text-indigo-600 mb-3" />
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">Manage Products</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Add, edit, or remove products from your inventory</p>
        </button>
        <button
          onClick={() => setActiveSection('orders')}
          className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow text-left"
        >
          <FaShoppingCart className="text-3xl text-blue-600 mb-3" />
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">View Orders</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Process and track customer orders</p>
        </button>
        <button
          onClick={() => setActiveSection('customers')}
          className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow text-left"
        >
          <FaUsers className="text-3xl text-green-600 mb-3" />
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">Customer Management</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">View and manage customer accounts</p>
        </button>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':
        return renderDashboard();
      case 'products':
        return <ProductsPage />;
      case 'orders':
        return <OrdersPage />;
      case 'customers':
        return <CustomersPage />;
      case 'analytics':
        return renderAnalytics();
      case 'settings':
        return renderSettings();
      default:
        return (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center">
            <p className="text-gray-600 dark:text-gray-400">
              {activeSection.charAt(0).toUpperCase() + activeSection.slice(1)} section coming soon
            </p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">E-commerce Admin</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-800 dark:text-gray-200 hidden sm:inline">Admin</span>
            <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold">
              A
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 flex flex-col lg:flex-row gap-8">
        <aside className="lg:w-1/4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden sticky top-24">
            <div className="p-6 bg-indigo-600 text-white">
              <h2 className="text-xl font-bold">Admin Dashboard</h2>
            </div>
            <nav className="p-2">
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                      activeSection === item.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Icon className="text-lg" />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="lg:w-3/4">{renderContent()}</main>
      </div>
    </div>
  );
};

export default AdminDashboard;