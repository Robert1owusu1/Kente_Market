import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode } from "react";
import axios from "axios";
import { TAX_RATE, FREE_SHIPPING_THRESHOLD, STANDARD_SHIPPING_COST, calcTax, calcShipping } from "../utils/pricing";
import { useAppSelector } from "../store";

export interface CartItem {
  id: number | string;
  name?: string;
  title?: string;
  img?: string;
  price: number;
  basePrice?: number;
  quantity: number;
  selectedColor?: string | null;
  selectedSize?: string | null;
  /** Legacy field kept alongside `selectedSize` by the reducer (old carts). */
  size?: string | null;
  yards?: number | string | null;
  yardsAvailable?: (number | string)[];
  colors?: string[];
  colorsAvailable?: string[];
  sizes?: string[];
  threadTypes?: string[];
  dominantThread?: string | null;
  fabricType?: string;
  material?: string;
  productionTime?: string;
  category?: string;
  rating?: number;
  reviews?: number;
  isCustomizable?: boolean;
  vendorId?: number | string;
  vendorBusinessName?: string;
}

export interface CartPayload {
  id: number | string;
  name?: string;
  title?: string;
  img?: string;
  price?: number | string;
  basePrice?: number | string;
  quantity?: number;
  selectedColor?: string | null;
  selectedSize?: string | null;
  yards?: number | string | null;
  yardsAvailable?: (number | string)[] | null;
  colorsAvailable?: string[] | null;
  sizes?: string[] | null;
  threadTypes?: string[];
  dominantThread?: string;
  fabricType?: string;
  material?: string;
  productionTime?: string;
  category?: string;
  rating?: number;
  reviews?: number;
  isCustomizable?: boolean;
  vendorId?: number | string;
  vendorBusinessName?: string;
}

interface CartState {
  cartItems: CartItem[];
}

type CartAction =
  | { type: "ADD_TO_CART"; payload: CartPayload }
  | { type: "REMOVE_FROM_CART"; payload: { id: number | string } }
  | { type: "UPDATE_ITEM_QUANTITY"; payload: { id: number | string; quantity: number } }
  | { type: "UPDATE_ITEM_SIZE"; payload: { id: number | string; size: string } }
  | { type: "UPDATE_ITEM_YARDS"; payload: { id: number | string; yards: number | string } }
  | { type: "UPDATE_ITEM_COLORS"; payload: { id: number | string; colors: string[] } }
  | { type: "CLEAR_CART" }
  | { type: "LOAD_FROM_SERVER"; payload: CartItem[] };

interface CartContextValue {
  cartItems: CartItem[];
  addToCart: (product: CartPayload) => void;
  removeItem: (id: number | string) => void;
  updateItemQuantity: (id: number | string, quantity: number) => void;
  updateItemSize: (id: number | string, size: string) => void;
  updateItemYards: (id: number | string, yards: number | string) => void;
  updateItemColors: (id: number | string, colors: string[]) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
  getTax: (taxRate?: number) => number;
  getShipping: (threshold?: number, cost?: number) => number;
  getFinalTotal: (taxRate?: number) => number;
  cartCount: number;
}

const migrateCartItem = (item: CartItem): CartItem => {
  if (item.yards === undefined && (item.selectedSize || item.size)) {
    return { ...item, yards: item.selectedSize || item.size };
  }
  return item;
};

// Load cart from localStorage
const getInitialCart = (): CartState => {
  try {
    const storedCart = localStorage.getItem("cartItems");
    return storedCart
      ? { cartItems: (JSON.parse(storedCart) as CartItem[]).map(migrateCartItem) }
      : { cartItems: [] };
  } catch (error) {
    console.error("Error loading cart from localStorage:", error);
    return { cartItems: [] };
  }
};

// Reducer function
const cartReducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case "ADD_TO_CART": {
      const newItem = action.payload;
      const selectedYards =
        newItem.yards ??
        newItem.selectedSize ??
        newItem.yardsAvailable?.[0] ??
        newItem.sizes?.[0] ??
        null;
      // `selectedSize` is stored as a string (or null) so sizes and yardage
      // render/type identically wherever they are read.
      const selectedSize =
        newItem.selectedSize || (selectedYards === null ? null : String(selectedYards));

      const existingIndex = state.cartItems.findIndex(
        (item) =>
          item.id === newItem.id &&
          item.selectedColor === newItem.selectedColor &&
          (item.yards ?? item.selectedSize) === selectedYards
      );

      if (existingIndex !== -1) {
        return {
          ...state,
          cartItems: state.cartItems.map((item, i) =>
            i === existingIndex
              ? { ...item, quantity: item.quantity + (newItem.quantity || 1) }
              : item
          ),
        };
      }

      return {
        ...state,
        cartItems: [
          ...state.cartItems,
          {
            ...newItem,
            quantity: newItem.quantity || 1,
            price: Number(newItem.price) || 0,
            basePrice: Number(newItem.basePrice) || Number(newItem.price) || 0,
            selectedColor: newItem.selectedColor || newItem.colorsAvailable?.[0] || null,
            selectedSize,
            yards: selectedYards,
            yardsAvailable: newItem.yardsAvailable || newItem.sizes || [],
            colorsAvailable: newItem.colorsAvailable || [],
            sizes: newItem.sizes || [],
            threadTypes: newItem.threadTypes || [],
            dominantThread: newItem.dominantThread || null,
            fabricType: newItem.fabricType || newItem.material || "Cotton",
            material: newItem.material || newItem.fabricType || "Cotton",
            productionTime: newItem.productionTime || "3-5",
            category: newItem.category || "Product",
            rating: newItem.rating || 0,
            reviews: newItem.reviews || 0,
            isCustomizable: newItem.isCustomizable || false,
          },
        ],
      };
    }

    case "REMOVE_FROM_CART":
      return {
        ...state,
        cartItems: state.cartItems.filter((item) => item.id !== action.payload.id),
      };

    case "UPDATE_ITEM_QUANTITY":
      return {
        ...state,
        cartItems: state.cartItems.map((item) =>
          item.id === action.payload.id
            ? { ...item, quantity: Math.max(1, action.payload.quantity) }
            : item
        ),
      };

    case "UPDATE_ITEM_SIZE":
      return {
        ...state,
        cartItems: state.cartItems.map((item) =>
          item.id === action.payload.id
            ? { ...item, size: action.payload.size, selectedSize: action.payload.size, yards: action.payload.size }
            : item
        ),
      };

    case "UPDATE_ITEM_YARDS":
      return {
        ...state,
        cartItems: state.cartItems.map((item) =>
          item.id === action.payload.id
            ? { ...item, yards: action.payload.yards, selectedSize: String(action.payload.yards) }
            : item
        ),
      };

    case "UPDATE_ITEM_COLORS":
      return {
        ...state,
        cartItems: state.cartItems.map((item) =>
          item.id === action.payload.id
            ? {
                ...item,
                colors: action.payload.colors,
                selectedColor: action.payload.colors[0] || null,
              }
            : item
        ),
      };

    case "CLEAR_CART":
      return { ...state, cartItems: [] };

    case "LOAD_FROM_SERVER":
      return { ...state, cartItems: (Array.isArray(action.payload) ? action.payload : []).map(migrateCartItem) };

    default:
      return state;
  }
};

const CartContext = createContext<CartContextValue | null>(null);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(cartReducer, getInitialCart());

  // Save to localStorage whenever cart changes
  useEffect(() => {
    try {
      localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
    } catch (error) {
      console.error("Error saving cart to localStorage:", error);
    }
  }, [state.cartItems]);

  // Server-side cart sync: keeps the server copy in sync for cross-device
  // continuity and abandoned-cart recovery emails. Only active for signed-in
  // users (guests use localStorage alone). All calls are fire-and-forget so a
  // network failure never blocks the local cart experience.
  const userInfo = useAppSelector((state) => state.auth.userInfo);
  const loggedIn = !!userInfo?.id;

  // Mirror of the current cart for the sync effect below: reading it through a
  // ref keeps the effect's dependency list at [loggedIn] (as intended — we only
  // re-sync on sign-in/out) without tripping exhaustive-deps.
  const cartItemsRef = useRef(state.cartItems);
  useEffect(() => {
    cartItemsRef.current = state.cartItems;
  }, [state.cartItems]);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get('/api/cart');
        const serverItems = Array.isArray(data.items) ? data.items : [];
        if (cancelled) return;
        if (cartItemsRef.current.length === 0 && serverItems.length > 0) {
          dispatch({ type: 'LOAD_FROM_SERVER', payload: serverItems });
        } else if (cartItemsRef.current.length > 0) {
          await axios.post('/api/cart', { items: cartItemsRef.current });
        }
      } catch { /* silent — local cart is always the source of truth */ }
    })();
    return () => { cancelled = true; };
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;
    const id = setTimeout(() => {
      // Fire-and-forget: attach a rejection handler so a failed sync can never
      // surface as an unhandled promise rejection.
      axios.post('/api/cart', { items: state.cartItems }).catch(() => { /* silent */ });
    }, 1500);
    return () => clearTimeout(id);
  }, [state.cartItems, loggedIn]);

  // Actions
  const addToCart = (product: CartPayload) => {
    dispatch({ type: "ADD_TO_CART", payload: product });
  };

  const removeItem = (id: number | string) => {
    dispatch({ type: "REMOVE_FROM_CART", payload: { id } });
  };

  const updateItemQuantity = (id: number | string, quantity: number) => {
    dispatch({ type: "UPDATE_ITEM_QUANTITY", payload: { id, quantity } });
  };

  const updateItemSize = (id: number | string, size: string) => {
    dispatch({ type: "UPDATE_ITEM_SIZE", payload: { id, size } });
  };

  const updateItemYards = (id: number | string, yards: number | string) => {
    dispatch({ type: "UPDATE_ITEM_YARDS", payload: { id, yards } });
  };

  const updateItemColors = (id: number | string, colors: string[]) => {
    dispatch({ type: "UPDATE_ITEM_COLORS", payload: { id, colors } });
  };

  const clearCart = () => {
    dispatch({ type: "CLEAR_CART" });
    if (loggedIn) {
      // Fire-and-forget with a rejection handler so failures stay silent.
      axios.delete('/api/cart').catch(() => { /* silent */ });
    }
  };

  // Helpers (pricing rules live in shared/pricing.js so cart, cart drawer and
  // checkout all agree)
  const getTotalPrice = () =>
    state.cartItems.reduce((total, item) => total + item.price * item.quantity, 0);

  const getTax = (taxRate = TAX_RATE) => calcTax(getTotalPrice(), taxRate);

  const getShipping = (
    threshold = FREE_SHIPPING_THRESHOLD,
    cost = STANDARD_SHIPPING_COST
  ) => calcShipping(getTotalPrice(), threshold, cost);

  const getFinalTotal = (taxRate = TAX_RATE) =>
    getTotalPrice() + getTax(taxRate) + getShipping();

  const cartCount = state.cartItems.reduce(
    (count, item) => count + (Number(item.quantity) || 0),
    0
  );

  return (
    <CartContext.Provider
      value={{
        cartItems: state.cartItems,
        addToCart,
        removeItem,
        updateItemQuantity,
        updateItemSize,
        updateItemYards,
        updateItemColors,
        clearCart,
        getTotalPrice,
        getTax,
        getShipping,
        getFinalTotal,
        cartCount,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useCart = (): CartContextValue => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
};