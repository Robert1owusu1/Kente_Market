import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useCart } from "../../Context/CartContext";
import { useGetProductsDetailsQuery } from "../../slices/productsApiSlice";
import { FaShoppingCart, FaChevronLeft } from "react-icons/fa";
import ProductReviews from "../../components/reviews/ProductReviews.jsx";

const ProductDetails = () => {
  const { id: productId } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();

  const { data: product, isLoading, error } = useGetProductsDetailsQuery(productId);

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
        <p className="text-red-500">{error?.data?.message || error.error || "Failed to load product"}</p>
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

  return (
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
            src={product.img}
            alt={product.title}
            decoding="async"
            className="w-full h-72 sm:h-96 object-cover"
            onError={(e) => { e.target.onerror = null; e.target.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect fill="#f4eee1" width="400" height="400"/><text x="200" y="205" font-family="sans-serif" font-size="20" fill="#8a6d3b" text-anchor="middle">Kente image coming soon</text></svg>'); }}
          />
        </div>

        {/* Info */}
        <div className="flex flex-col justify-center">
          <h1 className="text-2xl sm:text-3xl font-bold mb-4">{product.title}</h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 mb-6">
            {product.description || "No description available."}
          </p>
          <p className="text-2xl font-semibold text-primary mb-6">GH₵{product.price}</p>

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
        <ProductReviews productId={product.id} productTitle={product.title} />
      </div>
    </div>
  );
};

export default ProductDetails;
