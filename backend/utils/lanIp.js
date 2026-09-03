// FILE LOCATION: backend/utils/lanIp.js
// DESCRIPTION: Detects the machine's current LAN IPv4 address at startup and
//              derives the public-facing FRONTEND_URL and OAUTH_CALLBACK_URL so
//              that the app works on other devices on the same network.
//
//              The IP can change between reboots/network joins, so it is detected
//              dynamically each time the server starts.
//
//              Behavior:
//                - If explicit FRONTEND_URL / OAUTH_CALLBACK_URL are already set in
//                  the environment, they are left untouched (they take priority,
//                  e.g. a production domain).
//                - Otherwise the current LAN IP is used to derive them.

import os from 'node:os';

/**
 * Find the first non-internal IPv4 address on the machine.
 * Prefers real network interfaces (wlan0, eth0, en*, etc.).
 * @returns {string|null} the LAN IP string or null if none found
 */
export function detectLanIp() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    // Skip loopback/virtual interfaces that are commonly not the real LAN face
    if (name === 'lo') continue;

    const addrs = interfaces[name] || [];
    for (const net of addrs) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }

  // Fallback: any IPv4 that is not internal
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name] || [];
    for (const net of addrs) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }

  return null;
}

const isLocalhostUrl = (value) => {
  if (!value) return false;
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    // Not a parseable URL; treat as non-localhost (could be a bare origin/domain)
    return false;
  }
};

/**
 * Populate FRONTEND_URL and OAUTH_CALLBACK_URL from the detected LAN IP.
 *
 * Priority / rules:
 *   - If a value is set to a REAL host (e.g. a production domain or an explicit
 *     LAN IP), it is left untouched.
 *   - If a value is `localhost` / `127.0.0.1` (the dev default from .env/.env.example),
 *     it is replaced with the detected LAN IP so other devices can reach the app.
 *   - If a value is absent, it is filled in with the detected LAN IP.
 */
export function applyLanUrls() {
  const ip = detectLanIp();

  const needsOverride = (value) => !value || isLocalhostUrl(value);
  const noOverride = !needsOverride(process.env.FRONTEND_URL) && !needsOverride(process.env.OAUTH_CALLBACK_URL);

  if (noOverride) {
    return { source: 'env', frontendUrl: process.env.FRONTEND_URL, oauthCallbackUrl: process.env.OAUTH_CALLBACK_URL };
  }

  if (!ip) {
    console.warn('⚠️  Could not detect LAN IP. Falling back to localhost URLs.');
    process.env.FRONTEND_URL ||= 'http://localhost:5173';
    process.env.OAUTH_CALLBACK_URL ||= 'http://localhost:5000';
    return { source: 'fallback', frontendUrl: process.env.FRONTEND_URL, oauthCallbackUrl: process.env.OAUTH_CALLBACK_URL };
  }

  const frontendUrl = `http://${ip}:5173`;
  const oauthCallbackUrl = `http://${ip}:5000`;

  // Replace only the localhost/absent fields, preserving any real-domain values.
  if (needsOverride(process.env.FRONTEND_URL)) process.env.FRONTEND_URL = frontendUrl;
  if (needsOverride(process.env.OAUTH_CALLBACK_URL)) process.env.OAUTH_CALLBACK_URL = oauthCallbackUrl;

  console.log('🌐 LAN URLs (auto-detected):');
  console.log(`   FRONTEND_URL      = ${process.env.FRONTEND_URL}`);
  console.log(`   OAUTH_CALLBACK_URL = ${process.env.OAUTH_CALLBACK_URL}`);

  return { source: 'lan', frontendUrl: process.env.FRONTEND_URL, oauthCallbackUrl: process.env.OAUTH_CALLBACK_URL };
}

export default applyLanUrls;
