import * as Sentry from '@sentry/node';

let initialized = false;

const sampleRate = (value, fallback) => {
  const parsed = Number.parseFloat(value || '');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
};

export const initSentry = () => {
  if (initialized || !process.env.SENTRY_DSN) return false;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.RENDER_GIT_COMMIT || undefined,
    tracesSampleRate: sampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
    sendDefaultPii: false,
  });
  initialized = true;
  console.log('✅ Sentry error tracking initialized');
  return true;
};

export const setupSentryErrorHandler = (app) => {
  if (initialized) Sentry.setupExpressErrorHandler(app);
};

export const captureError = (err, req = {}) => {
  if (!initialized) return;

  const route = `${req.method || 'UNKNOWN'} ${req.originalUrl || 'UNKNOWN'}`;
  const user =
    req.user && typeof req.user === 'object' && req.user.id
      ? { id: String(req.user.id) }
      : undefined;

  Sentry.captureException(err, {
    user,
    tags: { route, request_id: req.requestId || 'unknown' },
    extra: {
      statusCode: err.statusCode || err.status || undefined,
      bodySize: req.body && typeof req.body === 'object' ? JSON.stringify(req.body).length : undefined,
    },
  });
};

export const flushSentry = async (timeout = 2000) => {
  if (!initialized) return true;
  return Sentry.flush(timeout);
};

export const isSentryConfigured = () => Boolean(process.env.SENTRY_DSN);