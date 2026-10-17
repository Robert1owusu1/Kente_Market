// components/ProductCard/ProductCard.tsx
// The one product card used by every product grid (all products, featured,
// trending). Replaces three hand-copied cards that had drifted apart and
// shared the same defects:
//   - the product page was reachable only through a hover-only eye icon, so on
//     touch screens there was no visible way to open a product;
//   - icon-only buttons with no accessible name;
//   - "Add to Cart" stayed enabled on sold-out products;
//   - fabricated details ("Cotton", "3-5 days", "#1 Best Seller", a generic
//     "perfect for custom printing" description) shown when data was missing;
//   - a "Save ₵X" badge computed by comparing price STRINGS.
// Image and title both link to the product; every control is keyboard
// reachable and at least 36px.
//
// Quick actions (View details, Try on) sit on the image. A mouse reveals them
// on hover; a touch screen cannot hover, so there the FIRST tap on the image
// reveals them and a second tap opens the product (tapping elsewhere or Escape
// hides them). Keyboard focus reveals them too. The wishlist heart is always
// visible and shows whether the product is already saved.
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaHeart, FaRegHeart, FaShoppingCart, FaStar, FaStore, FaCheckCircle, FaEye, FaMagic } from "react-icons/fa";
import { resolveImageUrl } from "../../utils/imageUrl";
import { formatCedi } from "../../utils/formatCurrency";
import { stockOnHand, saleInfo, type ProductCardData } from "../../utils/productDisplay";


const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect fill="#f4eee1" width="400" height="500"/><text x="200" y="255" font-family="sans-serif" font-size="20" fill="#8a6d3b" text-anchor="middle">Image coming soon</text></svg>',
  );

interface ProductCardProps {
  product: ProductCardData;
  onAddToCart: (product: ProductCardData) => void;
  onToggleWishlist?: (id: number | string) => void;
  /** Is this product in the signed-in user's wishlist? */
  isSaved?: boolean;
  /** Show the "Try on" quick action (server has AI try-on enabled). */
  tryOnAvailable?: boolean;
  /** A section label that is TRUE for this product (e.g. "Featured"). */
  badge?: string;
  /** Eager-load images that are above the fold. */
  priority?: boolean;
}

const canHover = () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches;

const ProductCard = ({
  product,
  onAddToCart,
  onToggleWishlist,
  isSaved = false,
  tryOnAvailable = false,
  badge,
  priority = false,
}: ProductCardProps) => {
  const title = product.title || product.name || "Kente product";
  const href = `/product/${product.id}`;
  const stock = stockOnHand(product);
  const soldOut = stock !== null && stock <= 0;
  const lowStock = stock !== null && stock > 0 && stock <= 5;
  const sale = saleInfo(product);
  const rating = Number(product.rating) || 0;
  const reviews = Number(product.reviews) || 0;
  const showTryOn = tryOnAvailable && !soldOut;

  const cardRef = useRef<HTMLElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  useEffect(() => {
    if (!actionsOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !cardRef.current?.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [actionsOpen]);

  // Touch: first tap reveals the quick actions instead of navigating.
  const onImageClick = (e: React.MouseEvent) => {
    if (!actionsOpen && !canHover()) {
      e.preventDefault();
      setActionsOpen(true);
    }
  };

  const actionBtn = `${
    actionsOpen ? "pointer-events-auto" : "pointer-events-none group-hover:pointer-events-auto group-focus-within/media:pointer-events-auto"
  } flex min-h-9 w-full items-center justify-center gap-1.5 rounded-full bg-white/95 px-3 text-xs font-semibold text-gray-900 shadow-sm hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:text-sm`;

  return (
    <article ref={cardRef} className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md focus-within:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div className="group/media relative aspect-[4/5] overflow-hidden bg-sand-100 dark:bg-gray-700">
        <Link to={href} tabIndex={-1} aria-hidden="true" onClick={onImageClick} className="block h-full w-full">
          <img
            src={resolveImageUrl(product.img || product.image) || FALLBACK_IMG}
            alt=""
            width={400}
            height={500}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className={`h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105 ${soldOut ? "opacity-60" : ""}`}
            onError={(e) => {
              const img = e.currentTarget;
              img.onerror = null;
              img.src = FALLBACK_IMG;
            }}
          />
        </Link>

        <div
          data-testid="card-actions"
          data-open={actionsOpen ? "true" : "false"}
          // The panel never takes taps itself (only its buttons do), so a tap
          // on the gradient still reaches the image link underneath.
          className={`pointer-events-none absolute inset-x-0 bottom-0 grid gap-1.5 bg-gradient-to-t from-black/60 via-black/25 to-transparent p-2 pt-8 transition-all duration-200 motion-reduce:transition-none ${
            actionsOpen
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within/media:translate-y-0 group-focus-within/media:opacity-100"
          }`}
        >
          <Link to={href} className={actionBtn} aria-label={`View details of ${title}`}>
            <FaEye aria-hidden="true" /> View details
          </Link>
          {showTryOn && (
            <Link to={`/ai-tryon?product=${encodeURIComponent(String(product.id))}`} className={actionBtn} aria-label={`Try on ${title} with AI`}>
              <FaMagic aria-hidden="true" /> Try on
            </Link>
          )}
        </div>
      </div>

      {/* Status badges carry text, never colour alone. */}
      <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
        {soldOut && <span className="rounded-full bg-gray-900/85 px-2.5 py-1 text-xs font-semibold text-white">Sold out</span>}
        {!soldOut && sale && <span className="rounded-full bg-red-700 px-2.5 py-1 text-xs font-semibold text-white">{sale.percentOff}% off</span>}
        {badge && <span className="rounded-full bg-gray-900/85 px-2.5 py-1 text-xs font-semibold text-white">{badge}</span>}
        {!soldOut && lowStock && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Only {stock} left</span>}
        {Boolean(product.madeToOrder) && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Made to order</span>}
        {Boolean(product.isRentable) && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Rentable</span>}
      </div>

      {onToggleWishlist && (
        <button
          type="button"
          onClick={() => onToggleWishlist(product.id)}
          aria-pressed={isSaved}
          aria-label={isSaved ? `Remove ${title} from wishlist` : `Save ${title} to wishlist`}
          title={isSaved ? "Remove from wishlist" : "Save to wishlist"}
          className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-red-600 shadow-sm transition-transform hover:bg-white active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark motion-reduce:transition-none dark:bg-gray-900/80"
        >
          {isSaved ? <FaHeart aria-hidden="true" /> : <FaRegHeart aria-hidden="true" />}
        </button>
      )}

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {product.vendorBusinessName && (
          <p className="mb-1 flex min-w-0 items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
            <FaStore aria-hidden="true" className="shrink-0 text-gold-dark" />
            <span className="truncate">{product.vendorBusinessName}</span>
            {product.vendorStatus === "approved" && (
              <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-green-700 dark:text-green-400">
                <FaCheckCircle aria-hidden="true" /> Verified
              </span>
            )}
          </p>
        )}

        <h3 className="mb-1 text-sm font-semibold leading-snug text-gray-900 sm:text-base dark:text-white">
          <Link to={href} className="line-clamp-2 min-h-6 hover:text-primary-dark hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark dark:hover:text-primary">
            {title}
          </Link>
        </h3>

        {rating > 0 && (
          <p className="mb-1 flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
            <FaStar aria-hidden="true" className="text-amber-500" />
            <span>
              <span className="sr-only">Rated </span>
              {rating.toFixed(1)}
              <span className="sr-only"> out of 5</span>
            </span>
            {reviews > 0 && <span>({reviews} {reviews === 1 ? "review" : "reviews"})</span>}
          </p>
        )}

        <p className="mb-3 mt-auto flex flex-wrap items-baseline gap-x-2 pt-1">
          <span className="text-base font-bold text-gray-900 sm:text-lg dark:text-white">
            {sale && <span className="sr-only">Sale price </span>}
            {formatCedi(product.price)}
          </span>
          {sale && (
            <span className="text-xs text-gray-500 line-through sm:text-sm dark:text-gray-400">
              <span className="sr-only">Original price </span>
              {formatCedi(sale.original)}
            </span>
          )}
        </p>

        <button
          type="button"
          onClick={() => onAddToCart(product)}
          disabled={soldOut}
          aria-label={soldOut ? `${title} is sold out` : `Add ${title} to cart`}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary-dark px-3 text-sm font-semibold text-gray-900 hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-600 dark:disabled:bg-gray-700 dark:disabled:text-gray-300"
        >
          <FaShoppingCart aria-hidden="true" />
          {soldOut ? "Sold out" : "Add to Cart"}
        </button>
      </div>
    </article>
  );
};

export default ProductCard;
