// FILE LOCATION: backend/server.js
import dotenv from 'dotenv';
dotenv.config();

// Auto-detect the LAN IP after loading .env but BEFORE any module reads the
// URL env vars (passport callback URL, CORS origins, email links, etc.).
// Explicit FRONTEND_URL / OAUTH_CALLBACK_URL in .env are always respected.
import { applyLanUrls } from './utils/lanIp.js';
applyLanUrls();

import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import session from 'express-session';          // ⭐ NEW
import passport from 'passport';                 // ⭐ NEW
import { configurePassport } from './config/passPort.js';  // ⭐ NEW

// Database
import pool from './config/db.js';

// Middleware
import { setupSecurity } from './midleware/securityMiddleware.js';
import { apiLimiter } from './midleware/rateLimitMiddleware.js';
import { errorHandeler, notFound } from './midleware/errorMidleware.js';

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
import subscriberRoutes from './routes/subscriberRoutes.js';  // ⭐ NEW - Newsletter
import reviewRoutes from './routes/reviewRoutes.js';
import promotionRoutes from './routes/promotionRoutes.js';  // ⭐ NEW - Product reviews
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
//   - 1  = trust one proxy hop (Vite dev proxy / single Nginx)  [RECOMMENDED]
//   - 2+ = trust N hops if you have multiple proxies
// Set TRUST_PROXY in .env to override. MUST NOT be boolean true (that lets
// clients spoof their IP and bypass rate limiting).
app.set('trust proxy', Math.min(parseInt(process.env.TRUST_PROXY, 10) || 1, 3));

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
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

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

// 8. Serve static files from uploads directory.
// Long-lived + immutable cache: uploaded product image filenames are generated
// once and never change, so repeat visits load them from the browser cache
// instead of re-downloading over slow links. (Max-age 30 days.)
app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'), {
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

// ============================================
// ROUTES
// ============================================

// Health check endpoint — minimal info, no internals exposed
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Root route
app.get('/', (req, res) => {
  res.send('API is running..');
});

// API Routes
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/auth', authRoutes);  // ⭐ NEW - OAuth routes (Google, Facebook)
app.use('/api/tryon', tryOnRoutes);  // ⭐ NEW - AI Try-On routes
app.use('/api/contact', contactRoutes);  // ⭐ NEW - Contact & messages
app.use('/api/subscribe', subscriberRoutes);  // ⭐ NEW - Newsletter
app.use('/api/reviews', reviewRoutes);
app.use('/api/promotions', promotionRoutes);  // ⭐ NEW - Product reviews

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
  console.log('='.repeat(50));
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