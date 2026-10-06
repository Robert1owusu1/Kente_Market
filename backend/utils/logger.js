// FILE LOCATION: utils/logger.js
// DESCRIPTION: Lightweight structured logging. When LOG_FORMAT=json every log
//   entry is emitted as a single JSON line (easy to ingest into a log sink);
//   otherwise it falls back to the existing human-readable format so local dev
//   output stays readable. Zero dependencies — the app already needed a logger,
//   and this one adds no npm weight.

const jsonMode = () => process.env.LOG_FORMAT === 'json';

const ts = () => new Date().toISOString();

const serialize = (extra) => {
  if (!extra) return '';
  if (typeof extra === 'string') return ` ${extra}`;
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return '';
  }
};

const jsonLine = (level, message, extra) => {
  const base = { ts: ts(), level, message };
  if (extra !== undefined && extra !== null && extra !== '') {
    if (typeof extra === 'string') base.context = extra;
    else Object.assign(base, extra);
  }
  return JSON.stringify(base);
};

const emit = (level, message, extra) => {
  const line = jsonMode() ? jsonLine(level, String(message), extra) : `${ts()} [${level.toUpperCase()}] ${message}${serialize(extra)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const logger = {
  info: (message, extra) => emit('info', message, extra),
  warn: (message, extra) => emit('warn', message, extra),
  error: (message, extra) => emit('error', message, extra),
};

/**
 * Query-parameter names whose values must never be written to logs, reverse
 * proxies, or Sentry. `consent` carries a signed 10-minute `legal_consent` JWT
 * in GET /api/auth/google, so logging the raw query string leaked a live,
 * signed token to every downstream log sink.
 */
const SENSITIVE_QUERY_KEYS = new Set([
  'consent',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'code_verifier',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
  'jwt',
  'session',
  'auth',
]);

/**
 * Strip sensitive values from a URL, keeping the shape (and the non-sensitive
 * params) so the log line stays useful for debugging.
 *
 * RED-TEAM FIX (P1): this also covers PATH segments, not just query params.
 * `GET /api/users/reset-password/:token` puts a single-use account-takeover
 * capability in the path; `redactUrl` used to return the path untouched, so
 * every password-reset link was written to the log in full. Anyone with log
 * access (aggregator, APM, support tooling, a log-scraping XSS) could take
 * over the account. The path prefix stays readable for debugging.
 */
const SENSITIVE_PATH_SEGMENTS = new Set([
  'reset-password',
  'reset_password',
  'verify-email',
  'verify_email',
]);

export const redactUrl = (originalUrl) => {
  if (!originalUrl) return originalUrl;
  const [rawPath, query] = String(originalUrl).split('?');

  // Redact the segment that FOLLOWS a sensitive path keyword.
  const segments = String(rawPath).split('/');
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (SENSITIVE_PATH_SEGMENTS.has(segments[i].toLowerCase())) {
      segments[i + 1] = '[redacted]';
    }
  }
  const path = segments.join('/');

  if (!query) return path;
  const cleaned = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      // RED-TEAM FIX (P0 DoS): decodeURIComponent throws URIError on a
      // malformed escape in the KEY position (e.g. `GET /?%=1`). This runs in a
      // `res.on('finish')` listener, so the throw escaped Express entirely,
      // surfaced as an uncaughtException and the process exited — one
      // unauthenticated request killed the whole API (incl. webhooks).
      // Redaction must never be able to take the server down: a key we cannot
      // decode is simply not one of ours, so keep the pair verbatim.
      let key;
      try {
        key = decodeURIComponent(pair.slice(0, eq));
      } catch {
        return pair;
      }
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) return `${key}=[redacted]`;
      return pair;
    })
    .join('&');
  return `${path}?${cleaned}`;
};

/**
 * Express middleware that logs one structured line per request
 * (method, path, status, duration, IP) — the fastest way to answer
 * "what happened and how slow was it" without a monitoring vendor.
 */
export const requestLogger = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    logger.info('http', {
      requestId: req.requestId,
      method: req.method,
      // Redacted, not verbatim: a signed JWT is passed in the query string of
      // the OAuth consent flow, and this line is shipped to stdout, any proxy
      // in front of the app, and Sentry.
      path: redactUrl(req.originalUrl),
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: req.ip,
      userAgent: (req.get('user-agent') || '').slice(0, 120),
    });
  });
  next();
};
