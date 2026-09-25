// utils/sessionExpiry.ts
// Shared 401 handling for BOTH request paths: the raw axios instance in
// main.tsx and the RTK Query fetchFn in slices/apiSlice.ts. A 401 means the
// session cookie/JWT is missing, expired or revoked, so the local session is
// cleared — otherwise the UI keeps rendering a signed-in user that every API
// call rejects.
//
// No static import of the store here: apiSlice imports this file and the store
// imports apiSlice, so a static `import store from '../store'` would create a
// circular dependency that crashes module evaluation. The store is loaded
// lazily instead.
import { logout } from '../slices/authSlice';

// Endpoints that answer 401 by design: a failed login (POST /api/users/auth)
// or a rejected registration (POST /api/users). These must never clear an
// existing session — only credential-less calls are exempt (a GET against the
// same paths is a real session failure and still logs out).
const AUTH_ATTEMPT_PATHS = ['/api/users/auth', '/api/users'];

// When a session expires, RTK Query fires many requests at once and they all
// come back 401: clear the session on the first one only. The handler never
// issues a request of its own, so it cannot loop either.
const BURST_WINDOW_MS = 2000;
let lastHandledAt = 0;

const getPathname = (url?: string): string | null => {
  if (!url) return null;
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return null;
  }
};

/**
 * Call once per 401 response. Safe to call many times: login/register
 * attempts are ignored and only the first 401 of a burst dispatches logout.
 */
export const handleUnauthorized = (url?: string, method?: string): void => {
  const pathname = getPathname(url);
  const verb = (method || 'GET').toUpperCase();
  if (pathname && verb === 'POST' && AUTH_ATTEMPT_PATHS.includes(pathname)) return;

  const now = Date.now();
  if (now - lastHandledAt < BURST_WINDOW_MS) return;
  lastHandledAt = now;

  // logout() also removes localStorage.userInfo; remove it first so the PII is
  // gone even if the (lazy) store import somehow fails.
  try {
    localStorage.removeItem('userInfo');
  } catch {
    /* storage unavailable */
  }
  void import('../store')
    .then(({ default: store }) => {
      store.dispatch(logout());
    })
    .catch((err) => console.error('Session cleanup after 401 failed:', err));
};
