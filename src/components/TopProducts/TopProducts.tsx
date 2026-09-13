// FILE: frontend/src/components/TopProducts/TopProducts.jsx
import React from "react";
import { FaStar, FaTshirt, FaClock, FaHeart, FaEye, FaShoppingCart, FaTags, FaFire } from "react-icons/fa";
import { useCart } from "../../Context/CartContext";
import { Link } from "react-router-dom";
import {
  useGetFeaturedProductsQuery,
  useGetTrendingProductsQuery,
} from "../../slices/productsApiSlice";
import { ProductGridSkeleton } from "../loader/Skeleton";
import { resolveImageUrl } from "../../utils/imageUrl";
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

  // ⭐ RTK Query hook - cached in the Redux store, no duplicate network calls
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
  const displayProducts =
    ProductsData && ProductsData.length > 0 ? ProductsData : trendingProducts;

  const handleAddToCart = (product: TopProduct) => {
    const cartItem = {
      id: product.id,
      title: product.title,
      price: Number(product.price) || Number(product.base_price) || Number(product.basePrice) || 0,
      basePrice: Number(product.base_price) || Number(product.basePrice) || Number(product.price) || 0,
      image: product.image || product.img,
      img: product.image || product.img,
      colorsAvailable: product.colors_available || product.colorsAvailable || product.colors || [],
      colors: product.colors || product.colors_available || product.colorsAvailable || [],
      sizes: product.sizes || ['M'],
      yards: (product.yardsAvailable as string[] | undefined)?.[0] ?? product.sizes?.[0] ?? '2',
      yardsAvailable: (product.yardsAvailable as string[] | undefined) || product.sizes || ['2'],
      threadTypes: product.threadTypes,
      dominantThread: product.dominantThread,
      fabricType: product.fabric_type || product.fabricType || product.material || 'Cotton',
      material: product.material || product.fabric_type || product.fabricType || 'Cotton',
      printType: product.print_type || product.printType || 'Standard',
      productionTime: product.production_time || product.productionTime || '3-5',
      category: product.category,
      rating: product.rating || 0,
      reviews: product.reviews || 0,
      isCustomizable: product.is_customizable || product.isCustomizable || false,
      quantity: 1,
      selectedColor: (product.colors_available || product.colorsAvailable || product.colors || [])[0] || 'default',
      selectedSize: (product.sizes || ['M'])[0]
    };

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
              Top Products for you
            </div>
            <h2 data-aos="fade-up" className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              Best Products
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
            <div className="text-red-500 dark:text-red-400 text-5xl mb-4">⚠️</div>
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
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
              No Featured Products Yet
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              Check back soon for our top products!
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
            Top Products for you
          </div>
          <h2 data-aos="fade-up" className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            Best Products
          </h2>
          <p data-aos="fade-up" className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            Discover our most cherished authentic Kente cloth, handwoven in Bonwire, Ghana
          </p>
        </div>

        {/* Enhanced Products Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 place-items-center">
          {displayProducts.map((product: TopProduct, index) => {
            const productColors = product.colors_available || product.colorsAvailable || product.colors || [];
            const productPrice = Number(product.price) || Number(product.base_price) || Number(product.basePrice) || 0;
            const productOriginalPrice = product.original_price || product.originalPrice ? Number(product.original_price || product.originalPrice) : null;

            return (
              <div
                key={product.id}
                data-aos="zoom-in"
                data-aos-delay={index * 50}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-4 group relative overflow-hidden max-w-[350px] w-full"
              >
                {/* Product Tags */}
                <div className="absolute top-4 left-4 z-20">
                  {product.tag && (
                    <span className="bg-gradient-to-r from-orange-700 to-red-700 text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg">
                      {product.tag}
                    </span>
                  )}
                  {index < 3 && (
                    <span className="bg-red-700 text-white px-2 py-1 rounded-full text-xs font-bold shadow-lg mt-1 block w-fit">
                      #{index + 1} Best Seller
                    </span>
                  )}
                </div>

                {/* Favorite Button */}
                <button aria-label={`Favorite ${product.title}`} className="absolute top-4 right-4 z-20 p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-all duration-300 opacity-0 group-hover:opacity-100">
                  <FaHeart className="text-red-500 hover:text-red-600" />
                </button>

                {/* Image Section with Overlay */}
                <div className="relative h-64 overflow-hidden rounded-t-2xl">
                  <img
                    src={resolveImageUrl(product.image || product.img)}
                    alt={product.title}
                    width={350}
                    height={256}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.onerror = null;
                      target.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="#f4eee1" width="400" height="300"/><text x="200" y="155" font-family="sans-serif" font-size="20" fill="#8a6d3b" text-anchor="middle">Kente image coming soon</text></svg>');
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  
                  {/* Quick Action Buttons */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0">
                    <div className="flex gap-3">
                      <button aria-label={`Quick view ${product.title}`} className="p-3 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors duration-200 transform hover:scale-110">
                        <FaEye className="text-gray-700" />
                      </button>
                      <button 
                        onClick={() => handleAddToCart(product)}
                        aria-label={`Add ${product.title} to cart`}
                        className="p-3 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-colors duration-200 transform hover:scale-110"
                      >
                        <FaShoppingCart />
                      </button>
                    </div>
                  </div>

                  {/* Floating Rating */}
                  <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 shadow-lg">
                    <div className="flex items-center gap-1">
                      <FaStar className="text-yellow-400 text-sm" />
                      <span className="text-sm font-bold text-gray-800">{product.rating || 0}</span>
                    </div>
                  </div>
                </div>

                {/* Enhanced Details Section */}
                <div className="p-6">
                  {/* Title */}
                  <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-3 line-clamp-2 group-hover:text-primary dark:group-hover:text-primary transition-colors duration-300">
                    {product.title}
                  </h3>

                  {/* Rating with Reviews */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex text-yellow-400">
                        {[...Array(5)].map((_, i) => (
                          <FaStar
                            key={i}
                            className={`text-sm ${
                              i < Math.floor(product.rating || 0)
                                ? "text-yellow-400"
                                : "text-gray-300"
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-sm text-gray-600 dark:text-gray-300">
                        ({product.reviews || 0} reviews)
                      </span>
                    </div>
                  </div>

                  {/* Product Features */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <FaTshirt className="text-primary flex-shrink-0" />
                      <span className="truncate">{product.fabric_type || product.fabricType || product.material || 'Cotton'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <FaClock className="text-primary flex-shrink-0" />
                      <span>{product.production_time || product.productionTime || '3-5'} days</span>
                    </div>
                  </div>

                  {/* Colors Display */}
                  {productColors.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm text-gray-600 dark:text-gray-300">Available colors:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {productColors.slice(0, 5).map((color, colorIndex) => (
                          <div
                            key={colorIndex}
                            className="w-6 h-6 rounded-full border-3 border-gray-200 dark:border-gray-600 shadow-sm hover:scale-110 transition-transform duration-200 cursor-pointer"
                            style={{ backgroundColor: color.toLowerCase() }}
                            title={color}
                          />
                        ))}
                        {productColors.length > 5 && (
                          <span className="text-sm text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full">
                            +{productColors.length - 5}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 line-clamp-2">
                    {product.description || `Premium ${(product.category || 'apparel').toLowerCase()} made with high-quality ${product.fabric_type || product.fabricType || product.material || 'materials'}. Perfect for custom printing and everyday wear.`}
                  </p>

                  {/* Price Section */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-primary">
                        GH₵{productPrice.toFixed(2)}
                      </span>
                      {productOriginalPrice && productOriginalPrice > productPrice && (
                        <span className="text-lg text-gray-500 line-through">
                          GH₵{productOriginalPrice.toFixed(2)}
                        </span>
                      )}
                    </div>
                    {productOriginalPrice && productOriginalPrice > productPrice && (
                      <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-medium">
                        Save GH₵{(productOriginalPrice - productPrice).toFixed(2)}
                      </span>
                    )}
                  </div>

                  {/* Enhanced Add to Cart Button */}
                  <button
                    className="w-full bg-gradient-to-r from-primary to-secondary text-white py-3 px-6 rounded-xl hover:from-primary/90 hover:to-secondary/90 transition-all duration-300 transform hover:scale-105 font-semibold shadow-lg hover:shadow-xl flex items-center justify-center gap-2 group/button"
                    onClick={() => handleAddToCart(product)}
                  >
                    <FaShoppingCart className="group-hover/button:scale-110 transition-transform duration-200" />
                    Add to Cart
                  </button>
                </div>

                {/* Bottom Gradient Border */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-secondary to-primary transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500"></div>
              </div>
            );
          })}
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

        {/* Debug Info */}
        <div className="text-center mt-8 text-sm text-gray-500">
          Showing {displayProducts.length} products
        </div>
      </div>
    </div>
  );
};

export default TopProducts;