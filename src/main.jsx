import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { PayPalScriptProvider } from '@paypal/react-paypal-js';

import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css"
import { CartProvider } from './Context/CartContext'
// 🔹 import Provider and store
import { Provider } from 'react-redux'
import store from './store'

createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <PayPalScriptProvider deferLoading={true}>
      <CartProvider>
        <StrictMode>
          <App />
        </StrictMode>
      </CartProvider>
    </PayPalScriptProvider>
  </Provider>
)