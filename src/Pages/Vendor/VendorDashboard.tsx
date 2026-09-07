// Pages/Vendor/VendorDashboard.jsx
// Full vendor dashboard with sidebar navigation (mirrors admin dashboard)
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaHome, FaBox, FaShoppingCart, FaChartLine, FaCog, FaStore, FaTag, FaPercent, FaStar, FaUndo, FaWallet, FaPlus, FaBoxes, FaEnvelope, FaUserCog } from 'react-icons/fa';
import { useGetMyVendorProfileQuery } from '../../slices/vendorsApiSlice';
import Loader from '../../components/loader/Loader';
import VendorOverview from './VendorOverview';
import VendorProductsSection from './VendorProductsSection';
import VendorOrdersSection from './VendorOrdersSection';
import VendorAnalytics from './VendorAnalytics';
import VendorReviews from './VendorReviews';
import VendorReturns from './VendorReturns';
import VendorCoupons from './VendorCoupons';
import VendorPayouts from './VendorPayouts';
import VendorSettings from './VendorSettings';
import VendorInventory from './VendorInventory';
import VendorMessages from './VendorMessages';
import VendorStaff from './VendorStaff';

const menuItems = [
  { id: 'overview', name: 'Overview', icon: FaHome },
  { id: 'products', name: 'Products', icon: FaBox },
  { id: 'orders', name: 'Orders', icon: FaShoppingCart },
  { id: 'inventory', name: 'Inventory', icon: FaBoxes },
  { id: 'messages', name: 'Messages', icon: FaEnvelope },
  { id: 'staff', name: 'Team', icon: FaUserCog },
  { id: 'analytics', name: 'Analytics', icon: FaChartLine },
  { id: 'reviews', name: 'Reviews', icon: FaStar },
  { id: 'returns', name: 'Returns', icon: FaUndo },
  { id: 'coupons', name: 'Coupons', icon: FaPercent },
  { id: 'payouts', name: 'Payouts', icon: FaWallet },
  { id: 'settings', name: 'Settings', icon: FaCog },
];

const statusBadge = (status: string | undefined) => {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };
  return map[status || ''] || map.pending;
};

const VendorDashboard = () => {
  const [activeSection, setActiveSection] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data, isLoading, isError } = useGetMyVendorProfileQuery() as {
    data?: {
      vendor?: {
        status?: string;
        businessName?: string;
        [key: string]: unknown;
      };
    };
    isLoading: boolean;
    isError: boolean;
  };

  if (isLoading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader /></div>;
  }

  // No vendor profile yet
  if (isError || !data?.vendor) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <FaStore className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-6" />
        <h1 className="text-2xl font-bold mb-4">Start Selling on Bonwire</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Register as a seller to list your Kente &amp; fabric products and get paid securely via escrow.
        </p>
        <Link to="/vendor/apply" className="inline-flex items-center gap-2 bg-primary text-white px-8 py-3 rounded-lg hover:bg-primary/90 font-semibold">
          <FaPlus /> Become a Seller
        </Link>
      </div>
    );
  }

  const { vendor } = data;

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return <VendorOverview />;
      case 'products':
        return <VendorProductsSection vendorStatus={vendor.status} />;
      case 'orders':
        return <VendorOrdersSection />;
      case 'inventory':
        return <VendorInventory />;
      case 'messages':
        return <VendorMessages />;
      case 'staff':
        return <VendorStaff />;
      case 'analytics':
        return <VendorAnalytics />;
      case 'reviews':
        return <VendorReviews />;
      case 'returns':
        return <VendorReturns />;
      case 'coupons':
        return <VendorCoupons />;
      case 'payouts':
        return <VendorPayouts />;
      case 'settings':
        return <VendorSettings vendor={vendor} />;
      default:
        return <VendorOverview />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <FaStore className="text-xl text-primary" />
            <h1 className="text-xl font-bold text-gray-800 dark:text-white">Vendor Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-gray-600 dark:text-gray-300">{vendor.businessName}</span>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge(vendor.status)}`}>
              {vendor.status}
            </span>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 flex flex-col lg:flex-row gap-8">
        {/* Mobile menu toggle */}
        <div className="lg:hidden">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="w-full flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg shadow-md px-4 py-3 text-gray-800 dark:text-white font-semibold"
            aria-expanded={mobileMenuOpen}
          >
            <span className="capitalize">{activeSection} Section</span>
            <span className="text-primary text-2xl leading-none">{mobileMenuOpen ? '−' : '+'}</span>
          </button>
          {mobileMenuOpen && (
            <nav className="mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-md p-2">
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActiveSection(item.id); setMobileMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                      activeSection === item.id
                        ? 'bg-primary text-white'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Icon className="text-lg" />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        {/* Desktop sidebar */}
        <aside className="hidden lg:block lg:w-1/4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden sticky top-24">
            <div className="p-6 bg-primary text-white">
              <h2 className="text-xl font-bold">{vendor.businessName}</h2>
              <p className="text-sm text-white/80 mt-1">Seller Dashboard</p>
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
                        ? 'bg-primary text-white'
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

export default VendorDashboard;
