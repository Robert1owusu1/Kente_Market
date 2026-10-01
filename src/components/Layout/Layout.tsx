import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from '../Navbar/Navbar';
import BottomNav from '../Navbar/BottomNav';
import Footer from '../Footer/Footer';

// Routes that render a full-viewport shell of their own. Appending the
// footer to these would either sit under the fixed BottomNav or produce a
// second scrollbar, so they render standalone.
const FULL_SCREEN_PREFIXES = [
  '/login',
  '/register',
  '/oauth/callback',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/admin',
];

const Layout = () => {
  const { pathname } = useLocation();
  const hideFooter = FULL_SCREEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <BottomNav />
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      {!hideFooter && (
        <Footer className="pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:pb-0" />
      )}
    </div>
  );
};

export default Layout;