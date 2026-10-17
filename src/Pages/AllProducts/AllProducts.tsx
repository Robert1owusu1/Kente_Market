import React, { useState, useEffect, useMemo } from 'react';
import { FaFilter, FaTh, FaList, FaChevronDown, FaTimes, FaPalette } from "react-icons/fa";
import { useCart } from "../../Context/CartContext";
import Brands from "../../Pages/AllProducts/Brands";
import { useGetProductsQuery } from '../../slices/productsApiSlice';
import { useGetCategoriesQuery } from '../../slices/categoriesApiSlice';
import { useWishlistAction } from '../../hooks/useWishlistAction';
import { Link, useSearchParams } from 'react-router-dom';
import { ProductGridSkeleton } from '../../components/loader/Skeleton';
import ProductCard from '../../components/ProductCard/ProductCard';
import { toCartItem } from '../../utils/cartItem';
import { yardOptionsFor, evenYardsFrom } from '../../utils/yards';
import Seo from '../../components/Seo/Seo';
import type { Product } from '../../types/domain';

type ProductCardType = Product & {
  printType?: string;
  reviews?: number;
  tag?: string;
  vendorStatus?: string;
  productionTime?: string;
};


const AllProducts = ({ handleOrderPopup }: { handleOrderPopup?: () => void }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearchQuery = searchParams.get('search') || '';

 // P1 pagination: growing-limit over the server catalogue (server clamps
 // 1..60/page, default 24). includeCount drives the hasMore affordance.
 const PAGE_SIZE = 24;
 const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
 // New searches start from the first page again.
 useEffect(() => { setVisibleLimit(PAGE_SIZE); }, [urlSearchQuery]);
 // Pass search parameter to the query
  const { data: productsData, isLoading, error, refetch } = useGetProductsQuery(
    { ...(urlSearchQuery ? { search: urlSearchQuery } : {}), limit: visibleLimit, includeCount: true }
  );
  const serverPagination = (
    productsData as unknown as { pagination?: { total?: number; limit?: number; offset?: number; hasMore?: boolean } }
  )?.pagination;
  const serverHasMore = serverPagination?.hasMore ?? false;
  // Memoised so filters/effects that depend on it don't re-run every render.
  const products: ProductCardType[] = useMemo(() => (
    Array.isArray(productsData)
      ? productsData
      : productsData?.products || productsData?.docs || []
  ) as ProductCardType[], [productsData]);
  const serverTotal = serverPagination?.total ?? products.length;
  const apiError = error as { data?: { message?: string }; error?: string } | undefined;
  const { data: platformCategories = [] } = useGetCategoriesQuery();

  
  const { addToCart } = useCart();
  const saveToFavorites = useWishlistAction();
  
  // State management
  const [searchQuery, setSearchQuery] = useState(urlSearchQuery);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedPrintType, setSelectedPrintType] = useState('All');
  const [selectedMaterial, setSelectedMaterial] = useState('All');
  const [priceRange, setPriceRange] = useState([0, 1000]);
  const [sortBy, setSortBy] = useState('featured');
  const [viewMode, setViewMode] = useState('grid');
  const [showFilters, setShowFilters] = useState(false);

 // Sync URL search param with local state
  useEffect(() => {
    const urlSearch = searchParams.get('search');
    if (urlSearch) {
      setSearchQuery(urlSearch);
      setShowFilters(true);
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
    // The sidebar groups these under "Yards" — keep only even yardage so
    // legacy clothing sizes ("S", "M", "L") never appear as yard values.
    return evenYardsFrom(sizes);
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

  // Merge the admin-manageable platform categories with any categories found
  // on products, so the filter always reflects the current set.
  const productCategories = (products || []).map(p => p.category).filter(Boolean);
  const categories = ['All', ...new Set([...platformCategories.map(c => c.name), ...productCategories])];
  const allColors = getUniqueColors();
  const allSizes = getUniqueSizes();
  const printTypes = getUniquePrintTypes();
  const materials = getUniqueMaterials();

  // Enhanced cart handler
  const addToCartHandler = (product: ProductCardType) => {
    // Kente is pre-designed: yardage (even numbers) is the only variant. The
    // listing adds the first offered length; the product page lets buyers pick.
    // Same cart shape as the product page (utils/cartItem) — no invented
    // material / print / production-time values.
    const cartItem = toCartItem(product, yardOptionsFor(product)[0], 1);
    addToCart(cartItem);
    
    if (handleOrderPopup) {
      handleOrderPopup();
    }
  };

 // Enhanced filter logic - Backend handles search, frontend handles other filters
  const filteredProducts = useMemo(() => {
    
    if (!products || products.length === 0) {
      return [];
    }

    let filtered = [...products];

 // NOTE: Search is already handled by backend via query params
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

    return filtered;
  }, [products, selectedCategory, selectedColors, selectedSizes, selectedPrintType, selectedMaterial, priceRange, sortBy]);

 // Clear all filters including search
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="skeleton h-10 w-72 mx-auto rounded-lg" />
            <div className="skeleton h-4 w-96 max-w-full mx-auto mt-4 rounded" />
          </div>
          <ProductGridSkeleton count={8} className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-8" />
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
          <p className="text-gray-600 dark:text-gray-300 mb-4">{apiError?.data?.message || apiError?.error || 'Something went wrong'}</p>
          <button
            onClick={() => refetch()}
            className="btn btn-primary px-6"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Seo
        title="Shop All Kente Cloth, Fabrics & Accessories | Bonwire Kente"
        description="Browse the full collection of authentic, handwoven Ghanaian Kente cloth, fabrics, custom prints and accessories. Buy online with delivery across Ghana."
        image={`https://kente-market.vercel.app/og-cover.png`}
      />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 leading-tight">
            {searchQuery ? `Search Results for "${searchQuery}"` : 'All Products'}
          </h1>
          <p className="text-base sm:text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            {searchQuery ? `Found ${filteredProducts.length} matching products` : 'Discover our complete collection of authentic handwoven Kente cloth, accessories, and home decor'}
          </p>
        </div>
        <div>
          <Brands />
        </div>

        <div className="bg-gradient-to-b from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-16">
      <div className="container mx-auto px-6">
        <div data-aos="fade-up" className="text-center">
          <Link to="/ai-tryon" className="inline-block">
            <div className="inline-flex items-center gap-4 bg-gradient-to-r from-primary to-secondary text-white rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 max-w-xl cursor-pointer">
 <FaPalette className="text-4xl" />
              <div className="text-left">
                <h3 className="text-xl font-bold mb-1">Try It On Before You Buy</h3>
                <p className="text-sm text-white/80">
                  Open any Kente piece and tap "Try It On" to see that exact piece on you
                </p>
              </div>
              <span className="text-2xl">→</span>
            </div>
          </Link>
        </div>
      </div>
    </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
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
                {filteredProducts.length} of {products?.length || 0} {(products?.length || 0) === 1 ? 'product' : 'products'}
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

            <div className="flex items-center justify-between gap-2 md:justify-end">
              <div className="relative flex-1 md:flex-none">
                <select
                  aria-label="Sort products"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="appearance-none bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-3 md:px-4 py-2 pr-8 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-hidden focus:ring-2 focus:ring-primary w-full"
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
                  aria-label="Grid view"
                  className={`p-2 ${viewMode === 'grid' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                >
                  <FaTh />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  aria-label="List view"
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
 {/* Search input in filters */}
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
                  placeholder="Search kente cloth by name, category, or weaving style..."
                  className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-4 py-2 pr-10 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-hidden focus:ring-2 focus:ring-primary"
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
                  aria-label="Category"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-hidden focus:ring-2 focus:ring-primary"
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
                  aria-label="Print type"
                    value={selectedPrintType}
                    onChange={(e) => setSelectedPrintType(e.target.value)}
                    className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-hidden focus:ring-2 focus:ring-primary"
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
                  aria-label="Material"
                    value={selectedMaterial}
                    onChange={(e) => setSelectedMaterial(e.target.value)}
                    className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-hidden focus:ring-2 focus:ring-primary"
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
                    Price Range: GH₵{priceRange[0]} - GH₵{priceRange[1]}
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
                <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Yards</h3>
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
                      {size} yd
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
              className="btn btn-primary px-6 transition-colors duration-200"
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          <div className={
            viewMode === 'grid' 
              ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-8"
              : "space-y-6"
          }>
            {filteredProducts.map((product, i) => (
              <ProductCard
                key={product.id}
                product={product}
                onAddToCart={() => addToCartHandler(product)}
                onToggleWishlist={saveToFavorites}
                priority={i < 4}
              />
            ))}
          </div>
        )}

        {filteredProducts.length > 0 && serverHasMore && (
          <div className="text-center mt-10">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Showing {filteredProducts.length} of {serverTotal} products
            </p>
            <button
              onClick={() => setVisibleLimit((l) => l + PAGE_SIZE)}
              className="bg-primary text-white px-8 py-3 rounded-lg hover:bg-primary/90 transition-colors duration-200 font-medium"
            >
              Show more
            </button>
          </div>
        )}

      </div>
    </div>
    </>
  );
};

export default AllProducts;