// FILE LOCATION: backend/server.js
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
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
import uploadRoutes from './routes/uploadRoute.js';
import settingRoutes from './routes/settingRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import authRoutes from './routes/authRoutes.js';  // ⭐ NEW - OAuth routes
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
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 8. Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 9. Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

// ============================================
// ROUTES
// ============================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK',
    database: 'MySQL',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`
    }
  });
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
app.use('/api/settings', settingRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/auth', authRoutes);  // ⭐ NEW - OAuth routes (Google, Facebook)

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
  console.log(`📦 Body parser limit: 50mb`);
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