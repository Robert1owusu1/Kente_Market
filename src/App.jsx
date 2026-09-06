import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AOS from 'aos';
import "aos/dist/aos.css";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Layout from './components/Layout/Layout';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import Loader from './components/loader/Loader.jsx';
import PromotionPopup from './components/PromotionPopup/PromotionPopup.jsx';

import SyncUserRole from './components/SyncUserRole/SyncUserRole.jsx';
import NotFound from './components/NotFound/NotFound.jsx';
import PrivateRoute from './components/privateRoutes/PrivateRoute.jsx';
import VerifiedRoute from './components/privateRoutes/VerifiedRoute.jsx';
import AdminRoute from './components/privateRoutes/AdminRoutes.jsx';

// Lazy-loaded route chunks so each page only loads its own code
const CartPage = lazy(() => import("./Pages/CartPage/CartPage.jsx"));
const Hero = lazy(() => import('./components/Hero/Hero'));
const Products = lazy(() => import('./components/Products/Products.jsx'));
const TopProducts = lazy(() => import("./components/TopProducts/TopProducts.jsx"));
const Banner = lazy(() => import('./components/Banner/Banner.jsx'));
const Subscribe = lazy(() => import('./components/Subscribe/Subscribe.jsx'));
const Testimonials = lazy(() => import('./components/Testimonials/Testimonials.jsx'));
const Footer = lazy(() => import('./components/Footer/Footer.jsx'));
const Login = lazy(() => import("./components/login/Login.jsx"));
const Register = lazy(() => import('./components/login/Register.jsx'));
const AllProducts = lazy(() => import('./Pages/AllProducts/AllProducts.jsx'));
const CheckoutPage = lazy(() => import("./Pages/CheckoutPage/checkout.jsx"));
const UserProfile = lazy(() => import("./Pages/UserProfile/UserProfile"));
const AdminDashboard = lazy(() => import('./AdminDashboard/AdminDashboard.jsx'));
const Aboutus = lazy(() => import("./Pages/About_Us/AboutsUs"));
const ContactUs = lazy(() => import('./Pages/About_Us/ContactUs'));
const ProductDetails = lazy(() => import('./Pages/AllProducts/productDetails.jsx'));
const AiTryOn = lazy(() => import('./ai-tryon/AiTryOn.jsx'));
const EmailVerification = lazy(() => import('./components/EmailVerification/EmailVerification'));
const OAuthCallback = lazy(() => import('./Pages/Auth/OAuthCallback'));
const ForgotPassword = lazy(() => import('./Pages/Auth/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./Pages/Auth/ResetPassword.jsx'));
const OrderDetails = lazy(() => import('./Pages/OrderDetails/OrderDetails.jsx'));
const OrdersPage = lazy(() => import('./Pages/OrdersPage/OrdersPage.jsx'));
const WishlistPage = lazy(() => import('./Pages/Wishlist/WishlistPage.jsx'));
const UnsubscribePage = lazy(() => import('./Pages/Unsubscribe/UnsubscribePage.jsx'));
const VendorApply = lazy(() => import('./Pages/Vendor/VendorApply.jsx'));
const VendorDashboard = lazy(() => import('./Pages/Vendor/VendorDashboard.jsx'));
const TermsOfService = lazy(() => import('./Pages/Legal/TermsOfService.jsx'));
const PrivacyPolicy = lazy(() => import('./Pages/Legal/PrivacyPolicy.jsx'));
const ReviewsPage = lazy(() => import('./Pages/Reviews/ReviewsPage.jsx'));
const HelpPage = lazy(() => import('./Pages/Help/HelpPage.jsx'));
const VendorDirectory = lazy(() => import('./Pages/Storefront/VendorDirectory.jsx'));
const VendorStorefront = lazy(() => import('./Pages/Storefront/VendorStorefront.jsx'));
const KenteMuseum = lazy(() => import('./Pages/Museum/KenteMuseum.jsx'));
const MyMessages = lazy(() => import('./Pages/Messages/MyMessages.jsx'));
const MyCertificates = lazy(() => import('./Pages/Certificates/MyCertificates.jsx'));

const App = () => {
  useEffect(() => {
    AOS.init({
      offset: 100,
      duration: 800,
      easing: "ease-in-sine",
      delay: 100,
    });
    AOS.refresh();
  }, []);

  return (
    <ErrorBoundary>
      <Router>
        <Suspense fallback={<Loader />}>
          <Routes>
            {/* Home Page with Navbar + Footer */}
            <Route element={<Layout />}>
              <Route path="/" element={
                <>
                  <Hero />
                  <Products />
                  <Banner />
                  <Subscribe />
                  <TopProducts />
                  <Testimonials />
                  <Footer />
                </>
              } />

              {/* Public Routes with Navbar */}
              <Route path="/products" element={<AllProducts />} />
              <Route path="/product/:id" element={<ProductDetails />} />
              <Route path="/topproducts" element={<TopProducts />} />
              <Route path="/trendingproducts" element={<Products />} />
              <Route path="/ai-tryon" element={<AiTryOn />} />
              <Route path='/aboutus' element={<Aboutus />} />
              <Route path='/contactus' element={<ContactUs />} />
              <Route path='/reviews' element={<ReviewsPage />} />
              <Route path='/help' element={<HelpPage />} />
              <Route path='/vendors' element={<VendorDirectory />} />
              <Route path='/store/:slug' element={<VendorStorefront />} />
              <Route path='/museum' element={<KenteMuseum />} />
              <Route path='/unsubscribe' element={<UnsubscribePage />} />
              <Route path='/cartpage' element={<CartPage />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
            </Route>

            {/* Login/Register WITHOUT Navbar - cleaner for admin redirect */}
            <Route path="/login" element={<Login />} />
            <Route path='/register' element={<Register />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />

            {/* Private Routes - Requires Login */}
            <Route element={<PrivateRoute />}>
              <Route path='/verify-email' element={<EmailVerification />} />
              <Route path='/vendor/apply' element={<VendorApply />} />
            </Route>

            {/* Verified Routes - Requires Login + Email Verified */}
            <Route element={<VerifiedRoute />}>
              <Route element={<Layout />}>
                <Route path="/profile" element={<UserProfile />} />
                <Route path='/wishlist' element={<WishlistPage />} />
                <Route path='/checkout/:id' element={<CheckoutPage />} />
                <Route path='/order/:id' element={<OrderDetails />} />
                <Route path='/orders' element={<OrdersPage />} />
                <Route path='/messages' element={<MyMessages />} />
                <Route path='/certificates' element={<MyCertificates />} />
              </Route>

              {/* Vendor Dashboard - Standalone (NO Navbar) */}
              <Route path='/vendor' element={<VendorDashboard />} />
            </Route>

            {/* Admin Routes - Requires Admin Role (NO Navbar) */}
            <Route element={<AdminRoute />}>
              <Route path='/admin' element={<AdminDashboard />} />
              <Route path='/admin/dashboard' element={<AdminDashboard />} />
            </Route>

            {/* 404 - Not Found */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>

        <PromotionPopup />
        <SyncUserRole />

        {/* Global ToastContainer - Available on all pages */}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="dark"
          toastStyle={{
            backgroundColor: '#1f2937',
            color: '#f9fafb',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
          }}
          progressStyle={{
            backgroundColor: '#f59e0b',
          }}
          style={{ zIndex: 9999 }}
        />
      </Router>
    </ErrorBoundary>
  );
};

export default App;
