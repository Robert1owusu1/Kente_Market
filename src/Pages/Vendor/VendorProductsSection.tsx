// Pages/Vendor/VendorProductsSection.jsx
// Full product management: CRUD, search, filter, edit/delete
import { useState, useRef } from 'react';
import { FaTimes, FaImage, FaPlus, FaTrash, FaSpinner, FaCheckCircle, FaClock, FaEdit, FaSearch, FaFilter, FaBox } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useUploadImageMutation } from '../../slices/uploadApiSlice';
import { resolveImageUrl } from '../../utils/imageUrl';
import {
  useGetMyVendorProductsQuery,
  useCreateVendorProductMutation,
  useUpdateVendorProductMutation,
  useDeleteVendorProductMutation,
} from '../../slices/vendorsApiSlice';
import { useGetCategoriesQuery } from '../../slices/categoriesApiSlice';
import type { Product } from '../../types/domain';

interface ProductForm {
  title: string;
  price: string;
  category: string;
  description: string;
  tag: string;
  material: string;
  productionTime: string;
  printType: string;
  isCustomizable: boolean;
  isRentable: boolean;
  madeToOrder: boolean;
  rentPricePerDay: string;
  colors: string;
  sizes: string;
  threadTypes: string;
  dominantThread: string;
}

const emptyForm: ProductForm = {
  title: '',
  price: '',
  category: '',
  description: '',
  tag: '',
  material: '',
  productionTime: '',
  printType: '',
  isCustomizable: false,
  isRentable: false,
  madeToOrder: false,
  rentPricePerDay: '',
  colors: '',
  sizes: '',
  threadTypes: '',
  dominantThread: '',
};

const VendorProductsSection = ({ vendorStatus }: { vendorStatus?: string }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [image, setImage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: products = [], isLoading: productsLoading } = useGetMyVendorProductsQuery();
  const [createProduct, { isLoading: creating }] = useCreateVendorProductMutation();
  const [updateProduct, { isLoading: updating }] = useUpdateVendorProductMutation();
  const [deleteProduct, { isLoading: deleting }] = useDeleteVendorProductMutation();
  const [uploadImage, { isLoading: uploading }] = useUploadImageMutation();
  const { data: categoriesData = [] } = useGetCategoriesQuery();
  const CATEGORIES = categoriesData.map((c) => c.name);

  const approved = vendorStatus === 'approved';

  const filteredProducts = products.filter((p) => {
    const matchesSearch = !searchTerm || p.title?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = !filterCategory || p.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }) as ProductForm);
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setImage(reader.result as string);
    reader.readAsDataURL(file);

    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await uploadImage(fd).unwrap();
      setImage(res.image as string);
      toast.success('Image uploaded');
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      const msg = err?.data?.message || 'Failed to upload image';
      toast.error(msg);
      setImage('');
    }
  };

  const resetForm = () => {
    setForm(emptyForm);
    setImage('');
    setEditingProduct(null);
    setShowForm(false);
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setForm({
      title: product.title || '',
      price: String(product.price || ''),
      category: product.category || '',
      description: product.description || '',
      tag: (product.tag as string) || '',
      material: product.material || '',
      productionTime: product.productionTime || '',
      printType: (product.printType as string) || '',
      isCustomizable: product.isCustomizable ? true : false,
      isRentable: product.isRentable ? true : false,
      madeToOrder: product.madeToOrder ? true : false,
      rentPricePerDay: product.rentPricePerDay != null ? String(product.rentPricePerDay) : '',
      colors: Array.isArray(product.colors) ? product.colors.join(', ') : '',
      sizes: Array.isArray(product.sizes) ? product.sizes.join(', ') : '',
      threadTypes: Array.isArray(product.threadTypes) ? product.threadTypes.join(', ') : '',
      dominantThread: (product.dominantThread as string) || '',
    });
    setImage(product.img || '');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Product title is required');
    if (!form.price || isNaN(Number(form.price))) return toast.error('Valid price is required');
    if (!form.category) return toast.error('Please select a category');
    if (!image) return toast.error('Please upload a product image');

    const parsedYards = form.sizes
      ? form.sizes.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    if (parsedYards.some((yd) => Number(yd) <= 0 || Number(yd) % 2 !== 0)) {
      return toast.error('Available yards must be even numbers (e.g. 2, 4, 6, 8, 10, 12)');
    }

    const parsedThreads = form.threadTypes
      ? form.threadTypes.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const payload = {
      title: form.title.trim(),
      img: image,
      price: parseFloat(form.price),
      category: form.category,
      tags: form.tag.trim() || null,
      description: form.description.trim() || null,
      material: form.material.trim() || null,
      printType: form.printType.trim() || null,
      productionTime: form.productionTime ? parseInt(form.productionTime, 10) : null,
      isCustomizable: form.isCustomizable,
      madeToOrder: form.madeToOrder,
      isRentable: form.isRentable,
      rentPricePerDay: form.isRentable && form.rentPricePerDay ? parseFloat(form.rentPricePerDay) : null,
      colors: form.colors ? form.colors.split(',').map((c) => c.trim()).filter(Boolean) : [],
      sizes: parsedYards,
      yards: parsedYards[0] || null,
      threadTypes: parsedThreads,
      dominantThread: form.dominantThread.trim() || null,
    };

    try {
      if (editingProduct) {
        await updateProduct({ id: editingProduct.id, ...payload }).unwrap();
        toast.success('Product updated');
      } else {
        await createProduct(payload).unwrap();
        toast.success('Product added');
      }
      resetForm();
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || 'Failed to save product');
    }
  };

  const handleDelete = async (id: number | string) => {
    try {
      await deleteProduct(id).unwrap();
      toast.success('Product deleted');
      setDeleteConfirm(null);
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || 'Failed to delete product');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Products</h2>
        {approved && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90"
          >
            <FaPlus /> Add Product
          </button>
        )}
      </div>

      {!approved && (
        <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <FaClock className="text-amber-500" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            You can add products once your seller application is approved.
          </p>
        </div>
      )}

      {/* Search & Filter */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Product Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {editingProduct ? 'Edit Product' : 'Add New Product'}
                </h3>
                <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                  <FaTimes className="text-xl" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Image upload */}
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Product image *</label>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg h-44 flex items-center justify-center cursor-pointer hover:border-primary transition-colors overflow-hidden"
                  >
                    {image ? (
                      <img src={image} alt="preview" className="w-full h-full object-cover" />
                    ) : uploading ? (
                      <FaSpinner className="animate-spin text-2xl text-primary" />
                    ) : (
                      <div className="text-center text-gray-400">
                        <FaImage className="text-4xl mx-auto mb-2" />
                        <p className="text-sm">Click to upload image (max 5MB)</p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Title *</label>
                  <input name="title" value={form.title} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="e.g. Handwoven Kente Stole" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Price (GH₵) *</label>
                    <input name="price" type="number" step="0.01" value={form.price} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Category *</label>
                    <select name="category" value={form.category} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
                      <option value="">Select category</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Description</label>
                  <textarea name="description" rows={3} value={form.description} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="Describe your product" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Tag</label>
                    <input name="tag" value={form.tag} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="e.g. Limited Offer" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Material</label>
                    <input name="material" value={form.material} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="e.g. Cotton" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Production time (days)</label>
                    <input name="productionTime" type="number" value={form.productionTime} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="3" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Colors used (comma separated)</label>
                    <input name="colors" value={form.colors} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="e.g. Black, Gold, Red" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Available yards (comma separated, even numbers)</label>
                    <input name="sizes" value={form.sizes} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="e.g. 2, 4, 6, 8, 10, 12" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Thread types (comma separated)</label>
                    <input name="threadTypes" value={form.threadTypes} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="e.g. Cotton, Rayon, Silk" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Dominant thread</label>
                    <input name="dominantThread" value={form.dominantThread} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" placeholder="e.g. Cotton" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 pt-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" name="isCustomizable" checked={form.isCustomizable} onChange={handleChange} className="w-4 h-4" />
                    Customizable
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" name="madeToOrder" checked={form.madeToOrder} onChange={handleChange} className="w-4 h-4" />
                    Made to order
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" name="isRentable" checked={form.isRentable} onChange={handleChange} className="w-4 h-4" />
                    Rentable
                  </label>
                  {form.isRentable && (
                    <div className="flex items-center gap-2">
                      <input
                        name="rentPricePerDay"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.rentPricePerDay}
                        onChange={handleChange}
                        placeholder="Rent per day (GH₵)"
                        className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
                      />
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button type="button" onClick={resetForm} className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                    Cancel
                  </button>
                  <button type="submit" disabled={creating || updating} className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-60">
                    {(creating || updating) ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
                    {editingProduct ? 'Update Product' : 'Add Product'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Product Grid */}
      {productsLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Loading your products...</p>
      ) : filteredProducts.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
          <FaBox className="text-4xl text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">
            {products.length === 0 ? 'No products yet. Click "Add Product" to get started.' : 'No products match your search.'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 text-left text-gray-500 dark:text-gray-400">
                  <th className="px-6 py-3">Product</th>
                  <th className="px-6 py-3">Category</th>
                  <th className="px-6 py-3">Price</th>
                  <th className="px-6 py-3">Rating</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {p.img ? (
                          <img src={resolveImageUrl(p.img)} alt={p.title} className="w-12 h-12 rounded-lg object-cover" />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400">
                            <FaImage />
                          </div>
                        )}
                        <span className="font-medium text-gray-900 dark:text-white">{p.title}</span>
                        {(p.isRentable || p.madeToOrder) && (
                          <span className="inline-flex gap-1 ml-1">
                            {p.isRentable && (
                              <span className="text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 px-1.5 py-0.5 rounded-full">Rent</span>
                            )}
                            {p.madeToOrder && (
                              <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded-full">Made to order</span>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{p.category || '-'}</td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-primary">GH₵{parseFloat(String(p.price || 0)).toFixed(2)}</span>
                      {p.isRentable && p.rentPricePerDay && (
                        <span className="block text-xs text-gray-500 dark:text-gray-400">or GH₵{parseFloat(String(p.rentPricePerDay)).toFixed(2)}/day rent</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{p.rating ? `${p.rating} ⭐` : '-'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEdit(p)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg" title="Edit">
                          <FaEdit />
                        </button>
                        <button onClick={() => setDeleteConfirm(p)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg" title="Delete">
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Delete Product</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete "{deleteConfirm.title}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancel
              </button>
              <button onClick={() => handleDelete(deleteConfirm.id)} disabled={deleting} className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60">
                {deleting ? <FaSpinner className="animate-spin" /> : <FaTrash />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorProductsSection;
