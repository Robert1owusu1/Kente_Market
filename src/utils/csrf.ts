// FILE LOCATION: src/utils/csrf.ts
// DESCRIPTION: Reads the signed double-submit CSRF cookie set by the API at
// login/OAuth (csrf_token, non-HttpOnly so the SPA can echo it). Every
// state-changing request must echo it in the X-CSRF-Token header; the backend
// middleware (backend/middleware/csrfMiddleware.js) only enforces this for
// requests that actually carry the cookie (i.e. an authenticated session).

export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "X-CSRF-Token";

/** Returns the current csrf_token cookie value, or null if absent. */
export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + CSRF_COOKIE + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/** True for methods that never change state and therefore need no CSRF token. */
export function isSafeMethod(method?: string): boolean {
  const m = (method || "").toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}