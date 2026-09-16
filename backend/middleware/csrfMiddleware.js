// FILE LOCATION: middleware/csrfMiddleware.js
// DESCRIPTION: CSRF protection for cookie-based authentication
// Since the frontend uses SameSite=Lax cookies and JSON-based API calls,
// we protect against CSRF by validating the Origin/Referer header on
// state-changing requests. This is a lightweight CSRF defense that does not
// require token round-trips and works well with SPAs.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isAllowedOrigin = (origin) => {
  if (!origin) return false;
  try {
    new URL(origin);
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    if (isLocalhost && process.env.NODE_ENV !== 'production') return true;

    const allowedOrigins = (process.env.FRONTEND_URL || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    return allowedOrigins.includes(origin);
  } catch {
    return false;
  }
};

export const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.headers.origin || req.headers.referer;
  if (!origin || isAllowedOrigin(origin)) {
    return next();
  }

  return res.status(403).json({ message: 'Cross-site request rejected' });
};
