import React from 'react';
import { FaHeart, FaTrash, FaShoppingCart, FaStar, FaTags } from 'react-icons/fa';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useCart } from '../../Context/CartContext';
import { useGetMyWishlistQuery, useRemoveFromWishlistMutation } from '../../slices/wishlistApiSlice';
import { ProductGridSkeleton } from '../../components/loader/Skeleton';

const WishlistPage = () => {
  const { data: wishlist = [], isLoading, error } = useGetMyWishlistQuery();
  const [removeFromWishlist, { isLoading: removing }] = useRemoveFromWishlistMutation();
  const { addToCart } = useCart();

  const handleAddToCart = (product) => {
    const productColors = product.colorsAvailable || product.colors || [];
    const productSizes = product.sizes || ['One Size'];

    const cartItem = {
      id: product.productId || product.id,
      title: product.title,
      price: Number(product.price) || 0,
      basePrice: Number(product.price) || 0,
      image: product.img,
      img: product.img,
      colorsAvailable: productColors,
      colors: productColors,
      sizes: productSizes,
      fabricType: product.fabricType || product.material || 'Cotton',
      material: product.material || product.fabricType || 'Cotton',
      productionTime: product.productionTime || '3-5',
      category: product.category,
      rating: product.rating || 0,
      reviews: product.reviews || 0,
    };

    addToCart(cartItem);
    toast.success('Added to cart');
  };

  const handleRemove = async (product) => {
    try {
      await removeFromWishlist(product.productId || product.id).unwrap();
      toast.success('Removed from wishlist');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to remove from wishlist');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen py-10">
        <div className="container">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white">My Wishlist</h1>
          </div>
          <ProductGridSkeleton count={8} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 place-items-center" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen py-10">
        <div className="container">
          <div className="text-center bg-red-50 dark:bg-red-900/20 rounded-2xl p-8 max-w-2xl mx-auto">
            <div className="text-red-500 dark:text-red-400 text-5xl mb-4">⚠️</div>
            <h3 className="text-xl font-bold text-red-800 dark:text-red-300 mb-2">
              Oops! Something went wrong
            </h3>
            <p className="text-red-600 dark:text-red-400 mb-6">
              {error?.data?.message || 'Failed to load your wishlist'}
            </p>
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

  if (wishlist.length === 0) {
    return (
      <div className="min-h-screen py-10">
        <div className="container">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white">My Wishlist</h1>
          </div>
          <div className="text-center py-20">
            <FaHeart className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
              Your wishlist is empty
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-8">
              Save the items you love and find them here
            </p>
            <Link to="/products">
              <button className="group relative overflow-hidden bg-gradient-to-r from-primary to-secondary hover:from-secondary hover:to-primary text-white py-3 px-8 rounded-full font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl">
                Browse Products
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-10">
      <div className="container">
        {/* Page header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white">My Wishlist</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {wishlist.length} {wishlist.length === 1 ? 'item' : 'items'} saved
          </p>
        </div>

        {/* Wishlist grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 place-items-center">
          {wishlist.map((data) => (
            <div
              key={data.productId || data.id}
              className="group relative bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 w-full max-w-[280px] overflow-hidden border border-gray-100 dark:border-gray-700"
            >
              {/* Image section */}
              <div className="relative overflow-hidden rounded-t-xl">
                <Link to={`/product/${data.productId || data.id}`}>
                  <img
                    src={data.img}
                    alt={data.title}
                    loading="lazy"
                    decoding="async"
                    className="h-[220px] w-full object-cover group-hover:scale-110 transition-transform duration-500"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="#f4eee1" width="400" height="300"/><text x="200" y="155" font-family="sans-serif" font-size="20" fill="#8a6d3b" text-anchor="middle">Kente image coming soon</text></svg>');
                    }}
                  />
                </Link>

                {/* Rating badge */}
                <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm text-gray-800 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                  <FaStar className="text-yellow-400 text-[10px]" />
                  <span className="font-semibold">{data.rating || 0}</span>
                </div>
              </div>

              {/* Content section */}
              <div className="p-4 space-y-3">
                <div>
                  <h3 className="font-bold text-lg text-gray-800 dark:text-white group-hover:text-primary transition-colors duration-300">
                    {data.title}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <FaTags className="text-[10px]" />
                    {data.category}
                  </p>
                </div>

                {/* Price section */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-primary">
                      GH₵ {Number(data.price).toFixed(2)}
                    </span>
                    {data.originalPrice && (
                      <span className="text-sm text-gray-400 line-through">
                        GH₵ {Number(data.originalPrice).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-600">
                  <button
                    onClick={() => handleAddToCart(data)}
                    className="flex-1 bg-gradient-to-r from-primary to-secondary hover:from-secondary hover:to-primary text-white py-2 px-3 rounded-lg font-medium transition-all duration-300 flex items-center justify-center gap-2"
                  >
                    <FaShoppingCart className="text-sm" />
                    Add to Cart
                  </button>
                  <button
                    onClick={() => handleRemove(data)}
                    disabled={removing}
                    title="Remove from Wishlist"
                    className="p-2 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
                  >
                    <FaTrash className="text-sm" />
                  </button>
                </div>
              </div>

              {/* Animated border */}
              <div className="absolute bottom-0 left-0 w-0 h-1 bg-gradient-to-r from-primary to-secondary group-hover:w-full transition-all duration-500"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WishlistPage;
