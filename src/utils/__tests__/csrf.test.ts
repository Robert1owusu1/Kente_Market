// FILE LOCATION: src/utils/__tests__/csrf.test.ts
// DESCRIPTION: N-19 regression coverage — every raw (non-axios) state-changing
//              fetch must echo the signed double-submit token.
//
// Why this exists: axios callers get X-CSRF-Token from the interceptor in
// main.tsx, but a raw `fetch` bypasses it. The backend's csrfProtection
// layer 2 403s any POST whose browser also carried the `csrf_token` cookie
// (30-day, set at every login), so the OAuth exchange POST answered
// 403 "CSRF token missing" → no session cookie → the follow-up profile fetch
// died with 401 "Not authenticated" → Google login was broken in production
// for every visitor whose session had expired while the CSRF cookie lived on.
//
// The last test is a source guard over the whole SPA: it walks src/, pulls
// out every raw fetch() call that changes state, and fails if any of them
// builds its headers without the shared helper. It self-tests its own
// extractor so a broken matcher cannot make it pass vacuously.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csrfJsonHeaders, resetCsrfToken, CSRF_HEADER, isSafeMethod } from '../csrf';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, json: async () => body } as Response);

beforeEach(() => {
  // The token is cached in module scope; every test must start cold.
  resetCsrfToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCsrfToken();
});

describe('csrfJsonHeaders', () => {
  it('echoes the token fetched from GET /api/auth/csrf-token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ csrfToken: 'raw.sig' }));
    vi.stubGlobal('fetch', fetchMock);

    const headers = await csrfJsonHeaders();

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'raw.sig',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/auth/csrf-token');
    // Cross-origin: without credentials the browser neither sends the cookie
    // nor stores the Set-Cookie, so the pair could never match.
    expect(init.credentials).toBe('include');
  });

  it('degrades to Content-Type only when the token fetch fails (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const headers = await csrfJsonHeaders();

    expect(headers).toEqual({ 'Content-Type': 'application/json' });
    expect(headers[CSRF_HEADER]).toBeUndefined();
  });

  it('omits the header when the endpoint answers non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'nope' }, false)));

    const headers = await csrfJsonHeaders();

    expect(headers[CSRF_HEADER]).toBeUndefined();
  });

  it('caches the token for the session and drops it on reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ csrfToken: 'a.b' }));
    vi.stubGlobal('fetch', fetchMock);

    await csrfJsonHeaders();
    await csrfJsonHeaders();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // resetCsrfToken() runs on login/logout — a new fetch, never a stale echo.
    resetCsrfToken();
    await csrfJsonHeaders();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies GET/HEAD/OPTIONS as safe (they need no token)', () => {
    expect(isSafeMethod('GET')).toBe(true);
    expect(isSafeMethod('get')).toBe(true);
    expect(isSafeMethod('HEAD')).toBe(true);
    expect(isSafeMethod('OPTIONS')).toBe(true);
    expect(isSafeMethod('POST')).toBe(false);
    expect(isSafeMethod('DELETE')).toBe(false);
    // Fail closed: a missing/unknown method is treated as state-changing, so
    // the header is attached rather than skipped.
    expect(isSafeMethod(undefined)).toBe(false);
    expect(isSafeMethod('PURGE')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source guard: no raw state-changing fetch may bypass csrfJsonHeaders().
// ---------------------------------------------------------------------------

/** Pull out the argument block of every genuine `fetch(` call (not `refetch(`). */
const extractFetchBlocks = (src: string): string[] => {
  const blocks: string[] = [];
  const re = /(^|[^\w$])fetch\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let inStr: string | null = null;
    let i = open;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (inStr) {
        if (ch === '\\') i += 1;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = ch;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(src.slice(open, i + 1));
  }
  return blocks;
};

const isStateChanging = (block: string) =>
  /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(block);

const carriesCsrf = (block: string) =>
  /\bcsrfJsonHeaders\s*\(|\bCSRF_HEADER\b|\bgetOrLoadCsrfToken\b/.test(block);

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });

describe('source guard: raw fetch + CSRF header', () => {
  it('detects a state-changing fetch with no CSRF header at all', () => {
    const bad = extractFetchBlocks(
      `await fetch('${'https://api'}/x', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })`,
    );
    expect(bad).toHaveLength(1);
    expect(isStateChanging(bad[0])).toBe(true);
    expect(carriesCsrf(bad[0])).toBe(false);
  });

  it('accepts the same fetch once it uses the shared helper', () => {
    const good = extractFetchBlocks(
      `await fetch('/x', { method: 'POST', credentials: 'include', headers: await csrfJsonHeaders() })`,
    );
    expect(good).toHaveLength(1);
    expect(carriesCsrf(good[0])).toBe(true);
  });

  it('ignores refetch()/useFetch() lookalikes and safe GETs', () => {
    const src = `
      const { refetch } = useSomething();
      refetch();
      await fetch('/status', { credentials: 'include' });
      await fetch('/x', { method: 'GET' });
    `;
    const blocks = extractFetchBlocks(src).filter(isStateChanging);
    expect(blocks).toEqual([]);
  });

  it('every raw state-changing fetch in src/ echoes the CSRF token', () => {
    const offenders: string[] = [];
    let found = 0;

    for (const file of walk(SRC_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const block of extractFetchBlocks(src)) {
        if (!isStateChanging(block)) continue;
        found += 1;
        if (!carriesCsrf(block)) offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    // The extractor must actually see the known call sites (OAuth exchange,
    // Google-signup consent, forgot/reset password) — otherwise this guard
    // would pass vacuously if someone renamed or restructured them.
    expect(found).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  it('pins the reported bug: the OAuth exchange POST carries the header', () => {
    const file = path.join(SRC_ROOT, 'Pages', 'Auth', 'OAuthCallback.tsx');
    const blocks = extractFetchBlocks(fs.readFileSync(file, 'utf8'));
    const exchange = blocks.filter((b) => b.includes('/api/auth/oauth/exchange'));
    expect(exchange).toHaveLength(1);
    expect(isStateChanging(exchange[0])).toBe(true);
    expect(carriesCsrf(exchange[0])).toBe(true);
    expect(exchange[0]).toContain('credentials');
  });
});
