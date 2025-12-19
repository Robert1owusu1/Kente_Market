import { createContext, useContext, useReducer, useEffect } from "react";

// Load cart from localStorage
const getInitialCart = () => {
  try {
    const storedCart = localStorage.getItem("cartItems");
    return storedCart ? { cartItems: JSON.parse(storedCart) } : { cartItems: [] };
  } catch (error) {
    console.error("Error loading cart from localStorage:", error);
    return { cartItems: [] };
  }
};

// Reducer function
const cartReducer = (state, action) => {
  switch (action.type) {
    case "ADD_TO_CART": {
      const newItem = action.payload;

      const existingIndex = state.cartItems.findIndex(item =>
        item.id === newItem.id &&
        item.selectedColor === newItem.selectedColor &&
        item.selectedSize === newItem.selectedSize
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
            selectedSize: newItem.selectedSize || newItem.sizes?.[0] || null,
            colorsAvailable: newItem.colorsAvailable || [],
            sizes: newItem.sizes || [],
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
        cartItems: state.cartItems.filter(item => item.id !== action.payload.id),
      };

    case "UPDATE_ITEM_QUANTITY":
      return {
        ...state,
        cartItems: state.cartItems.map(item =>
          item.id === action.payload.id
            ? { ...item, quantity: Math.max(1, action.payload.quantity) }
            : item
        ),
      };

    case "UPDATE_ITEM_SIZE":
      return {
        ...state,
        cartItems: state.cartItems.map(item =>
          item.id === action.payload.id
            ? { ...item, size: action.payload.size, selectedSize: action.payload.size }
            : item
        ),
      };

    case "UPDATE_ITEM_COLORS":
      return {
        ...state,
        cartItems: state.cartItems.map(item =>
          item.id === action.payload.id
            ? { 
                ...item, 
                colors: action.payload.colors,
                selectedColor: action.payload.colors[0] || null 
              }
            : item
        ),
      };

    case "CLEAR_CART":
      return { ...state, cartItems: [] };

    default:
      return state;
  }
};

const CartContext = createContext();

export const CartProvider = ({ children }) => {
  const [state, dispatch] = useReducer(cartReducer, getInitialCart());

  // Save to localStorage whenever cart changes
  useEffect(() => {
    try {
      localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
    } catch (error) {
      console.error("Error saving cart to localStorage:", error);
    }
  }, [state.cartItems]);

  // Actions
  const addToCart = (product) => {
    dispatch({ type: "ADD_TO_CART", payload: product });
  };

  const removeItem = (id) => {
    dispatch({ type: "REMOVE_FROM_CART", payload: { id } });
  };

  const updateItemQuantity = (id, quantity) => {
    dispatch({ type: "UPDATE_ITEM_QUANTITY", payload: { id, quantity } });
  };

  const updateItemSize = (id, size) => {
    dispatch({ type: "UPDATE_ITEM_SIZE", payload: { id, size } });
  };

  const updateItemColors = (id, colors) => {
    dispatch({ type: "UPDATE_ITEM_COLORS", payload: { id, colors } });
  };

  const clearCart = () => {
    dispatch({ type: "CLEAR_CART" });
  };

  // Helpers
  const getTotalPrice = () =>
    state.cartItems.reduce((total, item) => total + item.price * item.quantity, 0);

  const getTax = (taxRate = 0.1) => getTotalPrice() * taxRate;

  const getShipping = () => (getTotalPrice() > 50 ? 0 : 5);

  const getFinalTotal = (taxRate = 0.1) =>
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
export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
};