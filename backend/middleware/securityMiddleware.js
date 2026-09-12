// FILE LOCATION: middleware/securityMiddleware.js
// DESCRIPTION: Security middleware for headers, XSS, SQL injection protection (MySQL)

import helmet from 'helmet';
import hpp from 'hpp';

/**
 * Setup all security middleware
 * NOTE: Using MySQL, so no mongoSanitize needed (that's for MongoDB/NoSQL)
 * NOTE: XSS protection is handled via Helmet's CSP headers + React's
 *       default JSX escaping. Input sanitization is applied at the
 *       controller/model layer for user-provided strings.
 * @param {Express} app - Express application instance
 */
export const setupSecurity = (app) => {
  // Set security HTTP headers (includes XSS protection)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        // Paystack loads via an EXTERNAL <script src="https://js.paystack.co/v2/inline.js">,
        // so no 'unsafe-inline' is needed. Inline scripts are blocked (XSS defense).
        scriptSrc: ["'self'", "https://js.paystack.co", "https://checkout.paystack.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "https://js.paystack.co", "https://checkout.paystack.com", "https://api.paystack.co"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Uploaded product images live on the API origin but are displayed from the
    // frontend origin (Vercel). Helmet's default CORP 'same-origin' makes
    // Firefox block those <img> loads, so allow cross-origin resource loading.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // XSS filter is enabled by default in helmet
  }));

  // Prevent HTTP Parameter Pollution attacks
  app.use(hpp({
    whitelist: [
      'page', 
      'limit', 
      'sort', 
      'status', 
      'category',
      'price',
      'rating'
    ]
  }));

// CORS configuration
  app.use((req, res, next) => {
    const allowedOrigins = (process.env.FRONTEND_URL || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
    if (allowedOrigins.length === 0) {
      allowedOrigins.push('http://localhost:5173');
    }

    const origin = req.headers.origin;

    // Only reflect a concrete origin; never send "*" together with credentials.
    // In production, allow the configured frontend URL(s) plus any Vercel
    // deployment (production + preview branches share the *.vercel.app domain)
    // and localhost, so local dev against the live API works too.
    const isAllowedOrigin = (o) => {
      if (!o) return false;
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o)) return true;
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(o)) return true;
      return allowedOrigins.includes(o);
    };

    if (origin && isAllowedOrigin(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  console.log('✅ Security middleware initialized (Helmet, HPP, CORS)');
};

/**
 * SQL injection prevention
 * NOTE: All queries in this codebase use parameterized statements (mysql2 .execute),
 * which is the primary defense against SQL injection. This middleware is intentionally
 * NOT applied globally because naive keyword/single-quote blacklists cause false
 * positives (e.g. legitimate apostrophes in names) and can be trivially bypassed.
 */