import React, { useState, useRef } from 'react';
import { FaTimes, FaImage, FaTrash, FaSpinner } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useUploadImageMutation } from '../../../slices/uploadApiSlice';

// Image Upload Component
const ImageUpload = ({ currentImage, onImageChange, isLoading }) => {
  const [preview, setPreview] = useState(currentImage || null);
  const [uploadImage, { isLoading: uploading }] = useUploadImageMutation();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (file) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);

    // Upload to server
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await uploadImage(formData).unwrap();
      onImageChange(response.image);
      toast.success('Image uploaded successfully');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error?.data?.message || 'Failed to upload image');
      setPreview(currentImage); // Revert to previous image
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileInput = (e) => {
    const file = e.target.files[0];
    handleFileSelect(file);
  };

  const handleRemove = () => {
    setPreview(null);
    onImageChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
        Product Image
      </label>
      
      {preview ? (
        <div className="relative group">
          <img 
            src={preview} 
            alt="Product preview" 
            className="w-full h-64 object-cover rounded-lg border-2 border-gray-300 dark:border-gray-600 transition-all"
          />
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all rounded-lg flex items-center justify-center">
            <button
              type="button"
              onClick={handleRemove}
              disabled={isLoading || uploading}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-3 bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-50 transform hover:scale-110"
              title="Remove image"
            >
              <FaTrash size={20} />
            </button>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all duration-300 ${
            isDragging
              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 scale-105'
              : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <FaImage className="mx-auto text-5xl text-gray-400 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 font-medium mb-2">
            Drag and drop an image here
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            or click to browse
          </p>
          <p className="text-xs text-gray-400">
            Supports: JPG, PNG, GIF, WEBP • Max size: 5MB
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
        onChange={handleFileInput}
        className="hidden"
        disabled={isLoading || uploading}
      />

      {uploading && (
        <div className="flex items-center justify-center gap-2 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3">
          <FaSpinner className="animate-spin text-lg" />
          <span className="font-medium">Uploading image...</span>
        </div>
      )}
    </div>
  );
};

// Main Product Form Modal Component
const ProductFormModal = ({ product, onClose, onSubmit, isLoading }) => {
  const [formData, setFormData] = useState({
    title: product?.title || '',
    img: product?.img || '',
    price: product?.price || '',
    originalPrice: product?.originalPrice || '',
    category: product?.category || '',
    color: product?.color || '',
    sizes: product?.sizes ? (Array.isArray(product.sizes) ? product.sizes.join(', ') : product.sizes) : '',
    colors: product?.colors ? (Array.isArray(product.colors) ? product.colors.join(', ') : product.colors) : '',
    rating: product?.rating || '',
    reviews: product?.reviews || 0,
    printType: product?.printType || '',
    material: product?.material || '',
    fabricType: product?.fabricType || '',
    productionTime: product?.productionTime || '',
    tag: product?.tag || '',
    isCustomizable: product?.isCustomizable || false,
    featured: product?.featured || false,
    basePrice: product?.basePrice || '',
  });

  // Printing press product categories
  const categories = [
    'T-Shirts',
    'Hoodies',
    'Caps/Hats',
    'Cups/Mugs',
    'Pens',
    'Posters',
    'Banners',
    'Business Cards',
    'Flyers',
    'Brochures',
    'Stickers',
    'Notebooks',
    'Keychains',
    'Bags/Totes',
    'Other'
  ];

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleImageChange = (imagePath) => {
    setFormData(prev => ({ ...prev, img: imagePath }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!formData.title.trim()) {
      toast.error('Product title is required');
      return;
    }
    if (!formData.price || isNaN(formData.price)) {
      toast.error('Valid price is required');
      return;
    }
    if (!formData.category) {
      toast.error('Please select a category');
      return;
    }

    // Prepare data
    const submitData = {
      ...formData,
      price: parseFloat(formData.price),
      originalPrice: formData.originalPrice ? parseFloat(formData.originalPrice) : null,
      basePrice: formData.basePrice ? parseFloat(formData.basePrice) : 0,
      rating: formData.rating ? parseFloat(formData.rating) : null,
      reviews: parseInt(formData.reviews) || 0,
      productionTime: formData.productionTime ? parseInt(formData.productionTime) : null,
      sizes: formData.sizes ? formData.sizes.split(',').map(s => s.trim()).filter(Boolean) : [],
      colors: formData.colors ? formData.colors.split(',').map(c => c.trim()).filter(Boolean) : [],
    };

    onSubmit(submitData);
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b dark:border-gray-700 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800 z-10">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
            {product ? 'Edit Product' : 'Add New Product'}
          </h2>
          <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <FaTimes size={24} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">
          
          {/* Image Upload Section */}
          <section>
            <ImageUpload
              currentImage={formData.img}
              onImageChange={handleImageChange}
              isLoading={isLoading}
            />
          </section>

          {/* Basic Information */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white">
              Basic Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Product Title *
                </label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="e.g., Custom Printed T-Shirt"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Category *
                </label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">Select category</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Tag
                </label>
                <input
                  type="text"
                  name="tag"
                  value={formData.tag}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="e.g., Best Seller, New Arrival"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Price ($) *
                </label>
                <input
                  type="number"
                  name="price"
                  value={formData.price}
                  onChange={handleChange}
                  required
                  step="0.01"
                  min="0"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Original Price ($)
                </label>
                <input
                  type="number"
                  name="originalPrice"
                  value={formData.originalPrice}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Production Time (days)
                </label>
                <input
                  type="number"
                  name="productionTime"
                  value={formData.productionTime}
                  onChange={handleChange}
                  min="0"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="3-5 days"
                />
              </div>
            </div>
          </section>

          {/* Product Details */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white">
              Product Specifications
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Available Colors (comma-separated)
                </label>
                <input
                  type="text"
                  name="colors"
                  value={formData.colors}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="Red, Blue, Green, Black, White"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Available Sizes (comma-separated)
                </label>
                <input
                  type="text"
                  name="sizes"
                  value={formData.sizes}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="S, M, L, XL, XXL"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Material
                </label>
                <input
                  type="text"
                  name="material"
                  value={formData.material}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="e.g., 100% Cotton, Ceramic, Plastic"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Print Type
                </label>
                <input
                  type="text"
                  name="printType"
                  value={formData.printType}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  placeholder="e.g., Screen Print, DTG, Embroidery, Sublimation"
                />
              </div>
            </div>
          </section>

          {/* Settings */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white">
              Product Settings
            </h3>
            <div className="flex flex-col sm:flex-row gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isCustomizable"
                  checked={formData.isCustomizable}
                  onChange={handleChange}
                  className="w-5 h-5 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Custom Design Available
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="featured"
                  checked={formData.featured}
                  onChange={handleChange}
                  className="w-5 h-5 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Featured Product
                </span>
              </label>
            </div>
          </section>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 font-medium"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                  Saving...
                </>
              ) : (
                <>{product ? 'Update Product' : 'Create Product'}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProductFormModal;