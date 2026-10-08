// FILE LOCATION: backend/tests/helpers/httpHarness.js
// DESCRIPTION: The suite's missing HTTP layer, so routers can be exercised
//              over real sockets instead of by hand-rolled `req`/`res` fakes.
//
// Why this exists: until now every test either called an exported controller
// directly with a fake `req`/`res`, or grepped source text. That works when
// the code under test is an exported function, but not when it is *middleware
// mounted on a router* — V-05's OAuth `state` gate and V-09's
// `POST /verify-paystack` handler are both inline in their routers and only
// reachable over HTTP. Testing the gate means a browser-shaped request:
// cookies attached, `Set-Cookie` read back, redirects followed by hand.
//
// Two details that would otherwise hang or lie to a test:
//   * Node's global `fetch` keeps sockets alive in a pool. `server.close()`
//     waits for idle keep-alive sockets, so a test that only called `close()`
//     would never finish. `closeAllConnections()` is called first.
//   * A cookie the server *clears* (Express `res.clearCookie` writes an
//     epoch `Expires`) must not be carried forward as if it were live —
//     otherwise a replay test would believe the browser still holds a state
//     token it demonstrably does not.
import http from 'node:http';

/**
 * Mount `app` on an ephemeral loopback port.
 *
 * @param {import('express').Express} app
 * @returns {Promise<{ baseUrl: string, port: number, close: () => Promise<void> }>}
 */
export const startServer = (app) =>
  new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        port,
        close: () =>
          new Promise((done) => {
            if (typeof server.closeAllConnections === 'function') {
              server.closeAllConnections();
            }
            server.close(() => done());
          }),
      });
    });
  });

/** An epoch Expires or Max-Age=0 is how Express expires a cookie. */
const isExpiryAttribute = (attribute) =>
  /^max-age=0(?!\d)/i.test(attribute) ||
  /^expires=thu,\s*01 jan 1970/i.test(attribute);

/**
 * Collect the cookies from a response.
 *
 * @param {Response} response  a `fetch` response
 * @returns {{ jar: Record<string,string>, cleared: string[], setCookies: string[] }}
 *   `jar` holds only cookies that are still live (cleared ones are moved to
 *   `cleared`), `setCookies` keeps the raw headers for assertions such as
 *   "HttpOnly is set" or "this Set-Cookie never appeared".
 */
export const collectCookies = (response) => {
  const raw =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')]
        : [];

  const jar = {};
  const cleared = [];

  for (const line of raw) {
    const [pair, ...attributes] = line.split(';').map((part) => part.trim());
    const equalsAt = pair.indexOf('=');
    if (equalsAt < 0) continue;
    const name = pair.slice(0, equalsAt);
    const value = pair.slice(equalsAt + 1);
    if (attributes.some(isExpiryAttribute)) {
      delete jar[name];
      cleared.push(name);
    } else {
      jar[name] = value;
    }
  }

  return { jar, cleared, setCookies: raw };
};

/** Build a `Cookie` request header from one or more jars (later wins). */
export const cookieHeader = (...jars) => {
  const merged = Object.assign({}, ...jars.map((jar) => jar || {}));
  return Object.entries(merged)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
};

/**
 * Follow a redirect manually and assert it went where we expect.
 *
 * `fetch` follows redirects by default, which would hide the very thing a
 * gate test wants to see (a 302 to an error page, and critically the
 * *absence* of a session cookie). Passing `redirect: 'manual'` and using this
 * keeps the exchange observable.
 *
 * @param {Response} response
 * @returns {{ status: number, location: string | null }}
 */
export const seeRedirect = (response) => ({
  status: response.status,
  location: response.headers.get('location'),
});
