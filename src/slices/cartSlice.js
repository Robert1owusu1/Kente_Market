import { createSlice } from "@reduxjs/toolkit";

// Helper function to safely parse localStorage
const getCartItemsFromStorage = () => {
  try {
    const cartItems = localStorage.getItem("cartItems");
    return cartItems ? JSON.parse(cartItems) : [];
  } catch (error) {
    console.error("Error parsing cart items from localStorage:", error);
    localStorage.removeItem("cartItems"); // Clear corrupted data
    return [];
  }
};

// Helper function to safely save to localStorage
const saveToLocalStorage = (items) => {
  try {
    localStorage.setItem("cartItems", JSON.stringify(items));
  } catch (error) {
    console.error("Error saving cart items to localStorage:", error);
  }
};

const initialState = {
  cartItems: getCartItemsFromStorage(),
  shippingAddress: {},
  paymentMethod: "PayPal",
  itemsPrice: 0,
  shippingPrice: 0,
  taxPrice: 0,
  totalPrice: 0,
};

const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    addToCart: (state, action) => {
      const newItem = action.payload;

      // Validate required fields
      if (!newItem.id || !newItem.name || !newItem.price) {
        console.error("Invalid item data:", newItem);
        return;
      }

      const existingItem = state.cartItems.find(
        (item) =>
          item.id === newItem.id &&
          item.selectedColor === newItem.selectedColor &&
          item.selectedSize === newItem.selectedSize
      );

      if (existingItem) {
        existingItem.quantity += newItem.quantity || 1;
      } else {
        state.cartItems.push({
          ...newItem,
          quantity: newItem.quantity || 1,
        });
      }

      // Update cart totals
      cartSlice.caseReducers.updateCartTotals(state);
      saveToLocalStorage(state.cartItems);
    },

    removeFromCart: (state, action) => {
      const { id, selectedColor, selectedSize } = action.payload;
      
      state.cartItems = state.cartItems.filter(
        (item) => 
          !(item.id === id && 
            item.selectedColor === selectedColor && 
            item.selectedSize === selectedSize)
      );
      
      cartSlice.caseReducers.updateCartTotals(state);
      saveToLocalStorage(state.cartItems);
    },

    updateCartItemQuantity: (state, action) => {
      const { id, selectedColor, selectedSize, quantity } = action.payload;
      
      if (quantity <= 0) {
        // Remove item if quantity is 0 or negative
        state.cartItems = state.cartItems.filter(
          (item) => 
            !(item.id === id && 
              item.selectedColor === selectedColor && 
              item.selectedSize === selectedSize)
        );
      } else {
        const existingItem = state.cartItems.find(
          (item) =>
            item.id === id &&
            item.selectedColor === selectedColor &&
            item.selectedSize === selectedSize
        );
        
        if (existingItem) {
          existingItem.quantity = quantity;
        }
      }
      
      cartSlice.caseReducers.updateCartTotals(state);
      saveToLocalStorage(state.cartItems);
    },

    clearCart: (state) => {
      state.cartItems = [];
      state.itemsPrice = 0;
      state.shippingPrice = 0;
      state.taxPrice = 0;
      state.totalPrice = 0;
      saveToLocalStorage(state.cartItems);
    },

    saveShippingAddress: (state, action) => {
      state.shippingAddress = action.payload;
      
      // Save shipping address to localStorage
      try {
        localStorage.setItem("shippingAddress", JSON.stringify(action.payload));
      } catch (error) {
        console.error("Error saving shipping address:", error);
      }
    },

    savePaymentMethod: (state, action) => {
      state.paymentMethod = action.payload;
      
      // Save payment method to localStorage
      try {
        localStorage.setItem("paymentMethod", JSON.stringify(action.payload));
      } catch (error) {
        console.error("Error saving payment method:", error);
      }
    },

    // Helper reducer to calculate cart totals
    updateCartTotals: (state) => {
      // Calculate items price
      state.itemsPrice = Number(
        state.cartItems
          .reduce((acc, item) => acc + item.price * item.quantity, 0)
          .toFixed(2)
      );

      // Calculate shipping price (free shipping over $100)
      state.shippingPrice = Number(
        (state.itemsPrice > 100 ? 0 : 10).toFixed(2)
      );

      // Calculate tax price (15% tax rate)
      state.taxPrice = Number(
        (0.15 * state.itemsPrice).toFixed(2)
      );

      // Calculate total price
      state.totalPrice = Number(
        (state.itemsPrice + state.shippingPrice + state.taxPrice).toFixed(2)
      );
    },

    // Load saved data from localStorage
    loadCartFromStorage: (state) => {
      state.cartItems = getCartItemsFromStorage();
      
      try {
        const savedShippingAddress = localStorage.getItem("shippingAddress");
        if (savedShippingAddress) {
          state.shippingAddress = JSON.parse(savedShippingAddress);
        }
        
        const savedPaymentMethod = localStorage.getItem("paymentMethod");
        if (savedPaymentMethod) {
          state.paymentMethod = JSON.parse(savedPaymentMethod);
        }
      } catch (error) {
        console.error("Error loading cart data from localStorage:", error);
      }
      
      cartSlice.caseReducers.updateCartTotals(state);
    },
  },
});

export const {
  addToCart,
  removeFromCart,
  updateCartItemQuantity,
  clearCart,
  saveShippingAddress,
  savePaymentMethod,
  updateCartTotals,
  loadCartFromStorage,
} = cartSlice.actions;

// Selectors for easy state access
export const selectCartItems = (state) => state.cart.cartItems;
export const selectCartItemsCount = (state) => 
  state.cart.cartItems.reduce((total, item) => total + item.quantity, 0);
export const selectCartTotal = (state) => state.cart.totalPrice;
export const selectShippingAddress = (state) => state.cart.shippingAddress;
export const selectPaymentMethod = (state) => state.cart.paymentMethod;

export default cartSlice.reducer;