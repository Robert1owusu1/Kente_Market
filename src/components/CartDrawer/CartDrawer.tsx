import React from "react";
import { useCart } from "../../Context/CartContext";
import { Link } from "react-router-dom";
import { FaTimes, FaArrowRight } from "react-icons/fa";
import { calcOrderTotals } from "../../utils/pricing";
import { resolveImageUrl } from "../../utils/imageUrl";

const CartDrawer = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const {
    cartItems,
    removeItem,
    updateItemQuantity,
  } = useCart();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-white dark:bg-gray-900 shadow-2xl z-50 transform transition-transform duration-300 translate-x-0 flex flex-col">
        <div className="p-4 flex justify-between items-center border-b dark:border-gray-700">
          <h2 className="text-lg font-bold dark:text-primary ">Your Cart</h2>
          <button
            onClick={onClose}
            className="text-gray-500 dark:hover:text-white text-2xl hover:text-gray-700 transition-colors"
            aria-label="Close cart"
          >
            <FaTimes className="cursor-pointer" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {cartItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-10">
              <div className="text-6xl mb-4">🛒</div>
              <p className="text-gray-500 dark:text-white/85">Your cart is empty.</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 px-6 py-2 bg-primary text-white rounded-full"
              >
                Start Shopping
              </button>
            </div>
          ) : (
            cartItems.map((item, index) => (
              <div
                key={`cart-item-${item.id}-${index}`}
                className="border-b dark:border-gray-700 pb-3 flex justify-between items-start"
              >
                <div className="flex gap-3">
                  <img
                    src={resolveImageUrl(item.img || (item as { image?: string }).image)}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    className="w-16 h-16 object-cover rounded"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.onerror = null;
                      target.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#f4eee1" width="100" height="100"/><text x="50" y="55" font-family="sans-serif" font-size="12" fill="#8a6d3b" text-anchor="middle">Kente</text></svg>');
                    }}
                  />
                  <div>
                    <h4 className="font-semibold">{item.title}</h4>
                    <p className="text-sm text-gray-500 dark:text-secondary">Price: GH₵ {item.price}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateItemQuantity(item.id, Math.max(1, item.quantity - 1))
                        }
                        className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-lg"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateItemQuantity(item.id, item.quantity + 1)
                        }
                        className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-lg"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-secondary mt-1">
                      Subtotal: GH₵ {(item.price * item.quantity).toFixed(2)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="text-red-500 hover:text-red-700 p-1"
                  aria-label="Remove item"
                >
                  <FaTimes />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Total section */}
        {cartItems.length > 0 && (
          <div className="pt-4 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shadow-[0_-8px_20px_rgba(0,0,0,0.07)]">
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>GH₵ {calcOrderTotals(cartItems).subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span>
                  {calcOrderTotals(cartItems).shipping === 0
                    ? 'Free'
                    : `GH₵ ${calcOrderTotals(cartItems).shipping.toFixed(2)}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>GH₵ {calcOrderTotals(cartItems).tax.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex justify-between text-lg font-semibold dark:text-primary mt-2">
              <span>Total:</span>
              <span>GH₵ {calcOrderTotals(cartItems).total.toFixed(2)}</span>
            </div>
            <Link
              to="/cartpage"
              onClick={onClose}
              className="mt-4 w-full bg-primary text-white py-4 text-base min-h-[52px] rounded-xl hover:bg-primary-hover active:bg-primary-dark transition font-semibold text-center flex items-center justify-center gap-2 shadow-lg shadow-primary/30"
            >
              Proceed to Checkout
              <FaArrowRight className="text-sm translate-y-px" />
            </Link>
          </div>
        )}
      </div>
    </>
  );
};

export default CartDrawer;
