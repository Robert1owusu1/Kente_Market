import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AOS from 'aos';
import "aos/dist/aos.css";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Navbar from './components/Navbar/Navbar';
import BottomNav from './components/Navbar/BottomNav.jsx';
import Loader from './components/loader/Loader.jsx';
import PromotionPopup from './components/PromotionPopup/PromotionPopup.jsx';
import PrivateRoute from './components/privateRoutes/PivateRoute.jsx';
import VerifiedRoute from './components/privateRoutes/VerifiedRoute.jsx';
import AdminRoute from './components/privateRoutes/AdminRoutes.jsx';

// Lazy-loaded route chunks so each page only loads its own code
const CartPage = lazy(() => import("./Pges/Cartpage/CartPge.jsx"));
const Hero = lazy(() => import('./components/Hero/Hero'));
const Products = lazy(() => import('./components/Products/Products.jsx'));
const TopProducts = lazy(() => import("./components/TopProducts/TopProducts.jsx"));
const Banner = lazy(() => import('./components/Banner/Banner.jsx'));
const Subscribe = lazy(() => import('./components/Subscribe/Subscribe.jsx'));
const Testimonials = lazy(() => import('./components/Testimonials/Testimonials.jsx'));
const Footer = lazy(() => import('./components/Footer/Footer.jsx'));
const Login = lazy(() => import("./components/login/Login.jsx"));
const Register = lazy(() => import('./components/login/Register.jsx'));
const AllProducts = lazy(() => import('./Pges/AllProducts/AllProducts.jsx'));
const CheckoutPage = lazy(() => import("./Pges/CheckoutPage/checkout.jsx"));
const UserProfile = lazy(() => import("./Pges/UserProfile/UserProfile"));
const AdminDashboard = lazy(() => import('./AdminDashboard/AdminDashboard.jsx'));
const Aboutus = lazy(() => import("./Pges/About_Us/AboutsUs"));
const ContactUs = lazy(() => import('./Pges/About_Us/ContactUs'));
const ProductDetails = lazy(() => import('./Pges/AllProducts/productDetails.jsx'));
const AiTryOn = lazy(() => import('./ai-tryon/AiTryOn.jsx'));
const EmailVerification = lazy(() => import('./components/EmailVerification/EmailVerification'));
const OAuthCallback = lazy(() => import('./Pges/Auth/OAuthCallback'));
const ForgotPassword = lazy(() => import('./Pges/Auth/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./Pges/Auth/ResetPassword.jsx'));
const OrderDetails = lazy(() => import('./Pges/OrderDetails/OrderDetails.jsx'));
const OrdersPage = lazy(() => import('./Pges/OrdersPage/OrdersPage.jsx'));
const VendorApply = lazy(() => import('./Pges/Vendor/VendorApply.jsx'));
const VendorDashboard = lazy(() => import('./Pges/Vendor/VendorDashboard.jsx'));
const TermsOfService = lazy(() => import('./Pges/Legal/TermsOfService.jsx'));
const PrivacyPolicy = lazy(() => import('./Pges/Legal/PrivacyPolicy.jsx'));
const ReviewsPage = lazy(() => import('./Pges/Reviews/ReviewsPage.jsx'));
const HelpPage = lazy(() => import('./Pges/Help/HelpPage.jsx'));

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
    <Router>
      <Suspense fallback={<Loader />}>
        <Routes>
          {/* Home Page with Navbar */}
          <Route path="/" element={
            <>
              <Navbar />
              <BottomNav />
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
          <Route path="/products" element={
            <>
              <Navbar />
              <BottomNav />
              <AllProducts />
            </>
          } />

          <Route path="/product/:id" element={
            <>
              <Navbar />
              <BottomNav />
              <ProductDetails />
            </>
          } />

          <Route path="/topproducts" element={
            <>
              <Navbar />
              <BottomNav />
              <TopProducts />
            </>
          } />

          <Route path="/trendingproducts" element={
            <>
              <Navbar />
              <BottomNav />
              <Products />
            </>
          } />

          <Route path="/ai-tryon" element={
            <>
              <Navbar />
              <BottomNav />
              <AiTryOn />
            </>
          } />

          <Route path='/aboutus' element={
            <>
              <Navbar />
              <BottomNav />
              <Aboutus />
            </>
          } />

          <Route path='/contactus' element={
            <>
              <Navbar />
              <BottomNav />
              <ContactUs />
            </>
          } />

          <Route path='/reviews' element={
            <>
              <Navbar />
              <BottomNav />
              <ReviewsPage />
            </>
          } />

          <Route path='/help' element={
            <>
              <Navbar />
              <BottomNav />
              <HelpPage />
            </>
          } />

          <Route path='/cartpage' element={
            <>
              <Navbar />
              <BottomNav />
              <CartPage />
            </>
          } />

          {/* ✅ FIXED: Login/Register WITHOUT Navbar - cleaner for admin redirect */}
          <Route path="/login" element={<Login />} />
          <Route path='/register' element={<Register />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />

          {/* Private Routes - Requires Login */}
          <Route element={<PrivateRoute />}>
            <Route path='/verify-email' element={<EmailVerification />} />

            <Route path='/vendor/apply' element={
              <>
                <Navbar />
                <BottomNav />
                <VendorApply />
              </>
            } />

            {/* Verified Routes - Requires Login + Email Verified */}
            <Route element={<VerifiedRoute />}>
              <Route path="/profile" element={
                <>
                  <Navbar />
                  <BottomNav />
                  <UserProfile />
                </>
              } />

              <Route path='/checkout/:id' element={
                <>
                  <Navbar />
                  <BottomNav />
                  <CheckoutPage />
                </>
              } />

              <Route path='/order/:id' element={
                <>
                  <Navbar />
                  <BottomNav />
                  <OrderDetails />
                </>
              } />

              <Route path='/orders' element={
                <>
                  <Navbar />
                  <BottomNav />
                  <OrdersPage />
                </>
              } />

              <Route path='/vendor' element={
                <>
                  <Navbar />
                  <BottomNav />
                  <VendorDashboard />
                </>
              } />
            </Route>
          </Route>

          {/* Admin Routes - Requires Admin Role (NO Navbar) */}
          <Route element={<AdminRoute />}>
            <Route path='/admin' element={<AdminDashboard />} />
            <Route path='/admin/dashboard' element={<AdminDashboard />} />
          </Route>
        </Routes>
      </Suspense>

      <PromotionPopup />

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
  );
};

export default App;