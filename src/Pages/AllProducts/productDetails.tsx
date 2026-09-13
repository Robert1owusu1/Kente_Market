import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useCart } from "../../Context/CartContext";
import { useGetProductsDetailsQuery } from "../../slices/productsApiSlice";
import { FaShoppingCart, FaChevronLeft, FaStore, FaCheckCircle, FaMagic, FaEnvelope, FaExclamationTriangle, FaStar, FaTags } from "react-icons/fa";
import ProductReviews from "../../components/reviews/ProductReviews";
import SocialShare from "../../components/SocialShare/SocialShare";
import { resolveImageUrl } from "../../utils/imageUrl";
import Seo from "../../components/Seo/Seo";
import { useSelector } from "react-redux";
import type { RootState } from "../../store";
import AskModal from "../../components/Messages/AskModal";

const ProductDetails = () => {
  const { id: productId } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const userInfo = useSelector((state: RootState) => state.auth?.userInfo);

  const { data: product, isLoading, error } = useGetProductsDetailsQuery(Number(productId!));
  const apiError = error as { data?: { message?: string }; error?: string } | undefined;

  // ✅ Local states (sync with product once it loads)
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedYards, setSelectedYards] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [showAsk, setShowAsk] = useState(false);

  useEffect(() => {
    if (product) {
      const colors = product.colors || product.colorsAvailable || [];
      const yardsOptions = (product.yardsAvailable as string[] | undefined) || product.sizes || [];
      setSelectedColor(colors[0] || "default");
      setSelectedYards(yardsOptions[0] || "2");
      setQuantity(1);
    }
  }, [product]);

  if (isLoading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary"></div>
      </div>
    );
  if (error)
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <p className="text-red-500">{apiError?.data?.message || apiError?.error || "Failed to load product"}</p>
      </div>
    );
  if (!product)
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <p className="text-gray-500">Product not found.</p>
      </div>
    );

  const handleAddToCart = () => {
    addToCart({
      ...product,
      selectedColor,
      yards: selectedYards,
      yardsAvailable: (product.yardsAvailable as string[] | undefined) || product.sizes || [],
      threadTypes: product.threadTypes,
      dominantThread: product.dominantThread,
      quantity,
    });
    // Optionally navigate to cart or open drawer
  };

  const colors = product.colors || product.colorsAvailable || [];
  const yardsOptions = (product.yardsAvailable as string[] | undefined) || product.sizes || [];

  // Honest stock signal: 0 => sold out, low threshold => "almost gone".
  const stockRaw = product.in_stock ?? product.stock;
  const stockLevel = stockRaw === undefined || stockRaw === null ? Number.MAX_SAFE_INTEGER : Number(stockRaw) || 0;
  const isOutOfStock = stockLevel <= 0;
  const isLowStock = !isOutOfStock && stockLevel <= 5;
  const canAsk = Boolean(userInfo) && Boolean(product.vendorId) && userInfo?.id !== product.vendorId;

  const productJsonLd = product
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.title,
        description: (product.description || product.title || '').slice(0, 300),
        image: resolveImageUrl(product.img),
        sku: `BK-${product.id}`,
        brand: {
          '@type': 'Brand',
          name: product.vendorBusinessName || 'Bonwire Kente',
        },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'GHS',
          price: String(product.price || 0),
          availability: 'https://schema.org/InStock',
          url: `https://kente-market.vercel.app/product/${product.id}`,
        },
      }
    : undefined;

  return (
    <>
      <Seo
        title={`${product.title} | Bonwire Kente`}
        description={`${(product.description || product.title || '').slice(0, 160)} — Buy authentic Ghanaian Kente online.`}
        url={`https://kente-market.vercel.app/product/${product.id}`}
        image={resolveImageUrl(product.img)}
        type="product"
        jsonLd={productJsonLd}
      />
    <div className="max-w-6xl mx-auto py-6 px-4 sm:py-10 sm:px-6">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center space-x-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors duration-200 mb-6"
      >
        <FaChevronLeft />
        <span>Back to Products</span>
      </button>

      {/* Product card */}
      <div className="grid md:grid-cols-2 gap-6 sm:gap-10 bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-lg">
        {/* Image */}
        <div className="flex justify-center items-center bg-gray-50 dark:bg-gray-700/40 rounded-xl overflow-hidden">
          <img
            src={resolveImageUrl(product.img)}
            alt={product.title}
            decoding="async"
            className="w-full h-72 sm:h-96 object-cover"
            onError={(e) => { const target = e.target as HTMLImageElement; target.onerror = null; target.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect fill="#f4eee1" width="400" height="400"/><text x="200" y="205" font-family="sans-serif" font-size="20" fill="#8a6d3b" text-anchor="middle">Kente image coming soon</text></svg>'); }}
          />
        </div>

        {/* Info */}
        <div className="flex flex-col justify-center">
          <h1 className="text-2xl sm:text-3xl font-bold mb-4">{product.title}</h1>

          {product.vendorBusinessName && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <FaStore className="text-primary" />
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Sold by <span className="font-semibold text-gray-800 dark:text-white">{product.vendorBusinessName}</span>
              </span>
              {product.vendorStatus === 'approved' && (
                <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                  <FaCheckCircle /> Verified
                </span>
              )}

              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                {Number(product.verifiedReviewCount) > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                    <FaStar /> {product.verifiedReviewCount} verified order{Number(product.verifiedReviewCount) === 1 ? '' : 's'}
                  </span>
                )}
                {product.isRentable && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 rounded-full px-3 py-1">
                    <FaTags /> Rentable
                    {product.rentPricePerDay ? ` — from GH₵${product.rentPricePerDay}/day` : ''}
                  </span>
                )}
                {product.madeToOrder && !isOutOfStock && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-full px-3 py-1">
                    Made to order{product.productionTime ? ` — ships in ${product.productionTime}` : ''}
                  </span>
                )}
              </div>

              {canAsk && (
                <button
                  onClick={() => setShowAsk(true)}
                  className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded-full px-3 py-1 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition"
                  aria-label="Ask the weaver a question"
                >
                  <FaEnvelope /> Ask the weaver
                </button>
              )}
            </div>
          )}

          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 mb-2">
            {product.description || "No description available."}
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <p className="text-2xl font-semibold text-primary">GH₵{product.price}</p>
            {isOutOfStock ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-full px-3 py-1">
                <FaExclamationTriangle /> Sold out
              </span>
            ) : isLowStock ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-full px-3 py-1">
                <FaExclamationTriangle /> Only {stockLevel} left
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-full px-3 py-1">
                <FaCheckCircle /> In stock
              </span>
            )}
          </div>

          {/* Social Share */}
          <div className="mb-4">
            <SocialShare url={window.location.href} title={product.title} />
          </div>

          {/* Color selector */}
          {colors.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Color:</label>
              <div className="flex flex-wrap gap-3" role="group" aria-label="Color selection">
                {colors.map((color, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedColor(color)}
                    className={`relative w-10 h-10 rounded-full border-4 transition-all duration-200 hover:scale-110 ${
                      selectedColor === color ? "border-primary shadow-lg" : "border-gray-200 dark:border-gray-600"
                    }`}
                    style={{ backgroundColor: color.toLowerCase() }}
                    title={color}
                    aria-label={`Color ${color}`}
                    aria-pressed={selectedColor === color}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Yards selector */}
          {yardsOptions.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Yards:</label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Kente is measured in yards (even numbers).</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Yards selection">
                {yardsOptions.map((yd, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedYards(String(yd))}
                    className={`px-4 py-2 rounded-lg border-2 transition-all duration-200 ${
                      selectedYards === String(yd)
                        ? "border-primary bg-primary text-white"
                        : "border-gray-300 dark:border-gray-600 text-gray-800 dark:text-white hover:border-primary"
                    }`}
                    aria-label={`${yd} yards`}
                    aria-pressed={selectedYards === String(yd)}
                  >
                    {yd}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Thread composition */}
          {((product.threadTypes && product.threadTypes.length > 0) || product.dominantThread) && (
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Thread:</label>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {product.threadTypes?.length ? product.threadTypes.join(", ") : "Traditional cotton"}{" "}
                {product.dominantThread && (
                  <span className="text-primary font-medium">— {product.dominantThread} dominates</span>
                )}
              </p>
            </div>
          )}

          {/* Quantity selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Quantity:</label>
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg w-fit">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-4 py-2 text-xl hover:bg-gray-200 dark:hover:bg-gray-600 rounded-l-lg disabled:opacity-40"
                aria-label="Decrease quantity"
                disabled={isOutOfStock}
              >
                −
              </button>
              <span className="w-12 text-center font-bold">{isOutOfStock ? 0 : quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(quantity + 1, isLowStock ? stockLevel : quantity + 1))}
                className="px-4 py-2 text-xl hover:bg-gray-200 dark:hover:bg-gray-600 rounded-r-lg disabled:opacity-40"
                aria-label="Increase quantity"
                disabled={isOutOfStock || (isLowStock && quantity >= stockLevel)}
              >
                +
              </button>
            </div>
            {isLowStock && !isOutOfStock && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                Only {stockLevel} available — we'll tell you honestly before you pay.
              </p>
            )}
            {isOutOfStock && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1.5">
                This piece is currently sold out. Ask the weaver (above) whether more yards are being woven.
              </p>
            )}
          </div>

          {/* Try It On + Add to cart */}
          <div className="flex flex-col xs:flex-row gap-3 sm:gap-4">
            <button
              onClick={() => navigate(`/ai-tryon?product=${product.id}`)}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl shadow-md hover:shadow-lg transition font-semibold"
            >
              ✨ Try It On
            </button>
            <button
              onClick={handleAddToCart}
              disabled={isOutOfStock}
              title={isOutOfStock ? 'This piece is sold out' : ''}
              className="flex-1 px-6 py-3 bg-gray-800 dark:bg-gray-100 dark:text-gray-800 text-white rounded-xl shadow-md hover:bg-gray-700 transition flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-800"
            >
              <FaShoppingCart />
              {isOutOfStock ? 'Sold out' : 'Add to Cart'}
            </button>
          </div>

          {product.isCustomizable && (
            <button
              onClick={() => navigate(`/customize/${product.id}`)}
              className="w-full mt-3 px-6 py-3 border-2 border-primary text-primary dark:text-amber-300 rounded-xl font-semibold hover:bg-primary hover:text-white transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FaMagic />
              Customize This Kente (Choose Colours, Thread & Yards)
            </button>
          )}
        </div>
      </div>

      {/* Reusable review section */}
      <div className="mt-10">
        <ProductReviews productId={product.id} />
      </div>
    </div>

    {showAsk && (
      <AskModal
        vendorId={product.vendorId}
        vendorName={product.vendorBusinessName}
        productId={product.id}
        onClose={() => setShowAsk(false)}
      />
    )}
    </>
  );
};

export default ProductDetails;
