// FILE: backend/utils/metrics.js
// DESCRIPTION: Prometheus metrics endpoint for observability
// Mount at /metrics for Prometheus scraping

import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

const register = new Registry();

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics({ register, prefix: 'nodejs_' });

// HTTP request metrics
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Database metrics
const dbQueriesTotal = new Counter({
  name: 'db_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'status'], // operation: select/insert/update/delete, status: success/error
  registers: [register],
});

const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

const dbPoolUsage = new Gauge({
  name: 'db_pool_usage',
  help: 'Database connection pool usage',
  labelNames: ['state'], // state: used/free/pending
  registers: [register],
});

// Business metrics
const ordersCreatedTotal = new Counter({
  name: 'orders_created_total',
  help: 'Total number of orders created',
  labelNames: ['payment_status'],
  registers: [register],
});

const ordersPaidTotal = new Counter({
  name: 'orders_paid_total',
  help: 'Total number of orders marked as paid',
  registers: [register],
});

const escrowHeldTotal = new Counter({
  name: 'escrow_held_total',
  help: 'Total number of escrow allocations held',
  registers: [register],
});

const escrowReleasedTotal = new Counter({
  name: 'escrow_released_total',
  help: 'Total number of escrow allocations released to vendor wallet',
  registers: [register],
});

const payoutAttemptsTotal = new Counter({
  name: 'payout_attempts_total',
  help: 'Total number of payout attempts',
  labelNames: ['status'], // processing/succeeded/failed/reversed
  registers: [register],
});

const vendorSignupsTotal = new Counter({
  name: 'vendor_signups_total',
  help: 'Total number of vendor applications',
  labelNames: ['status'], // pending/approved/rejected
  registers: [register],
});

const activeVendors = new Gauge({
  name: 'active_vendors',
  help: 'Number of currently approved vendors',
  registers: [register],
});

const webhookEventsTotal = new Counter({
  name: 'webhook_events_total',
  help: 'Total number of webhook events received',
  labelNames: ['event', 'status'], // charge.success/transfer.success/etc, processed/failed
  registers: [register],
});

const rateLimitHitsTotal = new Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['limiter'], // api/auth/upload/orders/webhook/etc
  registers: [register],
});

// Middleware to track HTTP metrics
export const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  const route = req.route?.path || req.path || 'unknown';
  
  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
    httpRequestDuration.observe({ method: req.method, route }, duration);
  });
  
  next();
};

// Helper functions for other parts of the app
export const metrics = {
  // DB
  recordDbQuery: (operation, status, durationMs) => {
    dbQueriesTotal.inc({ operation, status });
    dbQueryDuration.observe({ operation }, durationMs / 1000);
  },
  updatePoolUsage: (used, free, pending) => {
    dbPoolUsage.set({ state: 'used' }, used);
    dbPoolUsage.set({ state: 'free' }, free);
    dbPoolUsage.set({ state: 'pending' }, pending);
  },
  
  // Business
  orderCreated: (paymentStatus) => ordersCreatedTotal.inc({ payment_status: paymentStatus }),
  orderPaid: () => ordersPaidTotal.inc(),
  escrowHeld: () => escrowHeldTotal.inc(),
  escrowReleased: () => escrowReleasedTotal.inc(),
  payoutAttempt: (status) => payoutAttemptsTotal.inc({ status }),
  vendorSignup: (status) => vendorSignupsTotal.inc({ status }),
  setActiveVendors: (count) => activeVendors.set(count),
  webhookEvent: (event, status) => webhookEventsTotal.inc({ event, status }),
  rateLimitHit: (limiter) => rateLimitHitsTotal.inc({ limiter }),
};

export { register };

// Metrics endpoint handler
export const metricsHandler = async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).send(err.message);
  }
};