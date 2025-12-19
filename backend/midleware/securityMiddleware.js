// FILE LOCATION: middleware/securityMiddleware.js
// DESCRIPTION: Security middleware for headers, XSS, SQL injection protection (MySQL)

import helmet from 'helmet';
// REMOVED: import xss from 'xss-clean'; // Not compatible with Express 5
import hpp from 'hpp';

/**
 * Setup all security middleware
 * NOTE: Using MySQL, so no mongoSanitize needed (that's for MongoDB/NoSQL)
 * NOTE: xss-clean removed due to Express 5 compatibility issues
 * @param {Express} app - Express application instance
 */
export const setupSecurity = (app) => {
  // Set security HTTP headers (includes XSS protection)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
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
    const allowedOrigins = process.env.FRONTEND_URL 
      ? process.env.FRONTEND_URL.split(',')
      : ['http://localhost:3000'];
    
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
    
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    next();
  });

  console.log('✅ Security middleware initialized (Helmet with XSS protection, HPP)');
};

/**
 * Input sanitization middleware (replaces xss-clean)
 * This provides XSS protection by escaping dangerous characters
 */
export const sanitizeInput = (req, res, next) => {
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      // Remove null bytes
      value = value.replace(/\0/g, '');
      
      // Escape dangerous HTML characters
      value = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    }
    return value;
  };

  const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    
    Object.keys(obj).forEach(key => {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeValue(obj[key]);
      } else if (typeof obj[key] === 'object') {
        sanitizeObject(obj[key]);
      }
    });
  };

  // Sanitize body
  if (req.body) {
    sanitizeObject(req.body);
  }

  // Sanitize query params
  if (req.query) {
    sanitizeObject(req.query);
  }

  // Sanitize URL params
  if (req.params) {
    sanitizeObject(req.params);
  }
  
  next();
};

/**
 * SQL injection prevention (additional layer for MySQL)
 * This works alongside parameterized queries for defense-in-depth
 */
export const preventSQLInjection = (req, res, next) => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /(--|#|\/\*|\*\/)/gi,
    /('|(\\'))/gi
  ];

  const checkValue = (value) => {
    if (typeof value === 'string') {
      return sqlPatterns.some(pattern => pattern.test(value));
    }
    return false;
  };

  // Check query parameters
  if (req.query) {
    for (let key in req.query) {
      if (checkValue(req.query[key])) {
        console.log(`🚨 Potential SQL injection in query param: ${key}`);
        return res.status(400).json({ message: 'Invalid input detected' });
      }
    }
  }

  // Check body parameters
  if (req.body) {
    for (let key in req.body) {
      if (checkValue(req.body[key])) {
        console.log(`🚨 Potential SQL injection in body param: ${key}`);
        return res.status(400).json({ message: 'Invalid input detected' });
      }
    }
  }

  next();
};