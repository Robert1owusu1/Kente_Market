import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useCart } from "../../Context/CartContext";
import { useGetProductsDetailsQuery } from "../../slices/productsApiSlice";
import { FaShoppingCart, FaChevronLeft, FaStore, FaCheckCircle } from "react-icons/fa";
import ProductReviews from "../../components/reviews/ProductReviews";
import SocialShare from "../../components/SocialShare/SocialShare";
import { resolveImageUrl } from "../../utils/imageUrl";
import Seo from "../../components/Seo/Seo";

const ProductDetails = () => {
  const { id: productId } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();

  const { data: product, isLoading, error } = useGetProductsDetailsQuery(Number(productId!));
  const apiError = error as { data?: { message?: string }; error?: string } | undefined;

  // ✅ Local states (sync with product once it loads)
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (product) {
      const colors = product.colors || product.colorsAvailable || [];
      const sizes = product.sizes || [];
      setSelectedColor(colors[0] || "default");
      setSelectedSize(sizes[0] || "M");
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
      selectedSize,
      quantity,
    });
    // Optionally navigate to cart or open drawer
  };

  const colors = product.colors || product.colorsAvailable || [];
  const sizes = product.sizes || [];

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
            <div className="flex items-center gap-2 mb-4">
              <FaStore className="text-primary" />
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Sold by <span className="font-semibold text-gray-800 dark:text-white">{product.vendorBusinessName}</span>
              </span>
              {product.vendorStatus === 'approved' && (
                <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                  <FaCheckCircle /> Verified
                </span>
              )}
            </div>
          )}

          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 mb-6">
            {product.description || "No description available."}
          </p>
          <p className="text-2xl font-semibold text-primary mb-6">GH₵{product.price}</p>

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

          {/* Size selector */}
          {sizes.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Size:</label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Size selection">
                {sizes.map((size, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedSize(size)}
                    className={`px-4 py-2 rounded-lg border-2 transition-all duration-200 ${
                      selectedSize === size
                        ? "border-primary bg-primary text-white"
                        : "border-gray-300 dark:border-gray-600 text-gray-800 dark:text-white hover:border-primary"
                    }`}
                    aria-label={`Size ${size}`}
                    aria-pressed={selectedSize === size}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Quantity:</label>
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg w-fit">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-4 py-2 text-xl hover:bg-gray-200 dark:hover:bg-gray-600 rounded-l-lg"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="w-12 text-center font-bold">{quantity}</span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="px-4 py-2 text-xl hover:bg-gray-200 dark:hover:bg-gray-600 rounded-r-lg"
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
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
              className="flex-1 px-6 py-3 bg-gray-800 dark:bg-gray-100 dark:text-gray-800 text-white rounded-xl shadow-md hover:bg-gray-700 transition flex items-center justify-center gap-2"
            >
              <FaShoppingCart />
              Add to Cart
            </button>
          </div>
        </div>
      </div>

      {/* Reusable review section */}
      <div className="mt-10">
        <ProductReviews productId={product.id} />
      </div>
    </div>
    </>
  );
};

export default ProductDetails;
