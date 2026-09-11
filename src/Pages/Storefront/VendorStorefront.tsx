// Pages/Storefront/VendorStorefront.jsx
// Public single-vendor storefront with Kente provenance details + direct enquiry.
import { useState } from 'react';
import type React from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FaStar, FaMapMarkerAlt, FaSpinner, FaAward, FaMedal, FaEnvelope,
  FaTimes, FaBoxOpen, FaLayerGroup, FaLeaf, FaLandmark, FaStore,
} from 'react-icons/fa';
import { toast } from 'react-toastify';
import { resolveImageUrl } from '../../utils/imageUrl';
import { useGetStorefrontQuery, useSendVendorMessageMutation } from '../../slices/marketplaceApiSlice';
import { formatCedi } from '../../utils/formatCurrency';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import type { Product } from '../../types/domain';

interface VendorView {
  id?: number | string;
  userId?: number | string;
  businessName?: string;
  logo?: string;
  coverImage?: string;
  location?: string;
  verificationLevel?: string;
  badges?: string[];
  businessDescription?: string;
  weaverStory?: string;
  yearsExperience?: number | string;
  workshop?: string;
  [key: string]: unknown;
}

interface StorefrontView {
  vendor?: VendorView;
  products?: Product[];
  rating?: number | string;
  reviewCount?: number | string;
  productCount?: number | string;
  [key: string]: unknown;
}

const levelMeta = {
  pending: { label: 'Pending', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  verified: { label: 'Verified', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  trusted_artisan: { label: 'Trusted Artisan', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  master_weaver: { label: 'Master Weaver', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
} as const;

const badgeLabels = {
  top_weaver: 'Top Weaver',
  verified_vendor: 'Verified',
  best_seller: 'Best Seller',
  international_seller: 'International',
  five_star_vendor: '5-Star Vendor',
  master_artisan: 'Master Artisan',
} as const;

const MessageModal = ({ vendor, userId, onClose }: {
  vendor: VendorView;
  userId?: number | string;
  onClose: () => void;
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [productId] = useState('');
  const [sendMessage, { isLoading }] = useSendVendorMessageMutation();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and message are required');
      return;
    }
    try {
      await sendMessage({
        vendorId: userId,
        productId: productId ? parseInt(productId) : undefined,
        subject: subject.trim(),
        body: body.trim(),
      }).unwrap();
      toast.success('Message sent to store');
      onClose();
    } catch (err) {
      const apiErr = err as { data?: { message?: string }; message?: string; error?: string } | undefined;
      toast.error(apiErr?.data?.message || 'Failed to send message');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Message {vendor.businessName}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <FaTimes />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={255}
              placeholder="e.g. Custom order in blue & gold"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              rows={4}
              placeholder="Tell the weaver what you are looking for..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isLoading ? <FaSpinner className="animate-spin" /> : <FaEnvelope />} Send Enquiry
          </button>
        </form>
      </div>
    </div>
  );
};

const VendorStorefront = () => {
  const { slug } = useParams();
  const [showMessage, setShowMessage] = useState(false);
  const { data, isLoading, isError } = useGetStorefrontQuery(slug ?? '');
  const userInfo = useSelector((state: RootState) => state.auth?.userInfo);

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <FaSpinner className="animate-spin h-10 w-10 text-primary" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <FaStore className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-6" />
        <h1 className="text-2xl font-bold mb-2">Store not found</h1>
        <p className="text-gray-600 dark:text-gray-400">This store may have been suspended or the link is incorrect.</p>
        <Link to="/vendors" className="inline-block mt-6 text-amber-600 dark:text-amber-400 font-semibold">
          ← Browse all stores
        </Link>
      </div>
    );
  }

  const viewData = data as unknown as StorefrontView;
  const vendor = (viewData.vendor || {}) as VendorView;
  const products = (viewData.products || []) as Product[];
  const rating = viewData.rating;
  const reviewCount = viewData.reviewCount;
  const productCount = viewData.productCount;
  const canMessage = Boolean(userInfo) && userInfo?.id !== vendor.userId;

  return (
    <div className="min-h-[60vh] bg-gray-50 dark:bg-gray-900">
      {/* Cover */}
      <div className="h-48 md:h-64 bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 relative">
        {vendor.coverImage && (
          <img src={vendor.coverImage} alt={vendor.businessName} className="w-full h-full object-cover" />
        )}
      </div>

      <div className="container mx-auto px-4 -mt-16 relative z-10">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex items-start gap-4">
              {vendor.logo ? (
                <img
                  src={vendor.logo}
                  alt={vendor.businessName}
                  className="w-20 h-20 rounded-full object-cover border-4 border-white dark:border-gray-800 shadow-lg"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <FaStore className="text-3xl text-amber-600 dark:text-amber-400" />
                </div>
              )}
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">{vendor.businessName}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {vendor.verificationLevel && levelMeta[vendor.verificationLevel as keyof typeof levelMeta] && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${levelMeta[vendor.verificationLevel as keyof typeof levelMeta].cls}`}>
                      <FaAward /> {levelMeta[vendor.verificationLevel as keyof typeof levelMeta].label}
                    </span>
                  )}
                  {(vendor.badges || []).map((b) => (
                    <span key={b} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <FaMedal /> {badgeLabels[b as keyof typeof badgeLabels] || b}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1 text-sm text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                    <FaStar /> {rating} ({reviewCount} reviews)
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowMessage(true)}
              disabled={!canMessage}
              title={!canMessage ? 'Log in to message this store' : ''}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2"
            >
              <FaEnvelope /> Ask this store
            </button>
          </div>

          {vendor.location && (
            <p className="mt-4 flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
              <FaMapMarkerAlt /> {vendor.location}
            </p>
          )}

          {(vendor.businessDescription || vendor.weaverStory) && (
            <div className="mt-4 grid md:grid-cols-2 gap-6">
              {vendor.businessDescription && (
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2"><FaLayerGroup /> About the store</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm whitespace-pre-line">{vendor.businessDescription}</p>
                </div>
              )}
              {vendor.weaverStory && (
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2"><FaLeaf /> The weaver's story</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm whitespace-pre-line">{vendor.weaverStory}</p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-4 mt-5 pt-4 border-t dark:border-gray-700 text-sm">
            {vendor.yearsExperience ? (
              <span className="text-gray-600 dark:text-gray-400"><strong className="text-gray-900 dark:text-white">{vendor.yearsExperience} yrs</strong> experience</span>
            ) : null}
            {vendor.workshop && (
              <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400"><FaLandmark /> {vendor.workshop}</span>
            )}
          </div>
        </div>

        {/* Products */}
        <div className="mt-8 mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              Collection <span className="text-gray-400 font-medium">({productCount})</span>
            </h2>
            <Link
              to={`/products?vendor=${vendor.userId}`}
              className="text-amber-600 dark:text-amber-400 font-semibold text-sm"
            >
              View all →
            </Link>
          </div>

          {products.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
              <FaBoxOpen className="mx-auto text-4xl mb-4 opacity-50" />
              <p>No products listed yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
              {products.map((p) => (
                <Link
                  key={p.id}
                  to={`/product/${p.id}`}
                  className="group bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl transition-all overflow-hidden"
                >
                  <div className="aspect-square overflow-hidden bg-gray-100 dark:bg-gray-700">
                    {p.img ? (
                      <img src={resolveImageUrl(p.img)} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <FaBoxOpen className="text-3xl" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-white line-clamp-2">{p.title}</h3>
                    {p.patternName && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{p.patternName}</p>
                    )}
                    <p className="text-sm font-bold text-gray-900 dark:text-white mt-1.5">{formatCedi(p.price)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {showMessage && <MessageModal vendor={vendor} userId={vendor.userId} onClose={() => setShowMessage(false)} />}
    </div>
  );
};

export default VendorStorefront;