import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Layout from './components/Layout/Layout';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import Loader from './components/loader/Loader';
import PromotionPopup from './components/PromotionPopup/PromotionPopup';
import TestingModePopup from './components/TestingModePopup/TestingModePopup';

import SyncUserRole from './components/SyncUserRole/SyncUserRole';
import NotFound from './components/NotFound/NotFound';
import PrivateRoute from './components/privateRoutes/PrivateRoute';
import VerifiedRoute from './components/privateRoutes/VerifiedRoute';
import AdminRoute from './components/privateRoutes/AdminRoutes';
import Seo from './components/Seo/Seo';

const SITE_URL = 'https://kente-market.vercel.app';

const homeJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Bonwire Kente Marketplace',
    url: SITE_URL,
    logo: `${SITE_URL}/og-cover.png`,
    description:
      'Authentic Ghanaian Kente cloth, fabrics and custom-printed products from verified weavers and vendors.',
    areaServed: ['GH', 'Worldwide'],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Bonwire Kente Marketplace',
    url: SITE_URL,
  },
];

// Lazy-loaded route chunks so each page only loads its own code
const CartPage = lazy(() => import("./Pages/CartPage/CartPage"));
const Hero = lazy(() => import('./components/Hero/Hero'));
const Products = lazy(() => import('./components/Products/Products'));
const CampaignSection = lazy(() => import('./components/Campaigns/CampaignSection'));
const TopProducts = lazy(() => import("./components/TopProducts/TopProducts"));
const Banner = lazy(() => import('./components/Banner/Banner'));
const Subscribe = lazy(() => import('./components/Subscribe/Subscribe'));
const Testimonials = lazy(() => import('./components/Testimonials/Testimonials'));
const Footer = lazy(() => import('./components/Footer/Footer'));
const Login = lazy(() => import("./components/login/Login"));
const Register = lazy(() => import('./components/login/Register'));
const AllProducts = lazy(() => import('./Pages/AllProducts/AllProducts'));
const CheckoutPage = lazy(() => import("./Pages/CheckoutPage/checkout"));
const UserProfile = lazy(() => import("./Pages/UserProfile/UserProfile"));
const AdminDashboard = lazy(() => import('./AdminDashboard/AdminDashboard'));
const Aboutus = lazy(() => import("./Pages/About_Us/AboutsUs"));
const ContactUs = lazy(() => import('./Pages/About_Us/ContactUs'));
const ProductDetails = lazy(() => import('./Pages/AllProducts/productDetails'));
const AiTryOn = lazy(() => import('./ai-tryon/AiTryOn'));
const EmailVerification = lazy(() => import('./components/EmailVerification/EmailVerification'));
const OAuthCallback = lazy(() => import('./Pages/Auth/OAuthCallback'));
const ForgotPassword = lazy(() => import('./Pages/Auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./Pages/Auth/ResetPassword'));
const OrderDetails = lazy(() => import('./Pages/OrderDetails/OrderDetails'));
const OrdersPage = lazy(() => import('./Pages/OrdersPage/OrdersPage'));
const WishlistPage = lazy(() => import('./Pages/Wishlist/WishlistPage'));
const UnsubscribePage = lazy(() => import('./Pages/Unsubscribe/UnsubscribePage'));
const VendorApply = lazy(() => import('./Pages/Vendor/VendorApply'));
const VendorDashboard = lazy(() => import('./Pages/Vendor/VendorDashboard'));
const TermsOfService = lazy(() => import('./Pages/Legal/TermsOfService'));
const PrivacyPolicy = lazy(() => import('./Pages/Legal/PrivacyPolicy'));
const ReviewsPage = lazy(() => import('./Pages/Reviews/ReviewsPage'));
const HelpPage = lazy(() => import('./Pages/Help/HelpPage'));
const VendorDirectory = lazy(() => import('./Pages/Storefront/VendorDirectory'));
const VendorStorefront = lazy(() => import('./Pages/Storefront/VendorStorefront'));
const KenteMuseum = lazy(() => import('./Pages/Museum/KenteMuseum'));
const SuggestionsPage = lazy(() => import('./Pages/Suggestions/SuggestionsPage'));
const MyMessages = lazy(() => import('./Pages/Messages/MyMessages'));
const MyCertificates = lazy(() => import('./Pages/Certificates/MyCertificates'));
const CustomRequestForm = lazy(() => import('./Pages/CustomRequest/CustomRequestForm'));
const MyCustomRequests = lazy(() => import('./Pages/CustomRequest/MyCustomRequests'));
const CustomRequestCheckout = lazy(() => import('./Pages/CustomRequest/CustomRequestCheckout'));

const App = () => {
  useEffect(() => {
    // Load AOS only on large screens without reduced-motion preferences, so
    // mobile / accessibility users never download or execute the animation
    // engine (keeps main-thread work and TBT low on phones).
    const mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (window.innerWidth < 768 || mqReduced.matches) return;

    import("aos").then(({ default: AOS }) => {
      import("aos/dist/aos.css");
      AOS.init({
        once: true,
        offset: 80,
        duration: 500,
        easing: "ease-out",
        delay: 0,
      });
      AOS.refresh();
    });
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
                  <Seo
                    title="Bonwire Kente - Authentic Ghanaian Kente Cloth | Buy Online"
                    description="Shop authentic Ghanaian Kente cloth and fabric online. Handwoven by verified weavers, delivered across Ghana and worldwide."
                    image={`${SITE_URL}/og-cover.png`}
                    jsonLd={homeJsonLd}
                  />
                  <Hero />
                  <Products />
                  <Banner />
                  <CampaignSection />
                  <Subscribe />
                  <TopProducts />
                  <Testimonials />
                  <Footer />
                </>
              } />

              {/* Public Routes with Navbar */}
              <Route path="/products" element={<AllProducts />} />
              <Route path="/product/:id" element={<ProductDetails />} />
              <Route path="/topproducts" element={
                <>
                  <Seo
                    title="Top Kente Products & Best Sellers | Bonwire Kente"
                    description="Explore top-rated and best-selling Kente cloth, weaving and fashion. Updated weekly with trending designs."
                    image={`${SITE_URL}/og-cover.png`}
                  />
                  <TopProducts />
                </>
              } />
              <Route path="/trendingproducts" element={
                <>
                  <Seo
                    title="Trending Kente Cloth & Fabrics | Bonwire Kente"
                    description="Discover the most popular Kente patterns and trending Ghanaian fabric designs right now."
                    image={`${SITE_URL}/og-cover.png`}
                  />
                  <Products />
                </>
              } />
              <Route path="/ai-tryon" element={<AiTryOn />} />
              <Route path='/aboutus' element={<Aboutus />} />
              <Route path='/contactus' element={<ContactUs />} />
              <Route path='/reviews' element={<ReviewsPage />} />
              <Route path='/help' element={<HelpPage />} />
              <Route path='/vendors' element={<VendorDirectory />} />
              <Route path='/store/:slug' element={<VendorStorefront />} />
              <Route path='/museum' element={<KenteMuseum />} />
              <Route path='/suggestions' element={<SuggestionsPage />} />
              <Route path='/unsubscribe' element={<UnsubscribePage />} />
              <Route path='/cartpage' element={<CartPage />} />
              <Route path='/cart' element={<CartPage />} />
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
                <Route path='/customize/:id' element={<CustomRequestForm />} />
                <Route path='/custom-requests' element={<MyCustomRequests />} />
                <Route path='/custom-requests/:id/checkout' element={<CustomRequestCheckout />} />
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
        <TestingModePopup />
        <SyncUserRole />

        {/* Global ToastContainer - Available on all pages */}
        <ToastContainer
          {...{
            position: "top-right",
            autoClose: 3000,
            hideProgressBar: false,
            newestOnTop: true,
            closeOnClick: true,
            rtl: false,
            pauseOnFocusLoss: true,
            draggable: true,
            pauseOnHover: true,
            theme: "dark",
            toastStyle: {
              backgroundColor: '#1f2937',
              color: '#f9fafb',
              borderRadius: '12px',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
            },
            progressStyle: {
              backgroundColor: '#f59e0b',
            },
            style: { zIndex: 9999 },
          } as React.ComponentProps<typeof ToastContainer>}
        />
      </Router>
    </ErrorBoundary>
  );
};

export default App;
