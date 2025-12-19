import React, { useState, useMemo, useCallback } from "react";
import { useCart } from "../../Context/CartContext";
import { Link, useNavigate } from "react-router-dom";
import { FaShoppingCart, FaMinus, FaPlus, FaTrash, FaHeart, FaArrowRight, FaStar, FaCheck } from "react-icons/fa";
import { useCreateOrderMutation } from "../../slices/ordersApiSlice";
import { toast } from "react-toastify";

// Constants
const TAX_RATE = 0.125;
const FREE_SHIPPING_THRESHOLD = 200;
const STANDARD_SHIPPING_COST = 15;

const COLOR_MAP = {
  Red: "#EF4444",
  Blue: "#3B82F6", 
  Black: "#1F2937",
  White: "#F9FAFB",
  Yellow: "#EAB308",
  Navy: "#1E3A8A",
  Pink: "#EC4899",
  Purple: "#8B5CF6",
  Green: "#10B981",
  Beige: "#D4B896"
};

// Helper function for price calculations
const calculateOrderTotals = (subtotal) => {
  const taxPrice = Number((subtotal * TAX_RATE).toFixed(2));
  const shippingPrice = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_COST;
  const totalPrice = Number((subtotal + taxPrice + shippingPrice).toFixed(2));
  
  return { taxPrice, shippingPrice, totalPrice };
};

// Memoized Cart Item Component
const CartItem = React.memo(({ item, onRemove, onUpdateQuantity, onUpdateSize, onUpdateColors, isRemoving }) => {
  return (
    <div
      className={`group bg-white/80 backdrop-blur-xl rounded-3xl p-6 border border-white/20 shadow-xl hover:shadow-2xl transition-all duration-500 hover:-translate-y-1 ${
        isRemoving ? 'animate-pulse opacity-50 scale-95' : ''
      }`}
    >
      <div className="flex flex-col md:flex-row gap-6">
        {/* Product Image & Info */}
        <div className="flex items-start gap-4 w-full md:w-2/3">
          <div className="relative">
            <div className="w-32 h-32 rounded-2xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 shadow-lg">
              <img
                src={item.img}
                alt={item.title}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                loading="lazy"
              />
            </div>
            <button 
              className="absolute -top-2 -right-2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all duration-300"
              aria-label="Add to wishlist"
            >
              <FaHeart className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <h4 className="text-xl font-bold text-gray-800 group-hover:text-blue-600 transition-colors duration-300">
                {item.title}
              </h4>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex" role="img" aria-label="4.8 out of 5 stars">
                  {[...Array(5)].map((_, i) => (
                    <FaStar key={`${item.id}-star-${i}`} className="w-4 h-4 text-yellow-400" />
                  ))}
                </div>
                <span className="text-sm text-gray-500">(4.8)</span>
              </div>
              <p className="text-2xl font-bold text-blue-600 mt-2">
                GH₵ {item.price.toFixed(2)}
              </p>
            </div>

            {/* Size selection */}
            {item.sizes && item.sizes.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">Size</label>
                <div className="flex gap-2" role="group" aria-label="Size selection">
                  {item.sizes.map((size) => (
                    <button
                      key={`${item.id}-size-${size}`}
                      onClick={() => onUpdateSize(item.id, size)}
                      className={`w-12 h-12 rounded-xl border-2 text-sm font-medium transition-all duration-300 ${
                        item.size === size
                          ? 'border-blue-500 bg-blue-500 text-white shadow-lg'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                      aria-label={`Size ${size}`}
                      aria-pressed={item.size === size}
                    >
                      {size}
                    </button>
                  ))}
                </div>
                {!item.size && (
                  <p className="text-xs text-amber-600 font-medium" role="alert">
                    Please select a size
                  </p>
                )}
              </div>
            )}

            {/* Color selection */}
            {item.colorsAvailable && item.colorsAvailable.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">Color</label>
                <div className="flex gap-3" role="group" aria-label="Color selection">
                  {item.colorsAvailable.map((color) => {
                    const isSelected = item.colors?.[0] === color;
                    return (
                      <button
                        key={`${item.id}-color-${color}`}
                        onClick={() => onUpdateColors(item.id, [color])}
                        className={`relative w-12 h-12 rounded-full border-4 transition-all duration-300 hover:scale-110 ${
                          isSelected ? 'border-blue-500 shadow-lg' : 'border-gray-200'
                        }`}
                        style={{ backgroundColor: COLOR_MAP[color] || color.toLowerCase() }}
                        title={color}
                        aria-label={`Color ${color}`}
                        aria-pressed={isSelected}
                      >
                        {isSelected && (
                          <FaCheck className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow-sm" />
                        )}
                      </button>
                    );
                  })}
                </div>
                {(!item.colors || item.colors.length === 0) && (
                  <p className="text-xs text-amber-600 font-medium" role="alert">
                    Please select a color
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quantity & Remove */}
        <div className="flex flex-col items-start md:items-end gap-4 w-full md:w-1/3">
          <div className="flex items-center bg-gray-100 rounded-2xl p-1" role="group" aria-label="Quantity controls">
            <button
              onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
              className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-white hover:shadow-md transition-all duration-300"
              aria-label="Decrease quantity"
              disabled={item.quantity <= 1}
            >
              <FaMinus className="w-4 h-4" />
            </button>
            <span className="w-16 text-center font-bold text-lg" aria-label={`Quantity: ${item.quantity}`}>
              {item.quantity}
            </span>
            <button
              onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
              className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-white hover:shadow-md transition-all duration-300"
              aria-label="Increase quantity"
            >
              <FaPlus className="w-4 h-4" />
            </button>
          </div>
          
          <div className="text-right">
            <p className="text-sm text-gray-600">Subtotal</p>
            <p className="text-2xl font-bold text-gray-800">
              GH₵ {(item.price * item.quantity).toFixed(2)}
            </p>
          </div>

          <button
            onClick={() => onRemove(item)}
            className="flex items-center gap-2 text-red-500 hover:text-red-700 hover:bg-red-50 px-4 py-2 rounded-xl transition-all duration-300"
            aria-label={`Remove ${item.title} from cart`}
          >
            <FaTrash className="w-4 h-4" />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
});

CartItem.displayName = 'CartItem';

const CartPage = () => {
  const {
    cartItems,
    removeItem,
    updateItemQuantity,
    updateItemSize,
    updateItemColors,
    getTotalPrice,
  } = useCart();

  const [createOrder, { isLoading: isCreatingOrder }] = useCreateOrderMutation();
  const navigate = useNavigate();
  
  const [removingItems, setRemovingItems] = useState(new Set());
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [itemToRemove, setItemToRemove] = useState(null);

  // Memoize calculations
  const subtotal = useMemo(() => getTotalPrice(), [getTotalPrice]);
  const { taxPrice, shippingPrice, totalPrice } = useMemo(
    () => calculateOrderTotals(subtotal),
    [subtotal]
  );
  const totalItems = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  const handleRemoveItem = useCallback(async (id) => {
    setRemovingItems(prev => new Set([...prev, id]));
    setTimeout(() => {
      removeItem(id);
      setRemovingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
      setShowRemoveModal(false);
      setItemToRemove(null);
    }, 300);
  }, [removeItem]);

  const openRemoveModal = useCallback((item) => {
    setItemToRemove(item);
    setShowRemoveModal(true);
  }, []);

  const cancelRemove = useCallback(() => {
    setShowRemoveModal(false);
    setItemToRemove(null);
  }, []);

  const placeOrderHandler = async () => {
    if (cartItems.length === 0) {
      toast.error("Your cart is empty!");
      return;
    }

    // Validation - check for incomplete selections
    const hasIncompleteItems = cartItems.some(item => 
      (item.sizes && item.sizes.length > 0 && !item.size) ||
      (item.colorsAvailable && item.colorsAvailable.length > 0 && (!item.colors || item.colors.length === 0))
    );

    if (hasIncompleteItems) {
      toast.error("Please select size and color for all items before proceeding!");
      return;
    }

    // Prepare order data matching backend structure exactly
    const orderData = {
      items: cartItems.map(item => ({
        name: item.title,
        qty: item.quantity,
        image: item.img,
        price: item.price,
        product: item.id,
        size: item.size || null,
        colors: item.colors || []
      })),
      totalAmount: totalPrice,
      shippingCost: shippingPrice,
      tax: taxPrice,
      discount: 0,
      shippingAddress: {}, // Will be collected in checkout
      billingAddress: {},  // Will be collected in checkout
      paymentMethod: 'pending',
      paymentStatus: 'pending',
      orderStatus: 'pending',
      notes: null
    };

    try {
      const order = await createOrder(orderData).unwrap();
      
      // Backend returns full order object with order.id
      toast.success(`Order ${order.orderNumber} created successfully!`);
      
      // Navigate to checkout with order ID
      navigate(`/checkout/${order.id}`);
    } catch (err) {
      console.error("Order creation failed:", err);
      
      // Handle different error scenarios
      if (err.status === 401) {
        toast.error("Please login to place an order");
        navigate('/login');
      } else if (err.status === 400) {
        toast.error(err?.data?.message || "Invalid order data");
      } else {
        toast.error(err?.data?.message || "Failed to create order. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Modern Header */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <FaShoppingCart className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                Your Shopping Cart
              </h1>
              <p className="text-gray-600 mt-1">
                {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'} in your cart
              </p>
            </div>
          </div>
        </div>

        {cartItems.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-32 h-32 mx-auto mb-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-2xl">
              <FaShoppingCart className="w-16 h-16 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-gray-800 mb-4">Your cart is empty</h2>
            <p className="text-gray-600 text-lg mb-8">Looks like you haven't added anything yet.</p>
            <Link to="/allproducts">
              <button className="inline-flex items-center gap-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-8 py-4 rounded-2xl font-semibold hover:shadow-2xl transition-all duration-300 hover:scale-105">
                Start Shopping
                <FaArrowRight className="w-5 h-5" />
              </button>
            </Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-6">
              {cartItems.map((item, index) => (
                <CartItem
                  key={`cart-item-${item.id}-${index}`}
                  item={item}
                  onRemove={openRemoveModal}
                  onUpdateQuantity={updateItemQuantity}
                  onUpdateSize={updateItemSize}
                  onUpdateColors={updateItemColors}
                  isRemoving={removingItems.has(item.id)}
                />
              ))}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="sticky top-8">
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 border border-white/20 shadow-xl">
                  <h2 className="text-2xl font-bold text-gray-800 mb-6">Order Summary</h2>
                  
                  <div className="space-y-4 mb-6">
                    {/* Subtotal */}
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal ({totalItems} items)</span>
                      <span className="font-semibold">GH₵ {subtotal.toFixed(2)}</span>
                    </div>
                    
                    {/* Shipping */}
                    <div className="flex justify-between text-gray-600">
                      <span>Shipping</span>
                      {shippingPrice === 0 ? (
                        <span className="text-green-600 font-semibold">Free</span>
                      ) : (
                        <span className="font-semibold">GH₵ {shippingPrice.toFixed(2)}</span>
                      )}
                    </div>
                    
                    {/* Tax */}
                    <div className="flex justify-between text-gray-600">
                      <span>Tax (VAT {(TAX_RATE * 100).toFixed(1)}%)</span>
                      <span className="font-semibold">GH₵ {taxPrice.toFixed(2)}</span>
                    </div>
                    
                    {/* Discount if any */}
                    {shippingPrice === 0 && subtotal >= FREE_SHIPPING_THRESHOLD && (
                      <div className="flex justify-between text-green-600">
                        <span>Shipping Discount</span>
                        <span className="font-semibold">-GH₵ {STANDARD_SHIPPING_COST.toFixed(2)}</span>
                      </div>
                    )}
                    
                    <hr className="border-gray-200 my-4" />
                    
                    {/* Total */}
                    <div className="flex justify-between text-2xl font-bold text-gray-800">
                      <span>Total</span>
                      <span className="text-blue-600">GH₵ {totalPrice.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <button
                      onClick={placeOrderHandler}
                      disabled={isCreatingOrder || cartItems.length === 0}
                      className={`w-full py-4 rounded-2xl font-semibold text-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                        isCreatingOrder || cartItems.length === 0
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-2xl hover:scale-105'
                      }`}
                    >
                      {isCreatingOrder ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          Creating Order...
                        </>
                      ) : (
                        <>
                          Proceed to Checkout
                          <FaArrowRight className="w-5 h-5" />
                        </>
                      )}
                    </button>

                    <Link to="/products">
                      <button className="w-full border-2 border-gray-200 text-gray-600 py-4 rounded-2xl font-semibold hover:border-blue-300 hover:text-blue-600 transition-all duration-300">
                        Continue Shopping
                      </button>
                    </Link>
                  </div>

                  {/* Promo Section */}
                  {subtotal >= FREE_SHIPPING_THRESHOLD ? (
                    <div className="mt-6 p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                          <FaCheck className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-green-700 font-medium">Free shipping applied!</span>
                      </div>
                      <p className="text-sm text-green-600">You saved GH₵ {STANDARD_SHIPPING_COST.toFixed(2)} on shipping</p>
                    </div>
                  ) : (
                    <div className="mt-6 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                          <FaShoppingCart className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-blue-700 font-medium">Almost there!</span>
                      </div>
                      <p className="text-sm text-blue-600">
                        Add GH₵ {(FREE_SHIPPING_THRESHOLD - subtotal).toFixed(2)} more for free shipping
                      </p>
                      <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min((subtotal / FREE_SHIPPING_THRESHOLD) * 100, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Remove Confirmation Modal */}
        {showRemoveModal && itemToRemove && (
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={cancelRemove}
          >
            <div 
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl transform"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                  <FaTrash className="w-8 h-8 text-red-500" />
                </div>

                <h3 id="modal-title" className="text-2xl font-bold text-gray-800 mb-2">
                  Remove Item?
                </h3>

                <div className="flex items-center gap-4 bg-gray-50 rounded-2xl p-4 mb-6">
                  <img
                    src={itemToRemove.img}
                    alt={itemToRemove.title}
                    className="w-16 h-16 object-cover rounded-xl"
                  />
                  <div className="text-left">
                    <h4 className="font-semibold text-gray-800">{itemToRemove.title}</h4>
                    <p className="text-sm text-gray-500">
                      Size: {itemToRemove.size || 'Not selected'} | Qty: {itemToRemove.quantity}
                    </p>
                    <p className="text-lg font-bold text-blue-600">
                      GH₵ {(itemToRemove.price * itemToRemove.quantity).toFixed(2)}
                    </p>
                  </div>
                </div>

                <p className="text-gray-600 mb-8">
                  Are you sure you want to remove this item from your cart? This action cannot be undone.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={cancelRemove}
                    className="flex-1 py-3 px-6 border-2 border-gray-200 text-gray-600 rounded-2xl font-semibold hover:border-gray-300 hover:bg-gray-50 transition-all duration-300"
                  >
                    Keep Item
                  </button>
                  <button
                    onClick={() => handleRemoveItem(itemToRemove.id)}
                    className="flex-1 py-3 px-6 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-2xl font-semibold hover:from-red-600 hover:to-red-700 hover:shadow-lg transition-all duration-300"
                  >
                    Yes, Remove
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CartPage;