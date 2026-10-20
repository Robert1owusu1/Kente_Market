import React, { useState } from "react";
import { FaDownload, FaSlidersH, FaShoppingCart, FaRedo, FaExternalLinkAlt, FaInfoCircle, FaBolt, FaLock, FaCheck, FaHandSparkles } from "react-icons/fa";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../Context/CartContext";
import { toCartItem } from "../utils/cartItem";
import { resolveImageUrl } from "../utils/imageUrl";
import { pieceLengthLabel } from "../utils/yards";
import type { Product } from "../types/domain";
import "./AiTryOnStyles.css";

interface TryOnPreviewProps {
  originalImage: string | null;
  resultImage: string;
  /** The product that was tried on — every action below refers to it. */
  product: Product;
  onTryAgain: () => void;
}

const TryOnPreview = ({ originalImage, resultImage, product, onTryAgain }: TryOnPreviewProps) => {
  const { addToCart } = useCart();
  const navigate = useNavigate();
  const [compareMode, setCompareMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [added, setAdded] = useState(false);

  const productUrl = `/product/${product.id}`;
  // Kente is sold as the seller's packaged piece: the customer chooses only
  // how many, right here, without going back to the product page.
  const pieceLength = pieceLengthLabel(product);
  const stockRaw = product.in_stock ?? product.stock;
  const stockLevel = stockRaw === undefined || stockRaw === null ? null : Number(stockRaw) || 0;
  const isOutOfStock = stockLevel !== null && stockLevel <= 0;
  const isLowStock = stockLevel !== null && stockLevel > 0 && stockLevel <= 5;
  const maxQty = stockLevel === null ? 99 : Math.max(1, Math.min(99, stockLevel));
  const [quantity, setQuantity] = useState(1);
  const canBuy = !isOutOfStock;

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
    if (!canBuy) return;
    addToCart(toCartItem(product, quantity));
    setAdded(true);
  };

  const handleBuyNow = () => {
    if (!canBuy) return;
    if (!added) addToCart(toCartItem(product, quantity));
    navigate("/cart");
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

        {/* The real product, and buying it */}
        <div className="md:col-span-2">
          <p className="text-lg font-bold text-gray-900 dark:text-white">Love how it looks? Make it yours.</p>
          <div className="mt-3 flex gap-3">
            <img
              src={resolveImageUrl(product.img)}
              alt={product.title}
              className="h-24 w-24 flex-shrink-0 rounded-xl object-cover"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">The actual product</p>
              <h4 className="font-semibold text-gray-800 dark:text-white">{product.title}</h4>
              <p className="text-primary font-semibold text-lg">
                GH₵{product.price}
                <span className="ml-1 text-sm font-normal text-gray-600 dark:text-gray-300">per piece{pieceLength ? ` (${pieceLength})` : ""}</span>
              </p>
            </div>
          </div>

          {!isOutOfStock && (
            <div className="mt-4">
              <p id="tryon-qty-label" className="text-sm font-medium text-gray-800 dark:text-gray-100">Quantity (pieces)</p>
              <div className="mt-2 flex w-fit items-center rounded-lg bg-gray-100 dark:bg-gray-700" role="group" aria-labelledby="tryon-qty-label">
                <button
                  type="button"
                  onClick={() => { setQuantity((q) => Math.max(1, q - 1)); setAdded(false); }}
                  disabled={quantity <= 1}
                  aria-label="Decrease quantity"
                  className="min-h-10 min-w-10 rounded-l-lg text-lg disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-10 text-center font-bold" aria-live="polite">{quantity}</span>
                <button
                  type="button"
                  onClick={() => { setQuantity((q) => Math.min(maxQty, q + 1)); setAdded(false); }}
                  disabled={quantity >= maxQty}
                  aria-label="Increase quantity"
                  className="min-h-10 min-w-10 rounded-r-lg text-lg disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {isLowStock && (
            <p className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-300">Only {stockLevel} left in stock.</p>
          )}

          {isOutOfStock ? (
            <Link to={productUrl} className="aitryon-btn-secondary mt-4 inline-flex w-full justify-center">Sold out — view product</Link>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" onClick={handleBuyNow} disabled={!canBuy} className="aitryon-btn-primary w-full justify-center">
                <FaBolt className="mr-2" aria-hidden="true" /> Buy Now
              </button>
              {added ? (
                <Link to="/cart" className="aitryon-btn-secondary inline-flex w-full justify-center">
                  <FaCheck className="mr-2" aria-hidden="true" /> Added — go to cart
                </Link>
              ) : (
                <button type="button" onClick={handleAddToCart} disabled={!canBuy} className="aitryon-btn-secondary w-full justify-center">
                  <FaShoppingCart className="mr-2" aria-hidden="true" /> Add to Cart
                </button>
              )}
            </div>
          )}

          <ul className="mt-4 space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
            <li className="flex items-start gap-2">
              <FaHandSparkles className="mt-0.5 flex-shrink-0 text-primary" aria-hidden="true" />
              {product.vendorBusinessName ? `Authentic Kente sold by ${product.vendorBusinessName}` : "Authentic Kente from Ghana"}
            </li>
            <li className="flex items-start gap-2">
              <FaLock className="mt-0.5 flex-shrink-0 text-primary" aria-hidden="true" />
              Secure payment with Paystack
            </li>
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-3 px-4">
        <Link to={productUrl} className="aitryon-btn-secondary inline-flex">
          <FaExternalLinkAlt className="mr-2" /> View Product
        </Link>
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
