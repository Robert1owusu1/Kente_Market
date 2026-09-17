// Sentry initialization must happen BEFORE Express is imported so that
// @sentry/node can instrument it. ESM static imports execute in source order
// before any top-level code, so server.js imports this module first.
import 'dotenv/config';
import { initSentry } from './utils/sentry.js';

initSentry();