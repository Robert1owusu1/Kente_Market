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
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: req.ip,
      userAgent: (req.get('user-agent') || '').slice(0, 120),
    });
  });
  next();
};
