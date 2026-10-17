// FILE: frontend/src/components/TopProducts/TopProducts.jsx
import React from "react";
import { FaTags, FaFire, FaExclamationTriangle } from "react-icons/fa";
import { useCart } from "../../Context/CartContext";
import { Link } from "react-router-dom";
import { useWishlistAction } from "../../hooks/useWishlistAction";
import {
  useGetFeaturedProductsQuery,
  useGetTrendingProductsQuery,
} from "../../slices/productsApiSlice";
import { ProductGridSkeleton } from "../loader/Skeleton";
import ProductCard from "../ProductCard/ProductCard";
import { toCartItem } from "../../utils/cartItem";
import { yardOptionsFor } from "../../utils/yards";
import type { Product } from "../../types/domain";

interface TopProduct extends Product {
  tag?: string;
  image?: string;
  original_price?: number | string;
  colors_available?: string[];
  base_price?: number | string;
  print_type?: string;
  production_time?: string;
  is_customizable?: boolean;
  reviews?: number;
  fabric_type?: string;
}

const TopProducts = ({ handleOrderPopup }: { handleOrderPopup?: () => void }) => {
  const { addToCart } = useCart();
  const saveToFavorites = useWishlistAction();

 // RTK Query hook - cached in the Redux store, no duplicate network calls
  // when navigating between pages.
  const {
    data: ProductsData,
    isLoading,
    error: queryError,
  } = useGetFeaturedProductsQuery({ limit: 6 });
  const { data: trendingProducts = [], isLoading: isTrendingLoading } =
    useGetTrendingProductsQuery({ limit: 6 });

  // Normalize RTK error object into a displayable string.
  const queryErr = queryError as { data?: { message?: string; error?: string } } | undefined;
  const error = queryErr
    ? (queryErr.data?.message || queryErr.data?.error || 'Failed to load products. Please try again later.')
    : null;
  const loading = isLoading || isTrendingLoading;
  // Featured products when the catalogue has any, otherwise the trending
  // list (rating-ordered). Labels below say which — never "best seller":
  // neither list is ordered by sales.
  const showingFeatured = !!ProductsData && ProductsData.length > 0;
  const displayProducts = showingFeatured ? ProductsData : trendingProducts;

  const handleAddToCart = (product: TopProduct) => {
    // Kente is pre-designed: no colour/size choice — yardage only (even numbers).
    const cartItem = toCartItem(product as unknown as Product, yardOptionsFor(product)[0], 1);
    addToCart(cartItem);

    if (handleOrderPopup) {
      handleOrderPopup();
    }
  };

  // Loading State
  if (loading) {
    return (
      <div className="py-16 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-medium mb-4">
              <FaFire className="text-primary" />
              Featured
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
              Featured pieces
            </h2>
          </div>
          <ProductGridSkeleton count={6} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 place-items-center" />
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="py-16 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center bg-red-50 dark:bg-red-900/20 rounded-2xl p-8">
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
  if (displayProducts.length === 0) {
    return (
      <div className="py-16 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
 <FaTags className="text-6xl mb-4" />
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
              No Featured Products Yet
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              Check back soon for featured pieces.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="py-16 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Enhanced Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-medium mb-4" data-aos="fade-up">
            <FaFire className="text-primary" />
            Featured
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
            {showingFeatured ? "Featured pieces" : "Popular pieces"}
          </h2>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            Handwoven Kente from the weavers selling on Kente Market
          </p>
        </div>

        {/* Products grid — shared card (components/ProductCard) */}
        <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3">
          {displayProducts.map((product: TopProduct, index) => (
            <ProductCard
              key={product.id}
              product={product}
              onAddToCart={() => handleAddToCart(product)}
              onToggleWishlist={saveToFavorites}
              badge={showingFeatured ? "Featured" : undefined}
              priority={index < 2}
            />
          ))}
        </div>

        {/* Enhanced Call to Action */}
        <Link to="/products">
          <div className="text-center mt-16" data-aos="fade-up">
            <div className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-full font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 cursor-pointer">
              <FaTags />
              View All Products
            </div>
          </div>
        </Link>

      </div>
    </div>
  );
};

export default TopProducts;