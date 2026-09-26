// Pages/Storefront/VendorStorefront.jsx
// Public single-vendor storefront with Kente provenance details + direct enquiry.
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FaStar, FaMapMarkerAlt, FaSpinner, FaAward, FaMedal, FaEnvelope,
  FaBoxOpen, FaLayerGroup, FaLeaf, FaLandmark, FaStore,
  FaCheckCircle, FaVideo, FaReplyAll,
} from 'react-icons/fa';
import { resolveImageUrl } from '../../utils/imageUrl';
import Seo from '../../components/Seo/Seo';
import { useGetStorefrontQuery } from '../../slices/marketplaceApiSlice';
import { useGetVendorFulfilmentQuery } from '../../slices/vendorsApiSlice';
import { formatCedi } from '../../utils/formatCurrency';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import type { Product } from '../../types/domain';
import AskModal from '../../components/Messages/AskModal';

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
  weaverVideo?: string;
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
  verifiedReviewCount?: number | string;
  avgResponseHours?: number | string;
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

// Honest stock labelling reused by product cards below.
const stockOf = (p: Product): number => {
  const raw = p.in_stock ?? p.stock;
  if (raw === undefined || raw === null) return Number.MAX_SAFE_INTEGER;
  return Number(raw) || 0;
};

// Vendor bio video — YouTube embeds or a plain mp4 player.
const videoEmbedUrl = (url?: string): string | null => {
  if (!url) return null;
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/
  );
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
};

// Human response-time label for the "replies within ~X" SLA badge.
const responseLabel = (hours?: number | string): string | null => {
  const h = Number(hours);
  if (!(h > 0) || !Number.isFinite(h)) return null;
  if (h < 1) return '~1h';
  if (h < 24) return `~${Math.ceil(h)}h`;
  const days = h / 24;
  return days < 7 ? `~${Math.round(days)}d` : `${Math.round(days / 7)}w`;
};

const VendorStorefront = () => {
  const { slug } = useParams();
  const [showMessage, setShowMessage] = useState(false);
  const { data, isLoading, isError } = useGetStorefrontQuery(slug ?? '');
  const userInfo = useSelector((state: RootState) => state.auth?.userInfo);
  const vendorIdForScore = (data as unknown as StorefrontView | undefined)?.vendor?.userId;
  const { data: fulfilment, isLoading: fulfilmentLoading } = useGetVendorFulfilmentQuery(
    vendorIdForScore ?? 0,
    { skip: !vendorIdForScore },
  );

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
    <>
      <Seo
        title={`${vendor.businessName || 'Kente Store'} | Authentic Kente on Bonwire`}
        description={`Shop authentic Ghanaian Kente cloth, fabric and accessories from ${vendor.businessName || 'a verified vendor'} on Bonwire Kente Marketplace.`}
        url={`https://kente-market.vercel.app/store/${slug}`}
        image={vendor.logo || vendor.coverImage || 'https://kente-market.vercel.app/og-cover.png'}
        type="profile"
      />
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
                    {Number(viewData.verifiedReviewCount) > 0 && (
                      <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                        • {viewData.verifiedReviewCount} verified order{Number(viewData.verifiedReviewCount) === 1 ? '' : 's'}
                      </span>
                    )}
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
            {!fulfilmentLoading && fulfilment && fulfilment.withDeadline > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
                <FaCheckCircle /> Delivers on time {Math.round(Number(fulfilment.onTimeRate || 0))}%
              </span>
            )}
            {responseLabel(viewData.avgResponseHours) && (
              <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
                <FaReplyAll /> Replies within {responseLabel(viewData.avgResponseHours)}
              </span>
            )}
          </div>

          {vendor.weaverVideo && (
            <div className="mt-5">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                <FaVideo /> Watch the weaver at work
              </h3>
              {videoEmbedUrl(vendor.weaverVideo) ? (
                <iframe
                  src={videoEmbedUrl(vendor.weaverVideo) ?? undefined}
                  title={`Weaving demonstration by ${vendor.businessName}`}
                  className="w-full max-w-2xl aspect-video rounded-xl"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <video src={vendor.weaverVideo} controls className="w-full max-w-2xl max-h-80 rounded-xl" />
              )}
            </div>
          )}
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
                  <div className="relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-700">
                    {p.img ? (
                      <img src={resolveImageUrl(p.img)} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <FaBoxOpen className="text-3xl" />
                      </div>
                    )}
                    {stockOf(p) <= 0 && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-white text-xs font-semibold bg-red-600 px-2 py-1 rounded-full">Sold out</span>
                      </div>
                    )}
                    {stockOf(p) > 0 && stockOf(p) <= 5 && (
                      <span className="absolute top-2 right-2 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/70 px-2 py-0.5 rounded-full">
                        Only {stockOf(p)} left
                      </span>
                    )}
                    {p.isRentable && (
                      <span className="absolute top-2 left-2 text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/70 px-2 py-0.5 rounded-full">
                        Rentable
                      </span>
                    )}
                    {p.madeToOrder && stockOf(p) > 0 && (
                      <span className="absolute bottom-2 left-2 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/70 px-2 py-0.5 rounded-full">
                        Made to order
                      </span>
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

      {showMessage && (
        <AskModal
          vendorId={vendor.userId}
          vendorName={vendor.businessName}
          onClose={() => setShowMessage(false)}
        />
      )}
    </div>
    </>
  );
};

export default VendorStorefront;