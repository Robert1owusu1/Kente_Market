import React from "react";
import { SAMPLE_PRODUCTS } from "../allProductsData/products";
import "./AiTryOnStyles.css";

const StyleSelector = ({ selected, onSelect, compact = false }) => {
  const displayProducts = compact ? SAMPLE_PRODUCTS.slice(0, 8) : SAMPLE_PRODUCTS;

  return (
    <div className="aitryon-styles">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
        <span>🪡</span> Select a Kente Cloth to Try
      </h3>
      <div className={`grid gap-3 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
        {displayProducts.map((product) => (
          <button
            key={product.id}
            onClick={() => onSelect(product)}
            className={`aitryon-style-card group relative rounded-xl overflow-hidden border-2 transition-all duration-300 ${
              selected?.id === product.id
                ? "border-primary ring-2 ring-primary/30 shadow-lg"
                : "border-gray-200 dark:border-gray-700 hover:border-primary/50"
            }`}
          >
            <img
              src={product.img}
              alt={product.title}
              className="w-full h-28 sm:h-32 object-cover group-hover:scale-110 transition-transform duration-500"
            />
            {selected?.id === product.id && (
              <div className="absolute top-2 right-2 bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-lg">
                ✓
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-left">
              <p className="text-white text-xs font-semibold truncate">{product.title}</p>
              <p className="text-white/70 text-[10px]">GH₵{product.price}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default StyleSelector;
