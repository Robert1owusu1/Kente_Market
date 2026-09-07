import React, { useState } from "react";
import { FaDownload, FaSlidersH, FaShoppingCart, FaLink, FaShareAlt } from "react-icons/fa";
import { Link } from "react-router-dom";
import type { Product } from "../types/domain";
import "./AiTryOnStyles.css";

interface TryOnPreviewProps {
  originalImage: string | null;
  resultImage: string | null;
  product: Product | null;
  onReset: () => void;
}

const TryOnPreview = ({ originalImage, resultImage, product, onReset }: TryOnPreviewProps) => {
  const [compareMode, setCompareMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);

  const handleSliderMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = ((e.clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.min(100, Math.max(0, pos)));
  };

  const handleDownload = () => {
    if (!resultImage) return;
    const link = document.createElement("a");
    link.href = resultImage;
    link.download = `bonwire-kente-tryon-${product?.title?.replace(/\s+/g, "-").toLowerCase() || "result"}.jpg`;
    link.click();
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Bonwire Kente Try-On: ${product?.title || "Kente"}`,
          text: `Check out how I look wearing the ${product?.title || "Kente"} from Bonwire Kente!`,
          url: window.location.href,
        });
      } catch (err) {
        console.log("Share cancelled or failed", err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        alert("Link copied to clipboard!");
      } catch {
        alert("Could not copy link.");
      }
    }
  };

  if (!resultImage) return null;

  return (
    <div className="aitryon-preview bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-secondary text-white p-4 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">✨ Your Kente Try-On Result</h3>
          <p className="text-sm text-white/80">
            {product?.title || "Kente"} — {product?.category || ""}
          </p>
        </div>
        <button
          onClick={() => setCompareMode(!compareMode)}
          className="bg-white/20 hover:bg-white/30 p-2 rounded-full transition-all"
          title={compareMode ? "View side by side" : "Compare with original"}
        >
          <FaSlidersH />
        </button>
      </div>

      {/* Image Display */}
      <div className="relative p-4">
        <div
          className={`relative rounded-xl overflow-hidden ${compareMode ? "h-96" : ""}`}
          onMouseMove={compareMode ? handleSliderMove : undefined}
        >
          {!compareMode ? (
            <img
              src={resultImage}
              alt={`${product?.title} try-on result`}
              className="w-full max-h-[480px] object-contain rounded-xl mx-auto"
            />
          ) : (
            <div className="relative w-full h-full">
              <img
                src={originalImage ?? undefined}
                alt="Original"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
                <img
                  src={resultImage}
                  alt="Try-on overlay"
                  className="w-full h-full object-cover"
                />
              </div>
              <div
                className="absolute top-0 bottom-0 w-1 bg-white shadow-lg"
                style={{ left: `${sliderPos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -left-3 bg-white text-primary rounded-full w-7 h-7 flex items-center justify-center shadow-lg">
                  <FaSlidersH className="text-xs" />
                </div>
              </div>
              <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">Original</div>
              <div className="absolute top-4 right-4 bg-primary text-white px-3 py-1 rounded-full text-sm">Try-On</div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-center gap-3 mt-4">
          <button
            onClick={handleDownload}
            className="aitryon-btn-primary"
          >
            <FaDownload className="mr-2" /> Download
          </button>
          <button
            onClick={handleShare}
            className="aitryon-btn-secondary"
          >
            <FaShareAlt className="mr-2" /> Share
          </button>
          {product && (
            <Link to={`/product/${product.id}`} className="aitryon-btn-primary bg-green-600 hover:bg-green-700">
              <FaShoppingCart className="mr-2" /> Buy This Look
            </Link>
          )}
          <button onClick={onReset} className="aitryon-btn-secondary">
            <FaLink className="mr-2" /> Try Another
          </button>
        </div>
      </div>

      {/* Info Footer */}
      <div className="p-4 border-t dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
        <p>
          💡 Tip: Use the slider to compare your original photo with the Kente
          try-on. For the best results, take a front-facing photo in good
          lighting.
        </p>
      </div>
    </div>
  );
};

export default TryOnPreview;
