import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AOS from 'aos';
import "aos/dist/aos.css";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import CartPage from "./Pges/Cartpage/CartPge.jsx"
import PrivateRoute from './components/privateRoutes/PivateRoute.jsx';
import AdminRoute from './components/privateRoutes/AdminRoutes.jsx';
import Navbar from './components/Navbar/Navbar';
import BottomNav from './components/Navbar/BottomNav.jsx';
import Hero from './components/Hero/Hero';
import Products from './components/Products/Products.jsx';
import TopProducts from "./components/TopProducts/TopProducts.jsx";
import Banner from './components/Banner/Banner.jsx';
import Subscribe from './components/Subscribe/Subscribe.jsx';
import Testimonials from './components/Testimonials/Testimonials.jsx';
import Footer from './components/Footer/Footer.jsx';
import Login from "./components/login/Login.jsx"
import Register from './components/login/Register.jsx';
import AllProducts from './Pges/AllProducts/AllProducts.jsx';
import CheckoutPage from "./Pges/CheckoutPage/checkout.jsx";
import UserProfile from "./Pges/UserProfile/UserProfile"
import AdminDashboard from './AdminDashboard/AdminDashboard.jsx';
import Aboutus from "./Pges/About_Us/AboutsUs";
import ContactUs from './Pges/About_Us/ContactUs'
import ProductDetails from './Pges/AllProducts/productDetails.jsx';
import EmailVerification from './components/EmailVerification/EmailVerification';
import OAuthCallback from './Pges/Auth/OAuthCallback';
import ForgotPassword from './Pges/Auth/ForgotPassword.jsx';
import ResetPassword from './Pges/Auth/ResetPassword.jsx';

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
        <Route path='/verify-email' element={<EmailVerification />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />

        {/* Private Routes - Requires Login (with Navbar) */}
        <Route element={<PrivateRoute />}>
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
        </Route>

        {/* Admin Routes - Requires Admin Role (NO Navbar) */}
        <Route element={<AdminRoute />}>
          <Route path='/admin' element={<AdminDashboard />} />
          <Route path='/admin/dashboard' element={<AdminDashboard />} />
        </Route>
      </Routes>

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