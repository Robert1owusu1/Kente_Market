// Pages/Storefront/VendorDirectory.jsx
// Public directory of approved vendors (marketplace browse).
import { Link } from 'react-router-dom';
import { FaStore, FaStar, FaMapMarkerAlt, FaSpinner, FaBoxOpen, FaAward, FaMedal } from 'react-icons/fa';
import { useGetVendorDirectoryQuery } from '../../slices/marketplaceApiSlice';
import Seo from '../../components/Seo/Seo';

interface VendorView {
  id?: number | string;
  slug?: string;
  coverImage?: string;
  logo?: string;
  businessName?: string;
  location?: string;
  rating?: number | string;
  verificationLevel?: string;
  badges?: string[];
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

const VendorDirectory = () => {
  const { data: rawVendors = [], isLoading, isError } = useGetVendorDirectoryQuery();
  const vendors = (rawVendors as unknown as VendorView[]);

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <FaSpinner className="animate-spin h-10 w-10 text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load vendors.</p>
      </div>
    );
  }

  return (
    <>
      <Seo
        title="Browse Kente Vendors & Weavers in Ghana | Bonwire Kente"
        description="Find verified Kente weavers, cloth sellers and fashion artisans across Ghana. Browse their stores, reviews and collections."
        image="https://kente-market.vercel.app/og-cover.png"
      />
    <div className="min-h-[60vh] bg-gray-50 dark:bg-gray-900 py-12">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12 max-w-2xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">Our Artisan Stores</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Every storefront is owned by a verified Kente weaver or artisan. Message them directly, or browse their collection.
          </p>
        </div>

        {vendors.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl shadow-md">
            <FaStore className="mx-auto text-5xl text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-600 dark:text-gray-400">No artisan stores yet — check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {vendors.map((v) => (
              <Link
                key={v.id}
                to={`/store/${v.slug || v.id}`}
                className="group bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl transition-all overflow-hidden"
              >
                <div className="h-28 bg-gradient-to-r from-amber-500 to-amber-700 relative">
                  {v.coverImage && (
                    <img
                      src={v.coverImage}
                      alt={v.businessName}
                      className="w-full h-full object-cover"
                    />
                  )}
                  {v.logo && (
                    <img
                      src={v.logo}
                      alt={v.businessName}
                      className="absolute -bottom-6 left-5 w-16 h-16 rounded-full object-cover border-4 border-white dark:border-gray-800 shadow"
                    />
                  )}
                </div>
                <div className="p-5 pt-8">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white group-hover:text-amber-600 transition-colors">
                        {v.businessName}
                      </h3>
                      {v.location && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-1">
                          <FaMapMarkerAlt /> {v.location}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-full">
                      <FaStar /> {v.rating || '0.0'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {v.verificationLevel && levelMeta[v.verificationLevel as keyof typeof levelMeta] ? (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${levelMeta[v.verificationLevel as keyof typeof levelMeta].cls}`}>
                        <FaAward /> {levelMeta[v.verificationLevel as keyof typeof levelMeta].label}
                      </span>
                    ) : null}
                    {(v.badges || []).slice(0, 2).map((b) => (
                      <span key={b} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        <FaMedal /> {badgeLabels[b as keyof typeof badgeLabels] || b}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-4 border-t dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <FaBoxOpen /> {v.productCount || 0} products
                    </span>
                    <span className="text-amber-600 dark:text-amber-400 font-medium">Visit store →</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
};

export default VendorDirectory;