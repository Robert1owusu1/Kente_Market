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
import { getOrLoadCsrfToken, isSafeMethod, CSRF_HEADER } from './utils/csrf'
import { handleUnauthorized } from './utils/sessionExpiry'
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary'

axios.defaults.baseURL = Base_URL || undefined
axios.defaults.withCredentials = true

// Echo the signed double-submit CSRF token on every state-changing request.
// Safe to send always: the backend only validates it when a session cookie is
// present, and the token is useless alone (attacker pages cannot read it).
// The token comes from /api/auth/csrf-token (document.cookie can't see the
// host-only cookie on the API origin) and is cached in memory.
axios.interceptors.request.use(async (config) => {
  if (!isSafeMethod(config.method)) {
    const token = await getOrLoadCsrfToken();
    if (token) config.headers.set(CSRF_HEADER, token);
  }
  return config;
});

// Global 401 handling: any raw axios call answered 401 means the session is
// gone (expired/revoked cookie), so the local session is cleared too — the UI
// must never keep showing a signed-in user the API rejects. Login/register
// attempts are filtered out inside handleUnauthorized, which also collapses a
// burst of parallel 401s into a single logout (and never re-issues a request,
// so it cannot loop). The RTK Query path is covered in slices/apiSlice.ts.
axios.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const config = (error as { config?: { url?: string; method?: string } } | undefined)?.config;
    const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
    if (status === 401) handleUnauthorized(config?.url, config?.method);
    return Promise.reject(error);
  }
);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');
createRoot(rootElement).render(
  // Outermost boundary: catches render errors thrown inside <Provider> /
  // <CartProvider> themselves (App.tsx has its own inner boundary for
  // route-level failures, so the closest boundary always handles those).
  <ErrorBoundary>
    <Provider store={store}>
      <CartProvider>
        <StrictMode>
          <App />
        </StrictMode>
      </CartProvider>
    </Provider>
  </ErrorBoundary>
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