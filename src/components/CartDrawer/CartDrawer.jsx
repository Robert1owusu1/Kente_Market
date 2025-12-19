import React from "react";
import { useCart } from "../../Context/CartContext";
import { Link } from "react-router-dom";


const CartDrawer = ({ isOpen, onClose }) => {
  const {
    cartItems,
    removeItem,
    updateItemQuantity,
    getTotalPrice,
  } = useCart();

  return (
    <div
      className={`fixed top-0 right-0 h-[calc(100%-20px)]  w-80 bg-white dark:bg-gray-900/100 shadow-lg z-50 transform transition-transform duration-300 ${
        isOpen ? "translate-x-0" : "translate-x-full" 
      }`}
    >
      <div className="p-4 flex justify-between items-center border-b dark:border-secondary">
        <h2 className="text-lg font-bold dark:text-primary ">Your Cart</h2>
        <button
          onClick={onClose}
          className="text-gray-500 dark:hover:text-white text-xl "
        >
          ✖
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto h-[calc(89%-120px)]">
        {cartItems.length === 0 ? (
          <p className="text-gray-500 dark:text-white/85">Your cart is empty.</p>
        ) : (
          cartItems.map((item, index) => (
            <div
              key={`cart-item-${item.id}-${index}`}
              className="border-b pb-3 flex justify-between items-start"
            >
              <div className="flex gap-3">
                <img
                  src={item.img}
                  alt={item.title}
                  className="w-16 h-16 object-cover rounded"
                />
                <div>
                  <h4 className="font-semibold">{item.title}</h4>
                  <p className="text-sm text-gray-500 dark:text-secondary">Price: GH₵ {item.price}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() =>
                        updateItemQuantity(item.id, Math.max(1, item.quantity - 1))
                      }
                      className="px-2 bg-gray-200 dark:bg-primary rounded"
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      onClick={() =>
                        updateItemQuantity(item.id, item.quantity + 1)
                      }
                      className="px-2 bg-gray-200 dark:bg-primary rounded"
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
                onClick={() => removeItem(item.id)}
                className="text-red-500 hover:text-red-700"
              >
                ❌
              </button>
            </div>
          ))
        )}
      </div>

      {/* Total section */}
      {cartItems.length > 0 && (
        <div className="p-4 border-t dark:border-gray-700">
          <div className="flex justify-between text-lg font-semibold dark:text-primary">
            <span>Total:</span>
            <span>GH₵ {getTotalPrice().toFixed(2)}</span>
          </div>
          <Link to="/cartpage">
          <button
            className="mt-4 w-full bg-black text-white py-2 rounded hover:bg-opacity-90 transition"
          >
            Proceed to Checkout
          </button>
          </Link>
        </div>
      )}
    </div>
  );
};

export default CartDrawer;