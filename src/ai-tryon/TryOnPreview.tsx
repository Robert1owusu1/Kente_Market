import React, { useState } from "react";
import { FaDownload, FaSlidersH, FaShoppingCart, FaRedo, FaExternalLinkAlt, FaInfoCircle } from "react-icons/fa";
import { Link } from "react-router-dom";
import { useCart } from "../Context/CartContext";
import { toCartItem } from "../utils/cartItem";
import { resolveImageUrl } from "../utils/imageUrl";
import { yardOptionsFor } from "../utils/yards";
import type { Product } from "../types/domain";
import "./AiTryOnStyles.css";

interface TryOnPreviewProps {
  originalImage: string | null;
  resultImage: string;
  /** The product that was tried on — every action below refers to it. */
  product: Product;
  /** Yardage the customer picked on the product page, if any. */
  yards: string | null;
  onTryAgain: () => void;
}

const TryOnPreview = ({ originalImage, resultImage, product, yards, onTryAgain }: TryOnPreviewProps) => {
  const { addToCart } = useCart();
  const [compareMode, setCompareMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [added, setAdded] = useState(false);

  const productUrl = `/product/${product.id}`;
  // Only add straight to the cart when the yardage chosen on the product page
  // is one this product actually offers; otherwise send the customer back to
  // choose it there.
  const validYards = yards && yardOptionsFor(product).includes(yards) ? yards : null;
  const stockRaw = product.in_stock ?? product.stock;
  const isOutOfStock = stockRaw !== undefined && stockRaw !== null && (Number(stockRaw) || 0) <= 0;

  const handleSliderMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = ((e.clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.min(100, Math.max(0, pos)));
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = resultImage;
    link.download = `kente-tryon-${String(product.title || "result").replace(/\s+/g, "-").toLowerCase()}.jpg`;
    link.click();
  };

  const handleAddToCart = () => {
    if (!validYards) return;
    addToCart(toCartItem(product, validYards, 1));
    setAdded(true);
  };

  return (
    <div className="aitryon-preview bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
      <div className="bg-gradient-to-r from-primary to-secondary text-white p-4 flex items-center justify-between">
        <h3 className="font-bold text-lg">Your try-on: {product.title}</h3>
        {originalImage && (
          <button
            onClick={() => setCompareMode(!compareMode)}
            className="bg-white/20 hover:bg-white/30 p-2 rounded-full transition-all"
            title={compareMode ? "Show try-on" : "Compare with your photo"}
            aria-label={compareMode ? "Show try-on" : "Compare with your photo"}
          >
            <FaSlidersH />
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-5 gap-4 p-4">
        {/* Generated image */}
        <div className="md:col-span-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-2">
            AI-generated visualization
          </p>
          <div
            className={`relative rounded-xl overflow-hidden ${compareMode ? "h-96" : ""}`}
            onMouseMove={compareMode ? handleSliderMove : undefined}
          >
            {!compareMode ? (
              <img
                src={resultImage}
                alt={`AI try-on of ${product.title}`}
                className="w-full max-h-[520px] object-contain rounded-xl mx-auto"
              />
            ) : (
              <div className="relative w-full h-full">
                <img src={originalImage ?? undefined} alt="Your photo" className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
                  <img src={resultImage} alt="Try-on overlay" className="w-full h-full object-cover" />
                </div>
                <div className="absolute top-0 bottom-0 w-1 bg-white shadow-lg" style={{ left: `${sliderPos}%` }} />
                <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">Your photo</div>
                <div className="absolute top-4 right-4 bg-primary text-white px-3 py-1 rounded-full text-sm">Try-On</div>
              </div>
            )}
          </div>
        </div>

        {/* The real product */}
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">The actual product</p>
          <img
            src={resolveImageUrl(product.img)}
            alt={product.title}
            className="w-full rounded-xl object-cover max-h-72"
          />
          <h4 className="mt-3 font-semibold text-gray-800 dark:text-white">{product.title}</h4>
          <p className="text-primary font-semibold text-lg">GH₵{product.price}</p>
          {validYards && <p className="text-sm text-gray-500 dark:text-gray-400">{validYards} yards</p>}
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-3 px-4">
        <Link to={productUrl} className="aitryon-btn-secondary inline-flex">
          <FaExternalLinkAlt className="mr-2" /> View Product
        </Link>
        {isOutOfStock ? (
          <Link to={productUrl} className="aitryon-btn-secondary inline-flex">Sold out — view product</Link>
        ) : validYards ? (
          added ? (
            <Link to="/cart" className="aitryon-btn-primary inline-flex bg-green-600 hover:bg-green-700">
              <FaShoppingCart className="mr-2" /> Added — go to cart
            </Link>
          ) : (
            <button onClick={handleAddToCart} className="aitryon-btn-primary bg-green-600 hover:bg-green-700">
              <FaShoppingCart className="mr-2" /> Add to Cart
            </button>
          )
        ) : (
          <Link to={productUrl} className="aitryon-btn-primary inline-flex bg-green-600 hover:bg-green-700">
            <FaShoppingCart className="mr-2" /> Choose Options
          </Link>
        )}
        <button onClick={onTryAgain} className="aitryon-btn-secondary">
          <FaRedo className="mr-2" /> Try Again
        </button>
        <button onClick={handleDownload} className="aitryon-btn-secondary">
          <FaDownload className="mr-2" /> Download
        </button>
      </div>

      <div className="m-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
        <FaInfoCircle className="mt-0.5 flex-shrink-0" />
        <p>
          This is an AI-generated visualization, not a photo of the real cloth
          on you. Fabric details, fit, colours and patterns may differ from the
          actual garment — the AI can simplify or blur Kente's woven pattern.
          Check the product photos for the true design before you buy.
        </p>
      </div>
    </div>
  );
};

export default TryOnPreview;
