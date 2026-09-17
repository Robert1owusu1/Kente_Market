import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

import { CartProvider } from './Context/CartContext'
// 🔹 import Provider and store
import { Provider } from 'react-redux'
import store from './store'
// Point raw axios calls (e.g. "/api/orders/...") at the API origin when the
// frontend and API are hosted separately (Vercel + Render). RTK-Query uses its
// own fetch baseQuery and is not affected. withCredentials keeps the JWT cookie
// flowing on cross-origin requests.
import axios from 'axios'
import { Base_URL } from './constant'
import { getCsrfToken, isSafeMethod, CSRF_HEADER } from './utils/csrf'

axios.defaults.baseURL = Base_URL || undefined
axios.defaults.withCredentials = true

// Echo the signed double-submit CSRF token on every state-changing request.
// Safe to send always: the backend only validates it when a session cookie is
// present, and the token is useless alone (attacker pages cannot read it).
axios.interceptors.request.use((config) => {
  if (!isSafeMethod(config.method)) {
    const token = getCsrfToken();
    if (token) config.headers.set(CSRF_HEADER, token);
  }
  return config;
});

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