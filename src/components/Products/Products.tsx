// FILE: frontend/src/components/TrendingProducts/TrendingProducts.jsx
import React from 'react';
import { FaFire, FaTags, FaExclamationTriangle } from "react-icons/fa";
import { Link } from 'react-router-dom';
import { useCart } from "../../Context/CartContext";
import { useGetTrendingProductsQuery } from "../../slices/productsApiSlice";
import { useWishlistToggle } from "../../hooks/useWishlistToggle";
import { useTryOnEnabled } from "../../slices/tryOnApiSlice";
import { ProductGridSkeleton } from "../loader/Skeleton";
import ProductCard from "../ProductCard/ProductCard";
import { toCartItem } from "../../utils/cartItem";
import { yardOptionsFor } from "../../utils/yards";
import type { Product } from "../../types/domain";

interface TrendProduct extends Product {
  tag?: string;
  image?: string;
  original_price?: number | string;
  colors_available?: string[];
  base_price?: number | string;
  reviews?: number;
  color?: string;
  fabric_type?: string;
  production_time?: string;
  vendorStatus?: string;
}

const TrendingProducts = ({ handleOrderPopup }: { handleOrderPopup?: () => void }) => {
  const { addToCart } = useCart();
  const wishlist = useWishlistToggle();
  const tryOnEnabled = useTryOnEnabled();

 // RTK Query hook - cached in the Redux store, no duplicate network calls
  // when navigating between pages.
  const {
    data: trendingProductsData,
    isLoading,
    error: queryError,
  } = useGetTrendingProductsQuery({ limit: 5 });

  // Normalize RTK error object into a displayable string.
  const queryErr = queryError as { data?: { message?: string; error?: string } } | undefined;
  const error = queryErr
    ? (queryErr.data?.message || queryErr.data?.error || 'Failed to load trending products. Please try again later.')
    : null;
  const loading = isLoading;

  const handleAddToCart = (product: TrendProduct) => {
    // Kente is pre-designed: no colour/size choice — yardage only (even numbers).
    // Shared cart shape (utils/cartItem): this handler used to write `image`
    // but not `img`, so lines added here showed no thumbnail in the cart.
    const cartItem = toCartItem(product as unknown as Product, yardOptionsFor(product)[0], 1);
    addToCart(cartItem);
    
    if (handleOrderPopup) {
      handleOrderPopup();
    }
  };

 // Loading State with skeleton placeholders
  if (loading) {
    return (
      <div className='mt-14 mb-12'>
        <div className='container'>
          <div data-aos="fade-up" className='text-center mb-10 max-w-[600px] mx-auto'>
            <p className='text-sm font-semibold text-amber-800 dark:text-primary flex items-center justify-center gap-2'>
              <FaFire className="text-orange-500" />
              Highly rated Kente
            </p>
            <h2 data-aos="fade-up" className='text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white'>
              Trending Products
            </h2>
            <p data-aos="fade-up" className='text-xs text-gray-500 dark:text-gray-300'>
              Pieces shoppers on Kente Market rate highly
            </p>
          </div>
          <ProductGridSkeleton count={5} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 place-items-center" />
        </div>
      </div>
    );
  }

 // Error State
  if (error) {
    return (
      <div className='mt-14 mb-12'>
        <div className='container'>
          <div className='text-center bg-red-50 dark:bg-red-900/20 rounded-2xl p-8 max-w-2xl mx-auto'>
 <FaExclamationTriangle className="text-red-500 dark:text-red-400 text-5xl mb-4" />
            <h3 className="text-xl font-bold text-red-800 dark:text-red-300 mb-2">
              Oops! Something went wrong
            </h3>
            <p className="text-red-600 dark:text-red-400 mb-6">{error}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="px-8 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-all duration-300 font-semibold shadow-lg"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

 // Empty State
  if (!trendingProductsData || trendingProductsData.length === 0) {
    return (
      <div className='mt-14 mb-12'>
        <div className='container'>
          <div className='text-center py-20'>
 <FaTags className="text-6xl mb-4" />
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
              No Trending Products Yet
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              Check back soon for hot trending items!
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='mt-14 mb-12'>
      <div className='container'>
        {/* Header section */}
        <div className='text-center mb-10 max-w-[600px] mx-auto'>
            <p data-aos="fade-up" className='text-sm font-semibold text-amber-800 dark:text-primary flex items-center justify-center gap-2'>
              <FaFire className="text-orange-500" />
              Highly rated Kente
            </p>
          <h2 data-aos="fade-up" className='text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white'>
            Trending Products
          </h2>
          <p data-aos="fade-up" className='text-xs text-gray-500 dark:text-gray-300'>
            Pieces shoppers on Kente Market rate highly
          </p>
        </div>

        {/* Body section */}
        <div>
          <div className='grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
            {trendingProductsData.map((data: TrendProduct, index) => (
              <ProductCard
                key={data.id}
                product={data}
                onAddToCart={() => handleAddToCart(data)}
                onToggleWishlist={wishlist.toggle}
                isSaved={wishlist.isSaved(data.id)}
                tryOnAvailable={tryOnEnabled}
                priority={index < 2}
              />
            ))}
          </div>

          {/* View all products */}
          <div className='flex justify-center mt-12'>
            <Link to="/products" className="btn btn-primary px-8">
              View all products
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrendingProducts;