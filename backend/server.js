// FILE LOCATION: backend/server.js
import dotenv from 'dotenv';
dotenv.config();

// Explicit FRONTEND_URL / OAUTH_CALLBACK_URL in .env are respected as-is. The
// registered Google redirect URI must match what is used at runtime.

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import session from 'express-session';          // ⭐ NEW
import MySQLStoreFactory from 'express-mysql-session';  // ⭐ NEW
const MySQLStore = MySQLStoreFactory(session);
import passport from 'passport';                 // ⭐ NEW
import { configurePassport } from './config/passPort.js';  // ⭐ NEW
import { cookieSameSite } from './config/cookieConfig.js';

// Database
import pool from './config/db.js';

// Middleware
import { setupSecurity } from './middleware/securityMiddleware.js';
import { apiLimiter } from './middleware/rateLimitMiddleware.js';
import { csrfProtection } from './middleware/csrfMiddleware.js';
import { errorHandeler, notFound } from './middleware/errorMiddleware.js';
import { requestLogger } from './utils/logger.js';

// Routes
import productRoutes from './routes/productRoutes.js';
import userRoutes from './routes/userRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import vendorRoutes from './routes/vendorRoutes.js';
import uploadRoutes from './routes/uploadRoute.js';
import settingRoutes from './routes/settingRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import authRoutes from './routes/authRoutes.js';  // ⭐ NEW - OAuth routes
import tryOnRoutes from './routes/tryOnRoutes.js';  // ⭐ NEW - AI Try-On routes
import contactRoutes from './routes/contactRoutes.js';  // ⭐ NEW - Contact & messages
import cartRoutes from './routes/cartRoutes.js';  // ⭐ NEW - Server-side cart
import subscriberRoutes from './routes/subscriberRoutes.js';  // ⭐ NEW - Newsletter
import reviewRoutes from './routes/reviewRoutes.js';
import promotionRoutes from './routes/promotionRoutes.js';  // ⭐ NEW - Product reviews
import couponRoutes from './routes/couponRoutes.js';  // ⭐ NEW - Coupons/Discounts
import wishlistRoutes from './routes/wishlistRoutes.js';  // ⭐ NEW - Wishlist/Favorites
import returnRoutes from './routes/returnRoutes.js';  // ⭐ NEW - Return/Refund
import notificationRoutes from './routes/notificationRoutes.js';  // ⭐ NEW - Notifications
import reportRoutes from './routes/reportRoutes.js';  // ⭐ NEW - Review Reports
import designRoutes from './routes/designRoutes.js';  // ⭐ NEW - Saved designs
import addressRoutes from './routes/addressRoutes.js';  // ⭐ NEW - Address book
import paymentMethodRoutes from './routes/paymentMethodRoutes.js';  // ⭐ NEW - Saved payment methods
import supportRoutes from './routes/supportRoutes.js';  // ⭐ NEW - Help & support tickets
import categoryRoutes from './routes/categoryRoutes.js';  // ⭐ NEW - Product categories
import staffRoutes from './routes/staffRoutes.js';  // ⭐ NEW - Vendor staff
import messageRoutes from './routes/messageRoutes.js';  // ⭐ NEW - Buyer-vendor messaging
import campaignRoutes from './routes/campaignRoutes.js';  // ⭐ NEW - Marketing campaigns
import certificateRoutes from './routes/certificateRoutes.js';  // ⭐ NEW - Authenticity certificates
import commissionRoutes from './routes/commissionRoutes.js';  // ⭐ NEW - Commission engine
import moderationRoutes from './routes/moderationRoutes.js';  // ⭐ NEW - Product moderation
import suggestionRoutes from './routes/suggestionRoutes.js';
import customRequestRoutes from './routes/customRequestRoutes.js';  // 🆕 Custom orders  // ⭐ NEW - User suggestions
import buybackRoutes from './routes/buybackRoutes.js';  // 🆕 Sell-back / borrow-back loop  // ⭐ NEW - User suggestions
import { startCleanupSchedule } from './utils/cleanupJobs.js';

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = process.env.PORT || 5000;

// ============================================
// DATABASE CONNECTION TEST
// ============================================
pool.getConnection()
  .then((connection) => {
    console.log('✅ MySQL Connection Established');
    connection.release();
  })
  .catch((err) => {
    console.error('❌ MySQL Connection Failed:', err.message);
    process.exit(1);
  });

startCleanupSchedule();

// ============================================
// EXPRESS APP INITIALIZATION
// ============================================
const app = express();

// Trust the proxy that sits in front of Express so that req.ip (used by
// express-rate-limit and express-session) is correct. In development this is
// the Vite dev proxy (which sets X-Forwarded-For); in production it is your
// reverse proxy (Nginx / Caddy / cloud LB).
//   - 0  = no proxy, direct exposure (never trust X-Forwarded-For)
//   - 1  = trust one proxy hop (Vite dev proxy / single Nginx)  [RECOMMENDED]
//   - 2+ = trust N hops if you have multiple proxies
// SECURITY: if NODE_ENV=production and TRUST_PROXY is unset we default to 0 so
// a directly-exposed server cannot have its rate-limit IPs spoofed via a fake
// X-Forwarded-For header. Set TRUST_PROXY=1 only when a proxy really stands in
// front of Express. MUST NOT be boolean true (that trusts any client header).
const trustProxySetting = process.env.TRUST_PROXY !== undefined
  ? Math.max(0, Math.min(parseInt(process.env.TRUST_PROXY, 10) || 0, 3))
  : (process.env.NODE_ENV === 'production' ? 0 : 1);
if (trustProxySetting === 0 && process.env.NODE_ENV === 'production') {
  console.log('ℹ️  TRUST_PROXY not set — assuming the server is directly exposed (req.ip = socket IP).');
  console.log('   If a reverse proxy (Nginx/Caddy) fronts this app, set TRUST_PROXY=1 in backend/.env.');
}
app.set('trust proxy', trustProxySetting);

// ============================================
// MIDDLEWARE (ORDER IS CRITICAL!)
// ============================================

// 1. Enable gzip compression for responses
app.use(compression());

// 2. Setup security middleware - Helmet, XSS protection, HPP, CORS
setupSecurity(app);

// 3. Cookie Parser - MUST be first for JWT authentication
app.use(cookieParser());

// ⭐ 4. Session middleware (required for OAuth flow)
// Security: never fall back to a hardcoded secret. Refuse to boot in production
// without one; in development generate an ephemeral secret with a warning.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ SESSION_SECRET must be set in production');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  SESSION_SECRET not set - using ephemeral secret (dev only, sessions will not persist across restarts)');
}
app.use(session({
  secret: sessionSecret,
  store: new MySQLStore({}, pool),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: cookieSameSite(),
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Hard-fail on missing secrets that would silently break auth in production,
// and warn about optional integrations so "I filled in the .env" is enough.
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET) {
    console.error('❌ JWT_SECRET must be set in production');
    process.exit(1);
  }
  const warn = (name, msg) => {
    if (!process.env[name]) console.log(`⚠️  ${name} not set — ${msg}`);
  };
  warn('PAYSTACK_SECRET_KEY', 'payment verification / webhooks will fail');
  warn('EMAIL_USER', 'email delivery (OTP / password reset) will fail');
  warn('REPLICATE_API_TOKEN', 'AI try-on is disabled (503)');
  warn('GOOGLE_CLIENT_ID', 'Google sign-in is disabled');
}

// ⭐ 5. Initialize Passport for OAuth
app.use(passport.initialize());
app.use(passport.session());
configurePassport();

// 6. Upload routes - MUST come BEFORE body parsers
app.use('/api/upload', uploadRoutes);

// 7. Body parser middleware - applied AFTER upload routes
// Captures the raw body so Paystack webhook signatures can be verified against it.
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 8b. Structured request logging (LOG_FORMAT=json for machine-friendly output).
app.use(requestLogger);

// Serve static files from uploads directory.
// Long-lived + immutable cache: uploaded product image filenames are generated
// once and never change, so repeat visits load them from the browser cache
// instead of re-downloading over slow links. (Max-age 30 days.)
const uploadsRoot = path.join(__dirname, 'uploads');

// Render's filesystem is wiped on every redeploy, so uploaded product/profile
// images referenced by the database can 404 while the DB still points at them.
// Return a branded placeholder (200) instead of a broken-image icon, which
// also keeps "browser errors were logged to the console" out of Lighthouse.
const PLACEHOLDER_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect fill="#f4eee1" width="600" height="450"/><text x="300" y="225" font-family="Georgia, serif" font-size="32" fill="#a07f3a" text-anchor="middle">Bonwire Kente</text><text x="300" y="265" font-family="sans-serif" font-size="18" fill="#8a6d3b" text-anchor="middle">Image coming soon</text></svg>'
);
app.use('/uploads', (req, res, next) => {
  if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(req.path)) return next();
  let filePath;
  try {
    filePath = path.resolve(uploadsRoot, '.' + req.path);
  } catch {
    return next();
  }
  if (!filePath.startsWith(uploadsRoot + path.sep)) return next();
  if (fs.existsSync(filePath)) return next();
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(PLACEHOLDER_SVG);
});

app.use(
  '/uploads',
  express.static(uploadsRoot, {
    maxAge: '30d',
    immutable: true,
  })
);

// ⭐ Serve Kente cloth static images (from the frontend assets)
// This lets the backend API return valid /images/*.jpg URLs for Kente products.
app.use(
  '/images',
  express.static(path.join(__dirname, '..', 'src', 'assets', 'images'), {
    maxAge: '30d',
    immutable: true,
  })
);

// 9. Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

// 9b. CSRF protection for state-changing requests (cookie-based auth)
app.use('/api/', csrfProtection);

// ============================================
// ROUTES
// ============================================

// Health check endpoint — uptime + DB reachability, no internals exposed.
// Used by the GitHub Actions keep-alive workflow and external uptime monitors.
app.get('/health', async (req, res) => {
  let db = 'ok';
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
    ]);
  } catch {
    db = 'down';
  }
  const healthy = db === 'ok';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'OK' : 'DEGRADED',
    db,
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  });
});

// Root route
app.get('/', (req, res) => {
  res.send('API is running..');
});

// API Routes
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api', buybackRoutes);  // 🆕 Sell-back loop (/api/orders/:id/buyback, /api/admin/buyback)
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/auth', authRoutes);  // ⭐ NEW - OAuth routes (Google, Facebook)
app.use('/api/tryon', tryOnRoutes);  // ⭐ NEW - AI Try-On routes
app.use('/api/contact', contactRoutes);  // ⭐ NEW - Contact & messages
app.use('/api/cart', cartRoutes);  // ⭐ NEW - Server-side cart
app.use('/api/subscribe', subscriberRoutes);  // ⭐ NEW - Newsletter
app.use('/api/reviews', reviewRoutes);
app.use('/api/promotions', promotionRoutes);  // ⭐ NEW - Product reviews
app.use('/api/coupons', couponRoutes);  // ⭐ NEW - Coupons/Discounts
app.use('/api/wishlist', wishlistRoutes);  // ⭐ NEW - Wishlist/Favorites
app.use('/api/returns', returnRoutes);  // ⭐ NEW - Return/Refund
app.use('/api/notifications', notificationRoutes);  // ⭐ NEW - Notifications
app.use('/api/reports', reportRoutes);  // ⭐ NEW - Review Reports
app.use('/api/designs', designRoutes);  // ⭐ NEW - Saved designs
app.use('/api/addresses', addressRoutes);  // ⭐ NEW - Address book
app.use('/api/payments/methods', paymentMethodRoutes);  // ⭐ NEW - Saved payment methods
app.use('/api/support', supportRoutes);  // ⭐ NEW - Help & support tickets
app.use('/api/categories', categoryRoutes);  // ⭐ NEW - Product categories

// ⭐ NEW — Marketplace upgrade routes
app.use('/api/vendors/staff', staffRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/admin/commissions', commissionRoutes);
app.use('/api/admin/moderation', moderationRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/custom-requests', customRequestRoutes);  // 🆕 Custom orders

// ============================================
// ERROR HANDLING - Must be LAST
// ============================================

app.use(notFound);
app.use(errorHandeler);

// ============================================
// START SERVER
// ============================================


const server = app.listen(port, () => {
  console.log('='.repeat(50));
  console.log(`✅ Server running in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`🚀 Server listening on port ${port}`);
  console.log(`🌐 API: http://localhost:${port}`);
  console.log(`❤️  Health: http://localhost:${port}/health`);
  console.log('='.repeat(50));
  console.log(`🗄️  Database: MySQL`);
  console.log(`📁 Static files served from: ${path.join(__dirname, 'uploads')}`);
  console.log(`🍪 Cookie parser enabled`);
  console.log(`🔒 Security middleware active (Helmet, XSS, HPP)`);
  console.log(`⚡ Compression enabled`);
  console.log(`🚦 Rate limiting active`);
  console.log(`📤 Upload route registered before body parser`);
  console.log(`📦 Body parser limit: 1mb`);
  console.log(`🖼️  Profile picture uploads enabled`);
  console.log(`🔐 OAuth routes enabled (Google, Facebook)`);  // ⭐ NEW
    console.log("🚨 Error tracking: not configured (set SENTRY_DSN and install @sentry/node to enable)");
});

// ============================================
// GRACEFUL SHUTDOWN HANDLERS
// ============================================

process.on('unhandledRejection', (err) => {
  console.error('🚨 Unhandled Promise Rejection:', err.message);
  console.error(err.stack);
  server.close(() => {
    console.log('💤 Server closed due to unhandled rejection');
    process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  console.error('🚨 Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, closing server gracefully...');
  server.close(() => {
    console.log('💤 Server closed');
    process.exit(0);
  });
});

export default app;
