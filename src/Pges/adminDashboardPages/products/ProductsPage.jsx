import React, { useState, useMemo } from 'react';
import { FaBox, FaSearch, FaEye, FaTrash, FaEdit, FaPlus, FaSync } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useGetProductsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation
} from '../../../slices/productsApiSlice';
import ProductFormModal from './ProductFormModal';

// Utility functions
const sanitizeString = (str) => {
  if (!str) return '';
  return String(str).trim();
};

const formatCurrency = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(num);
};

// Loading spinner component
const LoadingSpinner = ({ message = 'Loading...' }) => (
  <div className="p-8 text-center">
    <div className="animate-spin h-12 w-12 text-indigo-600 mx-auto border-4 border-indigo-200 border-t-indigo-600 rounded-full"></div>
    <p className="mt-4 text-gray-600 dark:text-gray-400">{message}</p>
  </div>
);

// Error display component
const ErrorDisplay = ({ message }) => (
  <div className="p-8 text-center">
    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-6">
      <p className="text-red-600 dark:text-red-400 font-medium">Error: {message}</p>
      <button 
        onClick={() => window.location.reload()} 
        className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
      >
        Retry
      </button>
    </div>
  </div>
);

// Main Products Page Component
const ProductsPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');

  // RTK Query hooks
  const { data: products = [], isLoading, error, refetch } = useGetProductsQuery({});
  const [createProduct, { isLoading: isCreating }] = useCreateProductMutation();
  const [updateProduct, { isLoading: isUpdating }] = useUpdateProductMutation();
  const [deleteProduct] = useDeleteProductMutation();

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean));
    return ['all', ...Array.from(cats)];
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    if (!Array.isArray(products)) return [];
    
    let filtered = [...products];

    // Filter by category
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(p => p.category === categoryFilter);
    }

    // Search filter
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(product => {
        const title = sanitizeString(product.title).toLowerCase();
        const category = (product.category || '').toLowerCase();
        const tag = (product.tag || '').toLowerCase();
        
        return title.includes(query) || category.includes(query) || tag.includes(query);
      });
    }

    return filtered;
  }, [products, searchQuery, categoryFilter]);

  // Product statistics
  const stats = useMemo(() => ({
    total: products.length,
    featured: products.filter(p => p.featured).length,
    avgPrice: products.length > 0 ? products.reduce((sum, p) => sum + (Number(p.price) || 0), 0) / products.length : 0,
    totalValue: products.reduce((sum, p) => sum + (Number(p.price) || 0), 0),
  }), [products]);

  // Handlers
  const handleAddProduct = () => {
    setSelectedProduct(null);
    setShowModal(true);
  };

  const handleEditProduct = (product) => {
    setSelectedProduct(product);
    setShowModal(true);
  };

  const handleDeleteProduct = async (productId) => {
    if (!window.confirm('Are you sure you want to delete this product? This action cannot be undone.')) return;
    
    try {
      await deleteProduct(productId).unwrap();
      toast.success('Product deleted successfully');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to delete product');
    }
  };

  const handleSubmitProduct = async (productData) => {
    try {
      if (selectedProduct) {
        await updateProduct({ productId: selectedProduct.id, ...productData }).unwrap();
        toast.success('Product updated successfully');
      } else {
        await createProduct(productData).unwrap();
        toast.success('Product created successfully');
      }
      setShowModal(false);
      setSelectedProduct(null);
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to save product');
    }
  };

  if (isLoading) return <LoadingSpinner message="Loading products..." />;
  if (error) return <ErrorDisplay message={error?.data?.message || 'Failed to load products'} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Product Management</h2>
        <div className="flex gap-2">
          <button 
            onClick={refetch} 
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
          >
            <FaSync className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button 
            onClick={handleAddProduct}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
          >
            <FaPlus />
            Add Product
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Products</p>
          <p className="text-2xl font-bold text-indigo-600">{stats.total}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Featured</p>
          <p className="text-2xl font-bold text-green-600">{stats.featured}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Avg Price</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(stats.avgPrice)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Value</p>
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(stats.totalValue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <input 
            type="text" 
            placeholder="Search by product name, category, or tag..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-gray-900 dark:text-white" 
          />
          <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
        </div>
        <select 
          value={categoryFilter} 
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-gray-900 dark:text-white"
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>
              {cat === 'all' ? 'All Categories' : cat}
            </option>
          ))}
        </select>
      </div>

      {/* Products Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {filteredProducts.length === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">
            <FaBox className="mx-auto text-4xl mb-4 opacity-50" />
            <p>{searchQuery ? 'No products match your search' : 'No products found'}</p>
            <button 
              onClick={handleAddProduct}
              className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Add Your First Product
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="p-4">Image</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-4">
                      {product.img ? (
                        <img src={product.img} alt={product.title} className="w-16 h-16 object-cover rounded" />
                      ) : (
                        <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center">
                          <FaBox className="text-gray-400" />
                        </div>
                      )}
                    </td>
                    <td>
                      <div>
                        <p className="font-medium text-gray-800 dark:text-white">{sanitizeString(product.title)}</p>
                        {product.tag && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">{sanitizeString(product.tag)}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                        {sanitizeString(product.category) || 'N/A'}
                      </span>
                    </td>
                    <td>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white">{formatCurrency(product.price)}</p>
                        {product.originalPrice && Number(product.originalPrice) > Number(product.price) && (
                          <p className="text-xs text-gray-500 line-through">{formatCurrency(product.originalPrice)}</p>
                        )}
                      </div>
                    </td>
                    <td>
                      {product.featured ? (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          Featured
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                          Standard
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => window.open(`/product/${product.id}`, '_blank')} 
                          className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded" 
                          title="View Product"
                        >
                          <FaEye />
                        </button>
                        <button 
                          onClick={() => handleEditProduct(product)} 
                          className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 rounded" 
                          title="Edit Product"
                        >
                          <FaEdit />
                        </button>
                        <button 
                          onClick={() => handleDeleteProduct(product.id)} 
                          className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded" 
                          title="Delete Product"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Product Form Modal */}
      {showModal && (
        <ProductFormModal
          product={selectedProduct}
          onClose={() => {
            setShowModal(false);
            setSelectedProduct(null);
          }}
          onSubmit={handleSubmitProduct}
          isLoading={isCreating || isUpdating}
        />
      )}
    </div>
  );
};

export default ProductsPage;