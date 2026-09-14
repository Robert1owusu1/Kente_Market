// FILE LOCATION: utils/sentryUtil.js
// DESCRIPTION: DSN-gated Sentry helpers. Sentry is initialized exactly once by
//   backend/instrument.mjs (loaded via `node --import ./instrument.mjs server.js`)
//   when SENTRY_DSN is set. This module reuses that client instead of calling
//   Sentry.init() a second time (which triggers a "already initialized" warning
//   and diverges from the instrument.mjs tracing/profiling config). When running
//   without the --import flag (e.g. some test harnesses) it falls back to a
//   minimal self-init only when a DSN is present — otherwise everything is a
//   safe no-op.

import * as Sentry from '@sentry/node';

let fallbackInitDone = false;

/** @returns {boolean} true when a Sentry client is active in this process */
export const isSentryActive = () => Boolean(process.env.SENTRY_DSN) && Boolean(Sentry.getClient());

/**
 * Ensures a Sentry client exists. Prefers the client already created by
 * instrument.mjs; only falls back to its own init when running outside the
 * --import entry point (and only when a DSN is configured).
 * @returns {typeof Sentry|null}
 */
export const getSentry = () => {
  if (!process.env.SENTRY_DSN) return null;
  if (!Sentry.getClient()) {
    if (!fallbackInitDone) {
      fallbackInitDone = true;
      try {
        Sentry.init({
          dsn: process.env.SENTRY_DSN,
          environment: process.env.NODE_ENV || 'development',
          tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1') || 0.1,
          maxBreadcrumbs: 80,
        });
        console.log(`🔷 Sentry self-initialized (env: ${process.env.NODE_ENV || 'development'})`);
      } catch (err) {
        console.error('❌ Sentry init failed:', err.message);
        return null;
      }
    } else {
      return null;
    }
  }
  return Sentry;
};

/**
 * Fire-and-forget error capture. Never throws: this must not break the request
 * it is called from when Sentry is unconfigured or an event fails to send.
 * @param {import('express').Request|any} req express request (optional)
 * @param {Error} err
 * @param {object} [extra]
 */
export const captureSentryError = async (err, req = null, extra = {}) => {
  const sentry = getSentry();
  if (!sentry) return;
  try {
    const eventContext = {};
    if (req) {
      eventContext.request = {
        method: req.method,
        url: req.originalUrl,
        ip_address: req.ip,
        headers: {
          'user-agent': req.get && req.get('user-agent'),
        },
      };
    }
    if (extra && Object.keys(extra).length > 0) {
      eventContext.extra = extra;
    }
    sentry.captureException(err, eventContext);
  } catch (e) {
    console.error('❌ Sentry capture failed:', e.message);
  }
};