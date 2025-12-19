import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { addToCart } from "../../slices/cartSlice";
import { useGetProductsDetailsQuery } from "../../slices/productsApiSlice";

const ProductDetails = () => {
  const { id: productId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { data: product, isLoading, error } = useGetProductsDetailsQuery(productId);

  // ✅ Local states
  const [selectedColor, setSelectedColor] = useState(product?.colors?.[0] || "default");
  const [selectedSize, setSelectedSize] = useState(product?.sizes?.[0] || "M");
  const [quantity, setQuantity] = useState(1);

  if (isLoading) return <p className="text-center text-gray-500">Loading product...</p>;
  if (error) return <p className="text-center text-red-500">{error?.data?.message || error.error}</p>;
  if (!product) return <p className="text-center text-gray-500">Product not found.</p>;

  const handleAddToCart = () => {
    dispatch(addToCart({
      ...product,
      selectedColor,
      selectedSize,
      quantity,
    }));
  };

  return (
    <div className="max-w-6xl mx-auto py-10 px-6">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center space-x-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors duration-200 mb-6"
      >
        <span className="text-lg">←</span>
        <span>Back to Products</span>
      </button>

      {/* Product card */}
      <div className="grid md:grid-cols-2 gap-10 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg">
        {/* Image */}
        <div className="flex justify-center items-center">
          <img
            src={product.img}
            alt={product.title}
            className="w-full h-96 object-cover rounded-xl"
          />
        </div>

        {/* Info */}
        <div className="flex flex-col justify-center">
          <h1 className="text-3xl font-bold mb-4">{product.title}</h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
            {product.description || "No description available."}
          </p>
          <p className="text-2xl font-semibold text-primary mb-6">${product.price}</p>

          {/* Color selector */}
          {product.colors?.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Color:</label>
              <select
                value={selectedColor}
                onChange={(e) => setSelectedColor(e.target.value)}
                className="border rounded-lg px-3 py-2"
              >
                {product.colors.map((color, idx) => (
                  <option key={idx} value={color}>{color}</option>
                ))}
              </select>
            </div>
          )}

          {/* Size selector */}
          {product.sizes?.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Size:</label>
              <select
                value={selectedSize}
                onChange={(e) => setSelectedSize(e.target.value)}
                className="border rounded-lg px-3 py-2"
              >
                {product.sizes.map((size, idx) => (
                  <option key={idx} value={size}>{size}</option>
                ))}
              </select>
            </div>
          )}

          {/* Quantity selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-1">Quantity:</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-20 border rounded-lg px-3 py-2"
            />
          </div>

          {/* Add to cart */}
          <button
            onClick={handleAddToCart}
            className="px-6 py-3 bg-primary text-white rounded-xl shadow-md hover:bg-primary/90 transition"
          >
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductDetails;
