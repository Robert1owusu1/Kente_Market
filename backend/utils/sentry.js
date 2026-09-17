// FILE LOCATION: utils/sentry.js
// DESCRIPTION: Optional Sentry error tracking. Active only when SENTRY_DSN is
// set; otherwise it is a no-op, so monitoring can be enabled any time without
// code changes and the app never hard-depends on it.

let _sentry = null;
let _initAttempted = false;

const init = async () => {
  if (_initAttempted || !process.env.SENTRY_DSN) return _sentry;
  _initAttempted = true;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.RENDER_SERVICE_ID || undefined,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    });
    _sentry = Sentry;
    console.log('✅ Sentry error tracking initialized');
  } catch (err) {
    console.error('❌ Failed to initialize Sentry:', err.message);
  }
  return _sentry;
};

export const captureError = async (err, req = {}) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await init();
  if (!Sentry) return;

  const route = `${req.method || 'UNKNOWN'} ${req.originalUrl || 'UNKNOWN'}`;
  const user =
    req.user && typeof req.user === 'object' && req.user.id
      ? { id: String(req.user.id) }
      : undefined;

  Sentry.captureException(err, {
    user,
    tags: { route },
    extra: {
      statusCode: err.statusCode || err.status || undefined,
      bodySize: req.body && typeof req.body === 'object' ? JSON.stringify(req.body).length : undefined,
    },
  });
};

export const isSentryConfigured = () => Boolean(process.env.SENTRY_DSN);