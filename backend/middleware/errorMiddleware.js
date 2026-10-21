// Patterns that indicate a message came from a database driver, the filesystem
// or another internal layer rather than from a controller's own copy. Because
// res.statusCode is sticky, an unrelated internal error surfacing after a
// controller already set a 4xx would otherwise have its own driver text sent
// to the client verbatim.
const INTERNAL_ERROR_PATTERNS = [
    /SQLSTATE/i,
    /ER_[A-Z_]+/,
    /\bSELECT\b[\s\S]*\bFROM\b/i,
    /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i,
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/,
    /ENOENT|EACCES|EPERM|EISDIR/,
    /node:internal/,
    /\bat\s+\w+\s+\(/,
    /at Object\./,
];

const looksInternal = (message) =>
    typeof message === 'string' && INTERNAL_ERROR_PATTERNS.some((re) => re.test(message));

import { redactUrl } from '../utils/logger.js';

const notFound = (req, res, next) => {
    // Static body: echoing the requested path back is a needless reflection
    // surface (pentest 2026-10-21, F-4). The path is still in the access log.
    const error = new Error('Not Found');
    res.status(404);
    next(error);
};

const errorHandeler = (err, req, res, next) => {
    // Body-parser errors (e.g. JSON over the 1MB limit) carry their status on
    // err.status/err.statusCode while res is still 200; without this they
    // collapsed to a 500, so a caller exceeding the payload limit — the most
    // ordinary oversized-upload mistake there is — got a server error instead
    // of the 413 the limit is supposed to produce. Only http-errors instances
    // (they always carry a boolean `expose`) are trusted: an AxiosError also
    // has `status`, but that is the UPSTREAM provider's status — a Paystack
    // 401 must not reach the SPA as a 401 (which it treats as session expiry).
    const httpErrorStatus = err && typeof err.expose === 'boolean' && Number.isInteger(err.status)
        && err.status >= 400 && err.status < 600 ? err.status : 500;
    let statusCode = res.statusCode === 200 ? httpErrorStatus : res.statusCode;
    console.error(`[${req.method}] ${redactUrl(req.originalUrl)} -> ${statusCode}: ${err.message}`);
    if (err.stack) {
        console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    }
    // Controllers signal deliberate client errors by setting res.status(4xx)
    // and then throwing with a user-facing message ("Invalid email or
    // password", "Please provide email and password", ...) — pass those
    // through verbatim so the UI can show something actionable. Anything that
    // falls through as 5xx (unflagged throws: DB failures, bugs) stays
    // generic so internal details never reach the client, and a 4xx whose
    // message clearly came from an internal layer is downgraded to generic too
    // rather than leaking schema, table or column names.
    const isClientError = statusCode >= 400 && statusCode < 500;
    const message =
        isClientError && err && err.message && !looksInternal(err.message)
            ? err.message
            : statusCode >= 500
                ? 'An error occurred'
                : 'Invalid request';
    res.status(statusCode).json({ message });
};

export { notFound, errorHandeler };