import React, { useEffect, useMemo, useState } from "react";
import { useCart } from "../../Context/CartContext";
import { Link } from "react-router-dom";
import { FaTimes, FaArrowRight, FaShoppingCart } from "react-icons/fa";
import { calcOrderTotals } from "../../utils/pricing";
import { resolveImageUrl } from "../../utils/imageUrl";

const ANIMATION_DURATION = 300;

const CartDrawer = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { cartItems, removeItem, updateItemQuantity } = useCart();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(isOpen);

  const totals = useMemo(() => calcOrderTotals(cartItems), [cartItems]);
  const totalItems = useMemo(
    () => cartItems.reduce((total, item) => total + (Number(item.quantity) || 0), 0),
    [cartItems]
  );

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const frameId = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frameId);
    }

    setIsVisible(false);
    const timeoutId = window.setTimeout(() => setShouldRender(false), ANIMATION_DURATION);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!shouldRender) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, shouldRender]);

  if (!shouldRender) return null;

  return (
    <>
      <div
        className={`fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        className={`fixed inset-0 z-[70] flex justify-end transition-all duration-300 ease-out md:inset-y-0 md:left-auto md:w-[min(100vw,28rem)] ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          className={`flex h-[100dvh] w-full max-w-full flex-col overflow-hidden bg-white shadow-[0_24px_80px_rgba(0,0,0,0.28)] transition-transform duration-300 ease-out dark:bg-gray-900 md:w-[min(100vw,28rem)] md:border-l md:border-gray-200 md:dark:border-gray-800 md:rounded-none ${
            isVisible
              ? "translate-y-0 md:translate-x-0"
              : "translate-y-full md:translate-y-0 md:translate-x-full"
          }`}
        >
          <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <FaShoppingCart className="text-lg" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold text-gray-900 dark:text-white">
                      Your Cart
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {totalItems} {totalItems === 1 ? "item" : "items"}
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-white"
                aria-label="Close cart"
              >
                <FaTimes className="text-xl" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {cartItems.length === 0 ? (
              <div className="flex h-full min-h-[60vh] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center dark:border-gray-700 dark:bg-gray-800/40">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-4xl">
                  🛒
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Your cart is empty
                </h3>
                <p className="mt-2 max-w-xs text-sm text-gray-500 dark:text-gray-400">
                  Add items to your cart and they will appear here for quick review.
                </p>
                <Link
                  to="/products"
                  onClick={onClose}
                  className="mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-white transition hover:bg-primary-hover active:bg-primary-dark"
                >
                  Start Shopping
                  <FaArrowRight className="text-sm" />
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {cartItems.map((item, index) => (
                  <div
                    key={`cart-item-${item.id}-${index}`}
                    className="relative rounded-3xl border border-gray-200 bg-gray-50 p-4 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800/60 sm:p-5"
                  >
                    <div className="flex gap-4 pr-10">
                      <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-2xl bg-white dark:bg-gray-700 sm:h-24 sm:w-24">
                        <img
                          src={resolveImageUrl(item.img || (item as { image?: string }).image)}
                          alt={item.title}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.onerror = null;
                            target.src =
                              "data:image/svg+xml;utf8," +
                              encodeURIComponent(
                                '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#f4eee1" width="100" height="100"/><text x="50" y="55" font-family="sans-serif" font-size="12" fill="#8a6d3b" text-anchor="middle">Kente</text></svg>'
                              );
                          }}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4 className="line-clamp-2 pr-2 text-base font-semibold text-gray-900 dark:text-white">
                          {item.title}
                        </h4>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                          Price: GH₵ {Number(item.price).toFixed(2)}
                        </p>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <div className="inline-flex items-center rounded-xl bg-white p-1 shadow-sm dark:bg-gray-700">
                            <button
                              type="button"
                              onClick={() =>
                                updateItemQuantity(item.id, Math.max(1, item.quantity - 1))
                              }
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600"
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <span className="min-w-8 px-2 text-center text-sm font-semibold text-gray-900 dark:text-white">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600"
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </div>

                          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                            Subtotal: GH₵ {(Number(item.price) * item.quantity).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="absolute right-3 top-3 rounded-full p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      aria-label="Remove item"
                    >
                      <FaTimes />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cartItems.length > 0 && (
            <div className="sticky bottom-0 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 sm:px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>GH₵ {totals.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span>{totals.shipping === 0 ? "Free" : `GH₵ ${totals.shipping.toFixed(2)}`}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>GH₵ {totals.tax.toFixed(2)}</span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-lg font-semibold text-gray-900 dark:text-white">
                <span>Total</span>
                <span>GH₵ {totals.total.toFixed(2)}</span>
              </div>

              <Link
                to="/cartpage"
                onClick={onClose}
                className="mt-4 inline-flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-white shadow-lg shadow-primary/30 transition hover:bg-primary-hover active:bg-primary-dark"
              >
                Review Cart
                <FaArrowRight className="text-sm" />
              </Link>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default CartDrawer;
