import React, { useState, useEffect, useMemo } from 'react';
import { FaStar, FaHeart, FaEye, FaShoppingCart, FaFilter, FaTh, FaList, FaChevronDown, FaTimes, FaPalette, FaPlus } from 'react-icons/fa';
import { useCart } from "../../Context/CartContext";
import Brands from "../../Pges/AllProducts/bands";
import { useGetProductsQuery } from '../../slices/productsApiSlice';
import { Link, useSearchParams } from 'react-router-dom';

const AllProducts = ({ handleOrderPopup }) => {
  // ✅ Get URL search params
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearchQuery = searchParams.get('search') || '';

  console.log('🔍 AllProducts - URL Search Query:', urlSearchQuery);

  // ✅ Pass search parameter to the query
  const { data: products = [], isLoading, error, refetch } = useGetProductsQuery(
    urlSearchQuery ? { search: urlSearchQuery } : {}
  );

  console.log('📦 Products received from API:', products.length, products);
  
  const { addToCart } = useCart();
  
  // State management
  const [searchQuery, setSearchQuery] = useState(urlSearchQuery);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedColors, setSelectedColors] = useState([]);
  const [selectedSizes, setSelectedSizes] = useState([]);
  const [selectedPrintType, setSelectedPrintType] = useState('All');
  const [selectedMaterial, setSelectedMaterial] = useState('All');
  const [priceRange, setPriceRange] = useState([0, 1000]);
  const [sortBy, setSortBy] = useState('featured');
  const [viewMode, setViewMode] = useState('grid');
  const [showFilters, setShowFilters] = useState(false);

  // ✅ Sync URL search param with local state
  useEffect(() => {
    const urlSearch = searchParams.get('search');
    if (urlSearch) {
      setSearchQuery(urlSearch);
      setShowFilters(true);
      console.log('🔍 Search query updated from URL:', urlSearch);
    }
  }, [searchParams]);

  // Initialize price range based on actual product prices
  useEffect(() => {
    if (products && products.length > 0) {
      const prices = products.map(p => Number(p.price) || 0);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      setPriceRange([minPrice, maxPrice]);
    }
  }, [products]);

  // Get unique values for filters
  const getUniqueCategories = () => {
    if (!products || products.length === 0) return ['All'];
    const cats = products.map(p => p.category).filter(Boolean);
    return ['All', ...new Set(cats)];
  };

  const getUniqueColors = () => {
    if (!products || products.length === 0) return [];
    const colors = products.flatMap(p => {
      if (p.colors && Array.isArray(p.colors)) return p.colors;
      if (p.colorsAvailable && Array.isArray(p.colorsAvailable)) return p.colorsAvailable;
      return [];
    }).filter(Boolean);
    return [...new Set(colors)];
  };

  const getUniqueSizes = () => {
    if (!products || products.length === 0) return [];
    const sizes = products.flatMap(p => p.sizes || []).filter(Boolean);
    return [...new Set(sizes)];
  };

  const getUniquePrintTypes = () => {
    if (!products || products.length === 0) return ['All'];
    const types = products.map(p => p.printType).filter(Boolean);
    return ['All', ...new Set(types)];
  };

  const getUniqueMaterials = () => {
    if (!products || products.length === 0) return ['All'];
    const materials = products.map(p => p.material || p.fabricType).filter(Boolean);
    return ['All', ...new Set(materials)];
  };

  const categories = getUniqueCategories();
  const allColors = getUniqueColors();
  const allSizes = getUniqueSizes();
  const printTypes = getUniquePrintTypes();
  const materials = getUniqueMaterials();

  // Enhanced cart handler
  const addToCartHandler = (product) => {
    const productColors = product.colors || product.colorsAvailable || [];
    const productSizes = product.sizes || ['One Size'];
    
    const cartItem = {
      id: product.id,
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
      printType: product.printType || 'Standard',
      printMethod: product.printType || 'Standard',
      productionTime: product.productionTime || '3-5',
      category: product.category,
      rating: product.rating || 0,
      reviews: product.reviews || 0,
      isCustomizable: product.isCustomizable || false,
      quantity: 1,
      selectedColor: productColors[0] || 'default',
      selectedSize: productSizes[0] || 'M'
    };
    
    addToCart(cartItem);
    
    if (handleOrderPopup) {
      handleOrderPopup();
    }
  };

  // ✅ Enhanced filter logic - Backend handles search, frontend handles other filters
  const filteredProducts = useMemo(() => {
    console.log('🔍 Filtering products. Total from backend:', products?.length || 0);
    
    if (!products || products.length === 0) {
      return [];
    }

    let filtered = [...products];

    // ⚠️ NOTE: Search is already handled by backend via query params
    // We only apply additional client-side filters here

    if (selectedCategory !== 'All') {
      filtered = filtered.filter(product => product.category === selectedCategory);
    }

    if (selectedColors.length > 0) {
      filtered = filtered.filter(product => {
        const productColors = product.colors || product.colorsAvailable || [];
        return productColors.some(color => selectedColors.includes(color));
      });
    }

    if (selectedSizes.length > 0) {
      filtered = filtered.filter(product => {
        const productSizes = product.sizes || [];
        return productSizes.length === 0 || productSizes.some(size => selectedSizes.includes(size));
      });
    }

    if (selectedPrintType !== 'All') {
      filtered = filtered.filter(product => 
        (product.printType || 'Standard') === selectedPrintType
      );
    }

    if (selectedMaterial !== 'All') {
      filtered = filtered.filter(product => 
        (product.material || product.fabricType || 'Cotton') === selectedMaterial
      );
    }

    filtered = filtered.filter(product => {
      const price = Number(product.price) || 0;
      return price >= priceRange[0] && price <= priceRange[1];
    });

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'price-low':
          return (Number(a.price) || 0) - (Number(b.price) || 0);
        case 'price-high':
          return (Number(b.price) || 0) - (Number(a.price) || 0);
        case 'rating':
          return (Number(b.rating) || 0) - (Number(a.rating) || 0);
        case 'newest':
          return (Number(b.id) || 0) - (Number(a.id) || 0);
        case 'featured':
        default: {
          const aFeatured = a.featured ? 1 : 0;
          const bFeatured = b.featured ? 1 : 0;
          if (aFeatured !== bFeatured) {
            return bFeatured - aFeatured;
          }
          return (Number(b.rating) || 0) - (Number(a.rating) || 0);
        }
      }
    });

    console.log('✅ Filtered products:', filtered.length);
    return filtered;
  }, [products, selectedCategory, selectedColors, selectedSizes, selectedPrintType, selectedMaterial, priceRange, sortBy]);

  // ✅ Clear all filters including search
  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setSelectedColors([]);
    setSelectedSizes([]);
    setSelectedPrintType('All');
    setSelectedMaterial('All');
    setSortBy('featured');
    
    // Clear URL search param
    searchParams.delete('search');
    setSearchParams(searchParams);
    
    if (products && products.length > 0) {
      const prices = products.map(p => Number(p.price) || 0);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      setPriceRange([minPrice, maxPrice]);
    }
  };

  const ProductCard = ({ product }) => {
    const productColors = product.colors || product.colorsAvailable || [];
    const productPrice = Number(product.price) || 0;
    const productRating = Number(product.rating) || 0;
    const productReviews = product.reviews || 0;

    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 group relative overflow-hidden">
        <div className="absolute top-3 left-3 z-10">
          {product.tag && (
            <span className="bg-gradient-to-r from-primary to-secondary text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg">
              {product.tag}
            </span>
          )}
        </div>

        <button className="absolute top-3 right-3 z-10 p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-all duration-300 opacity-0 group-hover:opacity-100">
          <FaHeart className="text-red-500 hover:text-red-600" />
        </button>

        <div className="relative overflow-hidden aspect-square">
          <img
            src={product.img}
            alt={product.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
            onError={(e) => {
              e.target.src = '/placeholder-image.jpg';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0">
            <div className="flex gap-2">
              <Link to={`/product/${product.id}`} className="p-3 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors duration-200">
                <FaEye className="text-gray-700" />
              </Link>
              <button 
                onClick={() => addToCartHandler(product)}
                className="p-3 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-colors duration-200"
              >
                <FaShoppingCart />
              </button>
            </div>
          </div>
        </div>

        <div className="p-4">
          <h3 className="font-bold text-lg text-gray-800 dark:text-white mb-2 line-clamp-2">
            {product.title}
          </h3>
          
          <div className="flex items-center gap-2 mb-2">
            <div className="flex text-yellow-400">
              {[...Array(5)].map((_, i) => (
                <FaStar 
                  key={`${product.id}-star-${i}`} 
                  className={i < Math.floor(productRating) ? 'text-yellow-400' : 'text-gray-300'} 
                />
              ))}
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-300">
              ({productReviews})
            </span>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl font-bold text-primary">
              ${productPrice.toFixed(2)}
            </span>
            {product.originalPrice && Number(product.originalPrice) > productPrice && (
              <span className="text-lg text-gray-500 line-through">
                ${Number(product.originalPrice).toFixed(2)}
              </span>
            )}
          </div>

          {productColors.length > 0 && (
            <div className="flex items-center gap-1 mb-3">
              <span className="text-xs text-gray-600 dark:text-gray-300 mr-2">Colors:</span>
              {productColors.slice(0, 4).map((color, index) => (
                <div
                  key={`${product.id}-color-${index}`}
                  className="w-4 h-4 rounded-full border-2 border-gray-300"
                  style={{ backgroundColor: color.toLowerCase() }}
                  title={color}
                />
              ))}
              {productColors.length > 4 && (
                <span className="text-xs text-gray-500 ml-1">+{productColors.length - 4}</span>
              )}
            </div>
          )}

          <div className="text-xs text-gray-600 dark:text-gray-300 mb-4">
            <div className="flex justify-between">
              <span>{product.material || product.fabricType || 'Cotton'}</span>
              <span>{product.productionTime || '3-5'} days</span>
            </div>
          </div>

          <button
            onClick={() => addToCartHandler(product)}
            className="w-full bg-gradient-to-r from-primary to-secondary text-white py-2 px-4 rounded-lg hover:from-primary/90 hover:to-secondary/90 transition-all duration-300 transform hover:scale-105 font-medium"
          >
            Add to Cart
          </button>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-xl text-gray-600 dark:text-gray-300">Loading products...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 flex items-center justify-center">
        <div className="text-center">
          <FaTimes className="mx-auto text-6xl text-red-400 mb-4" />
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
            Error Loading Products
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-4">{error?.data?.message || error?.error || 'Something went wrong'}</p>
          <button
            onClick={() => refetch()}
            className="bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            {searchQuery ? `Search Results for "${searchQuery}"` : 'All Products'}
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            {searchQuery ? `Found ${filteredProducts.length} matching products` : 'Discover our complete collection of premium custom apparel'}
          </p>
        </div>
        <div>
          <Brands />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors duration-200"
              >
                <FaFilter />
                Filters
                {(searchQuery || selectedCategory !== 'All' || selectedColors.length > 0 || selectedSizes.length > 0) && (
                  <span className="bg-white text-primary rounded-full px-2 py-1 text-xs font-bold ml-1">
                    {[
                      searchQuery ? 1 : 0,
                      selectedCategory !== 'All' ? 1 : 0,
                      selectedColors.length,
                      selectedSizes.length
                    ].reduce((a, b) => a + b, 0)}
                  </span>
                )}
              </button>
              
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {filteredProducts.length} of {products?.length || 0} products
              </span>

              {(searchQuery || selectedCategory !== 'All' || selectedColors.length > 0 || selectedSizes.length > 0) && (
                <button
                  onClick={clearAllFilters}
                  className="text-sm text-primary hover:text-primary/80 underline"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="appearance-none bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-4 py-2 pr-8 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="featured">Featured</option>
                  <option value="newest">Newest</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                  <option value="rating">Highest Rated</option>
                </select>
                <FaChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 pointer-events-none" />
              </div>

              <div className="flex border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 ${viewMode === 'grid' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                >
                  <FaTh />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 ${viewMode === 'list' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                >
                  <FaList />
                </button>
              </div>
            </div>
          </div>
        </div>

        {showFilters && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-8">
            {/* ✅ Search input in filters */}
            <div className="mb-6">
              <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Search</h3>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && searchQuery.trim()) {
                      searchParams.set('search', searchQuery.trim());
                      setSearchParams(searchParams);
                    }
                  }}
                  placeholder="Search products by name, category, or material..."
                  className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-4 py-2 pr-10 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      searchParams.delete('search');
                      setSearchParams(searchParams);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Category</h3>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>

              {printTypes.length > 1 && (
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Print Type</h3>
                  <select
                    value={selectedPrintType}
                    onChange={(e) => setSelectedPrintType(e.target.value)}
                    className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {printTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
              )}

              {materials.length > 1 && (
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Material</h3>
                  <select
                    value={selectedMaterial}
                    onChange={(e) => setSelectedMaterial(e.target.value)}
                    className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {materials.map(material => (
                      <option key={material} value={material}>{material}</option>
                    ))}
                  </select>
                </div>
              )}

              {products && products.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-white mb-3">
                    Price Range: ${priceRange[0]} - ${priceRange[1]}
                  </h3>
                  <div className="flex gap-2">
                    <input
                      type="range"
                      min={Math.min(...products.map(p => Number(p.price) || 0))}
                      max={Math.max(...products.map(p => Number(p.price) || 0))}
                      value={priceRange[0]}
                      onChange={(e) => setPriceRange([parseInt(e.target.value), priceRange[1]])}
                      className="flex-1"
                    />
                    <input
                      type="range"
                      min={Math.min(...products.map(p => Number(p.price) || 0))}
                      max={Math.max(...products.map(p => Number(p.price) || 0))}
                      value={priceRange[1]}
                      onChange={(e) => setPriceRange([priceRange[0], parseInt(e.target.value)])}
                      className="flex-1"
                    />
                  </div>
                </div>
              )}
            </div>

            {allColors.length > 0 && (
              <div className="mt-6">
                <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Colors</h3>
                <div className="flex flex-wrap gap-3">
                  {allColors.map(color => (
                    <button
                      key={color}
                      onClick={() => {
                        setSelectedColors(prev => 
                          prev.includes(color) 
                            ? prev.filter(c => c !== color)
                            : [...prev, color]
                        );
                      }}
                      className={`w-8 h-8 rounded-full border-4 transition-all duration-200 ${
                        selectedColors.includes(color) 
                          ? 'border-primary shadow-lg scale-110' 
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                      style={{ backgroundColor: color.toLowerCase() }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            )}

            {allSizes.length > 0 && (
              <div className="mt-6">
                <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Sizes</h3>
                <div className="flex flex-wrap gap-2">
                  {allSizes.map(size => (
                    <button
                      key={size}
                      onClick={() => {
                        setSelectedSizes(prev => 
                          prev.includes(size) 
                            ? prev.filter(s => s !== size)
                            : [...prev, size]
                        );
                      }}
                      className={`px-4 py-2 rounded-lg border-2 transition-all duration-200 ${
                        selectedSizes.includes(size)
                          ? 'border-primary bg-primary text-white'
                          : 'border-gray-300 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white hover:border-gray-400'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {filteredProducts.length === 0 ? (
          <div className="text-center py-20">
            <div className="mb-4">
              <FaTimes className="mx-auto text-6xl text-gray-400" />
            </div>
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
              No products found
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              {searchQuery 
                ? `No products match "${searchQuery}". Try adjusting your search or filters.`
                : 'Try adjusting your filters or search criteria'}
            </p>
            <button
              onClick={clearAllFilters}
              className="bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors duration-200"
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          <div className={
            viewMode === 'grid' 
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8"
              : "space-y-6"
          }>
            {filteredProducts.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        <div className="fixed bottom-2 right-6 z-50">
          <button className="bg-gradient-to-r from-primary to-secondary text-white p-4 rounded-full shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-110 group">
            <FaPlus className="text-xl group-hover:rotate-180 transition-transform duration-300" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AllProducts;