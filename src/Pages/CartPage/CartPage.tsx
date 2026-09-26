import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useCart, type CartItem } from "../../Context/CartContext";
import { Link, useNavigate } from "react-router-dom";
import { FaShoppingCart, FaMinus, FaPlus, FaTrash, FaArrowRight, FaStar, FaCheck } from "react-icons/fa";
import { useCreateOrderMutation } from "../../slices/ordersApiSlice";
import { toast } from "react-toastify";
import { TAX_RATE, FREE_SHIPPING_THRESHOLD, STANDARD_SHIPPING_COST, calcOrderTotals } from "../../utils/pricing";
import { resolveImageUrl } from "../../utils/imageUrl";

const COLOR_MAP: Record<string, string> = {
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

// The cart reducer persists a legacy `size` field (set alongside `selectedSize`)
// that is NOT part of the CartContext.CartItem interface, so add it back here.
type CartLine = CartItem & { size?: string | null };

interface CartItemProps {
  item: CartLine;
  onRemove: (item: CartLine) => void;
  onUpdateQuantity: (id: number | string, quantity: number) => void;
  onUpdateYards: (id: number | string, yards: number | string) => void;
  onUpdateColors: (id: number | string, colors: string[]) => void;
  isRemoving: boolean;
}

// Memoized Cart Item Component
const CartItem = React.memo(({ item, onRemove, onUpdateQuantity, onUpdateYards, onUpdateColors, isRemoving }: CartItemProps) => {
  return (
    <div
      className={`group rounded-3xl border border-gray-200/80 bg-white/90 p-4 shadow-lg backdrop-blur-xl transition-all duration-300 hover:shadow-xl dark:border-gray-700 dark:bg-gray-800/90 sm:p-6 ${
        isRemoving ? 'animate-pulse opacity-50 scale-95' : ''
      }`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        {/* Product Image & Info */}
        <div className="flex min-w-0 w-full items-start gap-3 sm:gap-4 lg:w-2/3">
          <div className="relative flex-shrink-0">
            <div className="h-20 w-20 overflow-hidden rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 shadow-lg sm:h-32 sm:w-32 dark:from-gray-700 dark:to-gray-800">
              <img
                src={resolveImageUrl(item.img)}
                alt={item.title || "Cart item"}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
                decoding="async"
                onError={(e) => { const target = e.target as HTMLImageElement; target.onerror = null; target.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect fill="#f4eee1" width="150" height="150"/><text x="75" y="80" font-family="sans-serif" font-size="14" fill="#8a6d3b" text-anchor="middle">Kente</text></svg>'); }}
              />
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <h4 className="line-clamp-2 text-base font-bold leading-snug text-gray-800 transition-colors duration-300 dark:text-white sm:text-xl">
                {item.title}
              </h4>
              {/* Real rating only — never fabricate a score for unrated items */}
              {Number(item.rating) > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex" role="img" aria-label={`${Number(item.rating)} out of 5 stars`}>
                    {[...Array(5)].map((_, i) => (
                      <FaStar
                        key={`${item.id}-star-${i}`}
                        className={`w-3 h-3 sm:w-4 sm:h-4 ${i < Math.floor(Number(item.rating)) ? 'text-yellow-400' : 'text-gray-300'}`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">({Number(item.rating).toFixed(1)})</span>
                </div>
              )}
              <p className="mt-2 text-lg font-bold text-primary sm:text-2xl">
                GH₵ {Number(item.price).toFixed(2)}
              </p>
            </div>

            {/* Yards selection */}
            {(item.yardsAvailable || (item.sizes && item.sizes.length > 0)) && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600 dark:text-gray-300">Yards</label>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Yards selection">
                  {(item.yardsAvailable || item.sizes || []).map((yd) => (
                    <button
                      key={`${item.id}-yards-${yd}`}
                      onClick={() => onUpdateYards(item.id, String(yd))}
                      className={`h-10 min-w-10 rounded-xl border-2 px-3 text-sm font-medium transition-all duration-300 sm:h-12 sm:min-w-12 ${
                        (item.yards ?? item.size) === String(yd)
                          ? 'border-blue-500 bg-blue-500 text-white shadow-lg'
                          : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-700'
                      }`}
                      aria-label={`${yd} yards`}
                      aria-pressed={(item.yards ?? item.size) === String(yd)}
                    >
                      {yd}
                    </button>
                  ))}
                </div>
                {!(item.yards ?? item.size) && (
                  <p className="text-xs text-amber-600 font-medium" role="alert">
                    Please select your yards
                  </p>
                )}
              </div>
            )}

            {/* Color selection */}
            {item.colorsAvailable && item.colorsAvailable.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600 dark:text-gray-300">Color</label>
                <div className="flex flex-wrap gap-3" role="group" aria-label="Color selection">
                  {item.colorsAvailable.map((color) => {
                    const isSelected = item.colors?.[0] === color;
                    return (
                      <button
                        key={`${item.id}-color-${color}`}
                        onClick={() => onUpdateColors(item.id, [color])}
                        className={`relative h-10 w-10 rounded-full border-4 transition-all duration-300 hover:scale-110 sm:h-12 sm:w-12 ${
                          isSelected ? 'border-blue-500 shadow-lg' : 'border-gray-200 dark:border-gray-600'
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
        <div className="flex w-full flex-row items-center justify-between gap-3 border-t border-gray-100 pt-4 lg:w-1/3 lg:flex-col lg:items-end lg:border-t-0 lg:pt-0 dark:border-gray-700">
          <div className="flex items-center rounded-2xl bg-gray-100 p-1 dark:bg-gray-700" role="group" aria-label="Quantity controls">
            <button
              onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
              className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-xl hover:bg-white hover:shadow-md transition-all duration-300 dark:hover:bg-gray-600"
              aria-label="Decrease quantity"
              disabled={item.quantity <= 1}
            >
              <FaMinus className="w-4 h-4" />
            </button>
            <span className="w-12 sm:w-16 text-center font-bold text-lg" aria-label={`Quantity: ${item.quantity}`}>
              {item.quantity}
            </span>
            <button
              onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
              className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-xl hover:bg-white hover:shadow-md transition-all duration-300 dark:hover:bg-gray-600"
              aria-label="Increase quantity"
            >
              <FaPlus className="w-4 h-4" />
            </button>
          </div>
          
          <div className="text-right">
            <p className="text-sm text-gray-600 dark:text-gray-300">Subtotal</p>
            <p className="text-lg font-bold text-gray-800 dark:text-white sm:text-2xl">
              GH₵ {(Number(item.price) * item.quantity).toFixed(2)}
            </p>
          </div>

          <button
            onClick={() => onRemove(item)}
            className="flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-red-500 transition-all duration-300 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20 dark:hover:text-red-400 sm:px-4"
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
    updateItemYards,
    updateItemColors,
    getTotalPrice,
  } = useCart();

  const [createOrder, { isLoading: isCreatingOrder }] = useCreateOrderMutation();
  const navigate = useNavigate();
  
  const [removingItems, setRemovingItems] = useState<Set<number | string>>(new Set());
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [itemToRemove, setItemToRemove] = useState<CartLine | null>(null);

  // Memoize calculations
  const subtotal = useMemo(() => getTotalPrice(), [getTotalPrice]);
  const { tax: taxPrice, shipping: shippingPrice, total: totalPrice } = useMemo(
    () => calcOrderTotals(cartItems),
    [cartItems]
  );
  const totalItems = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  const handleRemoveItem = useCallback(async (id: number | string) => {
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

  const openRemoveModal = useCallback((item: CartLine) => {
    setItemToRemove(item);
    setShowRemoveModal(true);
  }, []);

  const cancelRemove = useCallback(() => {
    setShowRemoveModal(false);
    setItemToRemove(null);
  }, []);

  useEffect(() => {
    if (!showRemoveModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRemove();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showRemoveModal, cancelRemove]);

  const placeOrderHandler = async () => {
    if (cartItems.length === 0) {
      toast.error("Your cart is empty!");
      return;
    }

    // Validation - check for incomplete selections
    const orderItems = cartItems as CartLine[];
    const hasIncompleteItems = orderItems.some(item => 
      ((item.yardsAvailable || (item.sizes && item.sizes.length > 0)) && !(item.yards ?? item.size)) ||
      (item.colorsAvailable && item.colorsAvailable.length > 0 && (!item.colors || item.colors.length === 0))
    );

    if (hasIncompleteItems) {
      toast.error("Please select yards and color for all items before proceeding!");
      return;
    }

    // Prepare order data matching backend structure exactly
    const orderData = {
      items: orderItems.map(item => ({
        name: item.title,
        qty: item.quantity,
        image: item.img,
        price: item.price,
        product: item.id,
        yards: item.yards ?? item.size ?? null,
        size: item.yards ?? item.size ?? null,
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
      const result = await createOrder(orderData).unwrap();
      
      // Backend returns { message, order: newOrder }. Unwrap to the nested order
      // so orderNumber/id are real values (previously reading them off the
      // wrapper caused "Order undefined" toasts and a /checkout/undefined route).
      const createdOrder = (result as { order?: unknown } & Record<string, unknown>)?.order ?? result?.['order'];
      const orderId = (createdOrder as { id?: unknown } | undefined)?.id;
      const orderNumber = (createdOrder as { orderNumber?: unknown } | undefined)?.orderNumber;

      toast.success(`Order ${orderNumber ?? 'paid'} created successfully!`);
      
      // Navigate to checkout with order ID
      navigate(`/checkout/${orderId ?? ''}`);
    } catch (err) {
      const apiErr = err as { status?: number | string; data?: { message?: string } } | undefined;
      console.error("Order creation failed:", err);
      
      // Handle different error scenarios
      if (apiErr?.status === 401) {
        toast.error("Please login to place an order");
        navigate('/login');
      } else if (apiErr?.status === 400) {
        toast.error(apiErr?.data?.message || "Invalid order data");
      } else {
        toast.error(apiErr?.data?.message || "Failed to create order. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 pb-20 dark:from-gray-950 dark:via-gray-900 dark:to-gray-800 sm:pb-8">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        {/* Modern Header */}
        <div className="mb-8 sm:mb-10">
          <div className="mb-6 flex items-center gap-3 sm:gap-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary shadow-lg sm:h-14 sm:w-14">
              <FaShoppingCart className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            </div>
            <div>
              <h1 className="bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-2xl font-bold leading-tight text-transparent dark:from-white dark:to-gray-300 sm:text-4xl">
                Your Shopping Cart
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 sm:text-base">
                {totalItems} {totalItems === 1 ? 'item' : 'items'} in your cart
              </p>
            </div>
          </div>
        </div>

        {cartItems.length === 0 ? (
          <div className="rounded-3xl border border-white/60 bg-white/70 px-5 py-16 text-center shadow-xl backdrop-blur-xl dark:border-gray-700 dark:bg-gray-800/70 sm:py-24">
            <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary shadow-2xl sm:h-32 sm:w-32">
              <FaShoppingCart className="h-12 w-12 text-white sm:h-16 sm:w-16" />
            </div>
            <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-white sm:text-3xl">Your cart is empty</h2>
            <p className="mb-8 text-base text-gray-600 dark:text-gray-300 sm:text-lg">Looks like you haven't added anything yet.</p>
            <Link
              to="/products"
              className="inline-flex min-h-[52px] items-center gap-3 rounded-2xl bg-gradient-to-r from-primary to-secondary px-8 py-4 font-semibold text-white transition-all duration-300 hover:shadow-2xl hover:scale-105"
            >
                Start Shopping
                <FaArrowRight className="w-5 h-5" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
            {/* Cart Items */}
            <div className="space-y-4 lg:col-span-2 lg:space-y-6">
              {cartItems.map((item, index) => (
                <CartItem
                  key={`cart-item-${item.id}-${index}`}
                  item={item}
                  onRemove={openRemoveModal}
                  onUpdateQuantity={updateItemQuantity}
                  onUpdateYards={updateItemYards}
                  onUpdateColors={updateItemColors}
                  isRemoving={removingItems.has(item.id)}
                />
              ))}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="sticky top-8">
                <div className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-xl backdrop-blur-xl dark:border-gray-700 dark:bg-gray-800/85 sm:p-8">
                  <div className="mb-6 flex items-center justify-between gap-4">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white sm:text-2xl">Order Summary</h2>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      {totalItems} {totalItems === 1 ? "item" : "items"}
                    </span>
                  </div>
                  
                  <div className="space-y-4 mb-6">
                    {/* Subtotal */}
                    <div className="flex justify-between text-gray-600 dark:text-gray-300">
                      <span>Subtotal</span>
                      <span className="font-semibold">GH₵ {subtotal.toFixed(2)}</span>
                    </div>
                    
                    {/* Shipping */}
                    <div className="flex justify-between text-gray-600 dark:text-gray-300">
                      <span>Shipping</span>
                      {shippingPrice === 0 ? (
                        <span className="text-green-600 font-semibold">Free</span>
                      ) : (
                        <span className="font-semibold">GH₵ {shippingPrice.toFixed(2)}</span>
                      )}
                    </div>
                    
                    {/* Tax */}
                    <div className="flex justify-between text-gray-600 dark:text-gray-300">
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
                    
                    <hr className="border-gray-200 my-4 dark:border-gray-700" />
                    
                    {/* Total */}
                    <div className="flex justify-between text-2xl font-bold text-gray-800 dark:text-white">
                      <span>Total</span>
                      <span className="text-blue-600 dark:text-blue-400">GH₵ {totalPrice.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <button
                      onClick={placeOrderHandler}
                      disabled={isCreatingOrder || cartItems.length === 0}
                      className={`flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold transition-all duration-300 sm:text-lg ${
                        isCreatingOrder || cartItems.length === 0
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/20 hover:shadow-2xl hover:scale-[1.02]'
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

                    <Link
                      to="/products"
                      className="flex min-h-[54px] w-full items-center justify-center rounded-2xl border-2 border-gray-200 py-4 font-semibold text-gray-600 transition-all duration-300 hover:border-primary hover:text-primary dark:border-gray-700 dark:text-gray-300 dark:hover:border-primary dark:hover:text-primary"
                    >
                        Continue Shopping
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
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={cancelRemove}
          >
            <div 
              className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                  <FaTrash className="w-8 h-8 text-red-500" />
                </div>

                <h3 id="modal-title" className="mb-2 text-2xl font-bold text-gray-800 dark:text-white">
                  Remove Item?
                </h3>

                <div className="mb-6 flex items-center gap-4 rounded-2xl bg-gray-50 p-4 text-left dark:bg-gray-700">
                  <img
                    src={resolveImageUrl(itemToRemove.img)}
                    alt={itemToRemove.title || "Cart item"}
                    loading="lazy"
                    decoding="async"
                    className="w-16 h-16 object-cover rounded-xl"
                  />
                  <div className="text-left">
                    <h4 className="line-clamp-2 font-semibold text-gray-800 dark:text-white">{itemToRemove.title}</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Yards: {itemToRemove.yards ?? itemToRemove.size ?? 'Not selected'} | Qty: {itemToRemove.quantity}
                    </p>
                    <p className="text-lg font-bold text-primary">
                      GH₵ {(Number(itemToRemove.price) * itemToRemove.quantity).toFixed(2)}
                    </p>
                  </div>
                </div>

                <p className="mb-8 text-gray-600 dark:text-gray-300">
                  Are you sure you want to remove this item from your cart? This action cannot be undone.
                </p>

                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                  <button
                    onClick={cancelRemove}
                    className="min-h-12 flex-1 rounded-2xl border-2 border-gray-200 px-6 py-3 font-semibold text-gray-600 transition-all duration-300 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-700"
                  >
                    Keep Item
                  </button>
                  <button
                    onClick={() => handleRemoveItem(itemToRemove.id)}
                    className="min-h-12 flex-1 rounded-2xl bg-gradient-to-r from-red-500 to-red-600 px-6 py-3 font-semibold text-white transition-all duration-300 hover:from-red-600 hover:to-red-700 hover:shadow-lg"
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