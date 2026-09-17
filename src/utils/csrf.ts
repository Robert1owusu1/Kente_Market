// FILE LOCATION: src/utils/csrf.ts
// DESCRIPTION: Provides the signed double-submit CSRF token to the SPA.
//
// The token is stored as a host-only cookie on the API origin (set at
// login/OAuth). Because the SPA runs on a cross-site origin
// (kente-market.vercel.app vs kente-api.onrender.com), document.cookie can
// never see it — so the SPA fetches it once from GET /api/auth/csrf-token (a
// safe method, so no token is needed to read it) and caches it in memory,
// echoing it back in X-CSRF-Token on every state-changing request. The cookie
// still travels with the browser automatically; the backend compares the
// header against it, so an attacker page that can neither read the cookie nor
// set the header (CORS blocks it) cannot forge a state-changing request.

import { Base_URL } from '../constant';

export const CSRF_HEADER = "X-CSRF-Token";

const CSRF_ENDPOINT = `${Base_URL}/api/auth/csrf-token`;

// In-memory cache of the current token, plus a generation counter so a stale
// in-flight fetch (e.g. started just before logout) cannot repopulate the
// cache with a token from a previous session after a log-in/log-out cycle.
let cachedToken: string | null = null;
let inflight: Promise<string | null> | null = null;
let generation = 0;

async function fetchCsrfToken(gen: number): Promise<string | null> {
  try {
    const res = await fetch(CSRF_ENDPOINT, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { csrfToken?: string };
    const token = typeof data.csrfToken === 'string' ? data.csrfToken : null;
    if (token && gen === generation) cachedToken = token;
    return token;
  } catch {
    return null;
  }
}

/**
 * Return the cached CSRF token, fetching it once from the API if none is
 * cached. Never rejects: on failure it resolves to null and callers simply
 * send the request without the header (the backend then 403s on requests
 * that carry a session cookie).
 */
export function getOrLoadCsrfToken(): Promise<string | null> {
  if (cachedToken) return Promise.resolve(cachedToken);
  if (!inflight) {
    const gen = generation;
    inflight = fetchCsrfToken(gen).finally(() => {
      if (gen === generation) inflight = null;
    });
  }
  return inflight;
}

/** Forget the cached token (call when the session changes, i.e. login/logout). */
export function resetCsrfToken(): void {
  generation += 1;
  cachedToken = null;
  inflight = null;
}

/** True for methods that never change state and therefore need no CSRF token. */
export function isSafeMethod(method?: string): boolean {
  const m = (method || "").toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}