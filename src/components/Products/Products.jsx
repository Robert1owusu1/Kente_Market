// FILE: frontend/src/components/TrendingProducts/TrendingProducts.jsx
import React, { useState, useEffect } from 'react';
import { FaStar, FaHeart, FaEye, FaShoppingCart, FaFire, FaTags } from "react-icons/fa";
import { Link } from 'react-router-dom';
import { useCart } from "../../Context/CartContext";
import axios from "axios";

// ⭐ FIXED: Make sure /api is included
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const TrendingProducts = ({ handleOrderPopup }) => {
  const { addToCart } = useCart();

  // ⭐ State management for API data
  const [trendingProductsData, setTrendingProductsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ⭐ Fetch trending products from backend on component mount
  useEffect(() => {
    const fetchTrendingProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const url = `${API_URL}/products/trending`;
        console.log('🔍 Fetching trending products from:', url);
        
        const response = await axios.get(url, {
          params: { limit: 5 }
        });
        
        console.log('✅ Trending products received:', response.data);
        setTrendingProductsData(response.data);
      } catch (err) {
        console.error('❌ Failed to fetch trending products:', err);
        console.error('❌ Error details:', {
          message: err.message,
          url: err.config?.url,
          status: err.response?.status
        });
        setError('Failed to load trending products. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchTrendingProducts();
  }, []);

  const handleAddToCart = (product) => {
    const cartItem = {
      id: product.id,
      title: product.title,
      price: product.price,
      basePrice: product.basePrice || product.base_price || product.price,
      image: product.image || product.img,
      color: product.color,
      size: product.sizes ? product.sizes[0] : "M",
      quantity: 1,
      colorsAvailable: product.colors_available || product.colorsAvailable || product.colors || [product.color?.toLowerCase()],
      fabricType: product.fabric_type || product.fabricType || product.material,
      productionTime: product.production_time || product.productionTime || 3
    };
    
    addToCart(cartItem);
    
    if (handleOrderPopup) {
      handleOrderPopup();
    }
  };

  const calculateSavings = (price, originalPrice) => {
    if (originalPrice && originalPrice > price) {
      return originalPrice - price;
    }
    return 0;
  };

  // ⭐ Loading State
  if (loading) {
    return (
      <div className='mt-14 mb-12'>
        <div className='container'>
          <div className='text-center py-20'>
            <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary"></div>
            <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">Loading trending products...</p>
          </div>
        </div>
      </div>
    );
  }

  // ⭐ Error State
  if (error) {
    return (
      <div className='mt-14 mb-12'>
        <div className='container'>
          <div className='text-center bg-red-50 dark:bg-red-900/20 rounded-2xl p-8 max-w-2xl mx-auto'>
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

  // ⭐ Empty State
  if (!trendingProductsData || trendingProductsData.length === 0) {
    return (
      <div className='mt-14 mb-12'>
        <div className='container'>
          <div className='text-center py-20'>
            <div className="text-6xl mb-4">📈</div>
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
          <p data-aos="fade-up" className='text-sm text-primary flex items-center justify-center gap-2'>
            <FaFire className="text-orange-500" />
            Top Selling Products For You
          </p>
          <h1 data-aos="fade-up" className='text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent'>
            Trending Products
          </h1>
          <p data-aos="fade-up" className='text-xs text-gray-400'>
            Discover our most popular items loved by customers worldwide
          </p>
        </div>

        {/* Body section */}
        <div>
          <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 place-items-center'>
            {/* Card section */}
            {trendingProductsData.map((data, index) => (
              <div 
                data-aos="fade-up"
                data-aos-delay={index * 200}
                key={data.id} 
                className='group relative bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 w-full max-w-[280px] overflow-hidden border border-gray-100 dark:border-gray-700'
              >
                {/* Image section */}
                <div className='relative overflow-hidden rounded-t-xl'>
                  <img 
                    src={data.image || data.img} 
                    alt={data.title}
                    className='h-[220px] w-full object-cover group-hover:scale-110 transition-transform duration-500'
                    onError={(e) => {
                      e.target.src = '/placeholder-image.jpg';
                    }}
                  />
                  
                  {/* Trending badge */}
                  {(data.rating >= 4.7 || ["Trending", "Hot", "Best Seller", "Popular"].includes(data.tag)) && (
                    <div className='absolute top-3 left-3 bg-gradient-to-r from-orange-400 to-red-500 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1 animate-pulse'>
                      <FaFire className="text-[10px]" />
                      {data.tag || "Trending"}
                    </div>
                  )}

                  {/* Savings badge */}
                  {(data.original_price || data.originalPrice) && (
                    <div className='absolute top-3 right-3 bg-green-500 text-white text-xs px-2 py-1 rounded-full'>
                      Save ₵{calculateSavings(data.price, data.original_price || data.originalPrice)}
                    </div>
                  )}

                  {/* Rating badge */}
                  <div className='absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm text-gray-800 text-xs px-2 py-1 rounded-full flex items-center gap-1'>
                    <FaStar className='text-yellow-400 text-[10px]' />
                    <span className="font-semibold">{data.rating || 0}</span>
                  </div>

                  {/* Quick actions overlay */}
                  <div className='absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-3'>
                    <button className='bg-white/90 hover:bg-white p-2 rounded-full transform scale-0 group-hover:scale-100 transition-transform duration-200 delay-100'>
                      <FaEye className='text-gray-700' />
                    </button>
                    <button 
                      onClick={() => handleAddToCart(data)}
                      className='bg-primary hover:bg-primary/90 text-white p-2 rounded-full transform scale-0 group-hover:scale-100 transition-transform duration-200 delay-200'
                    >
                      <FaShoppingCart />
                    </button>
                    <button className='bg-white/90 hover:bg-white p-2 rounded-full transform scale-0 group-hover:scale-100 transition-transform duration-200 delay-300'>
                      <FaHeart className='text-red-500' />
                    </button>
                  </div>
                </div>

                {/* Content section */}
                <div className='p-4 space-y-3'>
                  {/* Title and category */}
                  <div>
                    <h3 className='font-bold text-lg text-gray-800 dark:text-white group-hover:text-primary transition-colors duration-300'>
                      {data.title}
                    </h3>
                    <p className='text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1'>
                      <FaTags className="text-[10px]" />
                      {data.category}
                    </p>
                  </div>

                  {/* Color display */}
                  <div className='flex items-center gap-2'>
                    <span className='text-xs text-gray-600 dark:text-gray-300'>Color:</span>
                    <div className='flex gap-1'>
                      {(data.colors_available || data.colorsAvailable || data.colors) ? (
                        (data.colors_available || data.colorsAvailable || data.colors).slice(0, 3).map((color, index) => (
                          <div 
                            key={index}
                            className={`w-4 h-4 rounded-full border-2 border-white shadow-sm`}
                            style={{ backgroundColor: color }}
                            title={color}
                          ></div>
                        ))
                      ) : (
                        <div 
                          className='w-4 h-4 rounded-full border-2 border-white shadow-sm'
                          style={{ backgroundColor: data.color?.toLowerCase() || '#gray' }}
                        ></div>
                      )}
                    </div>
                  </div>

                  {/* Price section */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <div className='flex items-center gap-2'>
                        <span className='text-lg font-bold text-primary'>
                          ₵{data.price}
                        </span>
                        {(data.original_price || data.originalPrice) && (
                          <span className='text-sm text-gray-400 line-through'>
                            ₵{data.original_price || data.originalPrice}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Product features */}
                  <div className='text-xs text-gray-500 dark:text-gray-400 space-y-1 pt-2 border-t border-gray-100 dark:border-gray-600'>
                    <p>Material: {data.fabric_type || data.fabricType || data.material}</p>
                    {data.sizes && <p>Sizes: {Array.isArray(data.sizes) ? data.sizes.join(', ') : data.sizes}</p>}
                    {data.reviews && <p>Reviews: {data.reviews}+ customers</p>}
                  </div>

                  {/* Add to cart button */}
                  <button
                    onClick={() => handleAddToCart(data)}
                    className='w-full bg-gradient-to-r from-primary to-secondary hover:from-secondary hover:to-primary text-white py-2 px-4 rounded-lg font-medium transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-2'
                  >
                    <FaShoppingCart className="text-sm" />
                    Add to Cart
                  </button>
                </div>

                {/* Animated border */}
                <div className='absolute bottom-0 left-0 w-0 h-1 bg-gradient-to-r from-primary to-secondary group-hover:w-full transition-all duration-500'></div>
              </div>
            ))}
          </div>

          {/* View all products */}
          <div className='flex justify-center mt-12'>
            <Link to="/products">
              <button className='group relative overflow-hidden bg-gradient-to-r from-primary to-secondary hover:from-secondary hover:to-primary text-white py-3 px-8 rounded-full font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl flex items-center gap-3'>
                <span>View All Products</span>
                <FaEye className="group-hover:translate-x-1 transition-transform duration-300" />
                
                {/* Animated background */}
                <div className='absolute inset-0 bg-gradient-to-r from-secondary to-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300'></div>
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrendingProducts;