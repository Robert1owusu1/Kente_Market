// FILE LOCATION: utils/sentryUtil.js
// DESCRIPTION: DSN-gated, idempotent Sentry helpers. The production deploy runs
//   `node server.js` directly (Render's Start Command — no `--import`), so
//   backend/instrument.mjs is NOT loaded there; this module therefore
//   self-initializes a client once, lazily, only when SENTRY_DSN is set. Under
//   `node --import ./instrument.mjs` (the package.json start script) it reuses
//   the already-created client and never double-inits. With no SENTRY_DSN every
//   helper is a safe no-op (the server must keep working with Sentry off).

import * as Sentry from '@sentry/node';

let initAttempted = false;

/** @returns {boolean} true when a Sentry client actually exists in this process */
export const isSentryActive = () =>
  Boolean(process.env.SENTRY_DSN) && Boolean(Sentry.getClient());

/**
 * Ensure a Sentry client exists (idempotent, never throws). Call once at boot
 * so the server banner reports the real runtime state.
 * @returns {boolean} whether a client is now active
 */
export const initSentryIfConfigured = () => {
  if (!process.env.SENTRY_DSN) return false;
  if (Sentry.getClient()) return true;
  if (initAttempted) return isSentryActive();
  initAttempted = true;
  try {
    const traces = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number.isNaN(traces) ? 0.1 : traces,
      maxBreadcrumbs: 80,
    });
    console.log(`🔷 Sentry initialized (env: ${process.env.NODE_ENV || 'development'})`);
  } catch (err) {
    console.error('❌ Sentry init failed:', err.message);
  }
  return isSentryActive();
};

/**
 * Fire-and-forget error capture. Never throws: this must not break the request
 * it is called from when Sentry is unconfigured or an event fails to send.
 * @param {import('express').Request|any} req express request (optional)
 * @param {Error} err
 * @param {object} [extra]
 */
export const captureSentryError = async (err, req = null, extra = {}) => {
  if (!isSentryActive()) return;
  try {
    const eventContext = {};
    if (req) {
      eventContext.request = {
        method: req.method,
        url: req.originalUrl,
        ip_address: req.ip,
        headers: { 'user-agent': req.get && req.get('user-agent') },
      };
    }
    if (extra && Object.keys(extra).length > 0) {
      eventContext.extra = extra;
    }
    Sentry.captureException(err, eventContext);
  } catch (e) {
    console.error('❌ Sentry capture failed:', e.message);
  }
};
