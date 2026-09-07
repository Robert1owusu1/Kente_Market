import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

import { CartProvider } from './Context/CartContext'
// 🔹 import Provider and store
import { Provider } from 'react-redux'
import store from './store'

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');
createRoot(rootElement).render(
  <Provider store={store}>
    <CartProvider>
      <StrictMode>
        <App />
      </StrictMode>
    </CartProvider>
  </Provider>
)

// Register the offline-first service worker ONLY in production builds. In dev
// the service worker would fight Vite's HMR and stale-cache the modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for updates on each load so new deploys get picked up promptly.
        reg.update();
      })
      .catch((err) => console.error('SW registration failed:', err));
  });
}