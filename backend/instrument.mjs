// FILE: backend/instrument.mjs
// DESCRIPTION: Sentry SDK initialization — loaded BEFORE server.js via
//   --import flag so auto-instrumentation (DB monitoring, tracing, profiling)
//   hooks into Node.js diagnostics_channel before any other module.
//   Inert without SENTRY_DSN: all Sentry calls become safe no-ops.

import 'dotenv/config';
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    integrations: [nodeProfilingIntegration()],
    profileSessionSampleRate: 1.0,
    maxValueLength: 500,
    maxBreadcrumbs: 80,
  });
  console.log(`🔷 Sentry initialized (env: ${process.env.NODE_ENV || "development"}, profiling: enabled)`);
} else {
  console.log("🔷 Sentry disabled (set SENTRY_DSN in backend/.env to enable)");
}