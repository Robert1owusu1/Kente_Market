// Pages/Museum/KenteMuseum.jsx
// Kente Museum: cultural showcase of approved Kente patterns and their
// meanings, drawing from the products' provenance metadata.
import { Link } from 'react-router-dom';
import { FaSpinner, FaLandmark, FaEye, FaHeart } from 'react-icons/fa';
import { useGetMuseumPiecesQuery } from '../../slices/marketplaceApiSlice';
import { resolveImageUrl } from '../../utils/imageUrl';
import Seo from '../../components/Seo/Seo';

const KenteMuseum = () => {
  const { data: pieces = [], isLoading, isError } = useGetMuseumPiecesQuery();

  return (
    <>
      <Seo
        title="The Kente Museum - Kente Patterns, Meanings & Heritage | Bonwire Kente"
        description="Explore the Kente Museum — the patterns, names and cultural meanings behind authentic Ghanaian Kente designs, woven by approved artisans."
        image="https://kente-market.vercel.app/og-cover.png"
      />
    <div className="min-h-[60vh] bg-gray-50 dark:bg-gray-900 py-12">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 mb-5">
            <FaLandmark className="text-3xl text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">The Kente Museum</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Every Kente design tells a story. Explore the patterns of our approved artisans — their names,
            meanings and the cultural heritage they carry.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <FaSpinner className="animate-spin h-10 w-10 text-primary" />
          </div>
        )}

        {isError && (
          <div className="max-w-lg mx-auto bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-red-600 dark:text-red-400 text-center">
            Failed to load the museum collection.
          </div>
        )}

        {!isLoading && !isError && pieces.length === 0 && (
          <div className="max-w-lg mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
            <p>The museum collection is being curated. Check back soon.</p>
          </div>
        )}

        {pieces.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pieces.map((p) => (
              <div key={p.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-lg transition-all overflow-hidden">
                <div className="h-48 bg-gradient-to-br from-amber-400 via-amber-600 to-orange-600 flex items-center justify-center">
                  {p.img ? (
                    <img src={resolveImageUrl(p.img)} alt={p.patternName || p.title} className="w-full h-full object-cover" />
                  ) : (
                    <FaLandmark className="text-5xl text-white/70" />
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      {p.patternName || p.title}
                    </span>
                    {p.origin && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">{p.origin}</span>
                    )}
                  </div>
                  <h2 className="font-bold text-gray-900 dark:text-white mb-2">{p.title}</h2>
                  {p.patternMeaning && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 italic line-clamp-3 mb-3">
                      “{p.patternMeaning}”
                    </p>
                  )}
                  {p.culturalSignificance && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3">{p.culturalSignificance}</p>
                  )}
                  <div className="mt-4 pt-3 border-t dark:border-gray-700 flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">
                      {p.vendorBusinessName || 'Approved artisan'}
                    </span>
                    <Link
                      to={`/product/${p.id}`}
                      className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold hover:underline"
                    >
                      <FaEye /> View piece
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-12 text-center bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 max-w-3xl mx-auto">
          <FaHeart className="mx-auto text-3xl text-amber-500 mb-3" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Own a piece of living heritage</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-5">
            Every certified Kente piece comes with an authenticity certificate tracing its weaver, workshop and pattern.
          </p>
          <Link
            to="/products"
            className="inline-block px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold"
          >
            Browse the collection
          </Link>
        </div>
      </div>
    </div>
    </>
  );
};

export default KenteMuseum;