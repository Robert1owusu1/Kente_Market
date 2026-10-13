# System Inventory — Kente Market

Derived from the code on branch `fix/global-production-integration` (working tree, 2026-10-12), not from older
documents. No credentials appear here — variable **names** only.

## 1. Components and topology

| Component | Tech | Hosting (per repo config) | Entry point |
|---|---|---|---|
| Frontend SPA | React 19, Vite 7, TypeScript, Redux Toolkit (RTK Query), Tailwind 4 | Vercel; `vercel.json` rewrites `/api/*` and `/uploads/*` to `https://kente-api.onrender.com` (same-origin cookies) | `src/main.tsx` → `src/App.tsx` |
| Backend API | Node 22, Express 5 (ESM), mysql2 | Render (`kente-api.onrender.com`); alt. ARM VM docs in `.deploy/` | `backend/server.js` (`npm start` loads Sentry first) |
| Scheduler | In-process `setInterval` jobs inside the API process, MySQL distributed lock | same process as the API (no separate worker) | `backend/utils/cleanupJobs.js` `scheduleJobs()` |
| Database | MySQL-compatible: TiDB Cloud (production), MySQL 8.4 (CI/local) | TiDB Cloud | `backend/config/db.js` |
| CI | GitHub Actions: gitleaks, tsc ×2, eslint, DB-less tests, vitest, audit ratchet, build, MySQL 8.4 full suite; `keep-alive.yml` pings `/health` every 6 h; `backup.yml` | GitHub | `.github/workflows/` |

## 2. Frontend routes and journeys (`src/App.tsx`)

| Access | Routes |
|---|---|
| Public | `/`, `/products`, `/product/:id`, `/topproducts`, `/trendingproducts`, `/store/:slug`, `/vendors`, `/museum`, `/aboutus`, `/contactus`, `/help`, `/terms`, `/privacy`, `/reviews`, `/suggestions`, `/cart`, `/cartpage`, `/ai-tryon`, `/unsubscribe`, `*` (404) |
| Auth flow | `/login`, `/register`, `/oauth/callback`, `/forgot-password`, `/reset-password/:token` |
| Signed in (`PrivateRoute`) | `/verify-email`, `/vendor/apply` |
| Signed in + verified (`VerifiedRoute`) | `/profile`, `/wishlist`, `/checkout/:id`, `/order/:id`, `/orders`, `/messages`, `/certificates`, `/referrals`, `/customize/:id`, `/custom-requests`, `/custom-requests/:id/checkout`, `/vendor` (vendor dashboard; API enforces vendor/staff) |
| Admin (`AdminRoute`) | `/admin`, `/admin/dashboard` — sections: dashboard, analytics, insights, orders, products, moderation, categories, customers, vendors, coupons, promotions, campaigns, commissions, payouts, referrals, returns, reviews, buyback, certificates, inbox, subscribers, suggestions, settings |

Journeys: browse → cart (server cart, guest merge) → checkout (domestic GH or international GB/US/CA/DE/NL; GHS
charge) → Paystack inline → webhook/verify → order tracking → confirm receipt → escrow release; returns; custom
requests (quote → accept → pay advance); referral link capture → signup → commission → withdraw/pay-with-earnings;
vendor apply → products → orders → withdrawals; staff login; AI try-on.

Frontend route guards are UX only — every authorization decision is enforced by the API (§3).

## 3. Backend API (244 endpoints in 38 routers; mounts in `server.js`)

Global middleware order (`server.js`): `trust proxy` setting → compression → helmet/CORS/hpp (`setupSecurity`) →
cookie-parser → `/api` device-id cookie → session (MySQL store) → passport → `/api/upload` (limiter + CSRF, before
body parsers) → JSON/urlencoded (1 MB, raw body kept for webhook HMAC) → request logger → `/uploads` static
(traversal-guarded) and `/images` static → `/api` global limiter → `/api` CSRF (Origin check + signed
double-submit) → health/metrics → routers → 404 → error handler.

| Mount | Auth model |
|---|---|
| `/api/products`, `/api/categories` (GET), `/api/reviews` (GET), `/api/promotions/public/*`, `/api/campaigns` (GET), `/api/vendors/store|directory|fulfillment`, `/api/checkout/international` (countries, validate-address, shipping-options), `/api/certificates/verify/:x` | public (product reads use `optionalAuth`) |
| `/api/users` | register/auth/forgot/reset/verify (dedicated limiters), profile `protect`, user admin `protect+admin` |
| `/api/auth` | Google OAuth (signed state cookie, single-use nonce), `/oauth/exchange` (purpose-bound single-use token), `/csrf-token`, `/consent` |
| `/api/orders` | create `protect+requireVerifiedEmail+orderLimiter`; read/update/confirm owner-or-admin; pay/deliver/cancel/retry-escrow/stats `admin` |
| `/api/payments` | `/paystack-webhook` HMAC-SHA512 (raw body, constant time) + `webhookLimiter`; `/verify-paystack` `protect` |
| `/api/vendors` | owner/staff via `vendorOrStaff` + `requireVendorPermission(...)`; approval/status `admin` |
| `/api/vendors/staff` | staff login (limited) + management `manage_staff` |
| `/api/referrals` | `/visit` public (limited); `/me`, payout account, withdraw, pay-order `protect` (+money limiter) |
| `/api/admin/{commissions,moderation,ops,payouts,referrals}`, `/api/settings`, `/api/coupons` (except `/validate`) | `protect+admin` |
| `/api/cart` | `optionalAuth` |
| `/api/addresses`, `/api/wishlist`, `/api/designs`, `/api/notifications`, `/api/payments/methods`, `/api/support`, `/api/messages`, `/api/returns`, `/api/custom-requests`, buyback (`/api/orders/:id/buyback`, `/api/admin/buyback`), `/api/suggestions`, `/api/reports`, `/api/profile`, `/api/tryon` | `protect`, ownership checked per record (admin variants `admin`) |
| `/api/upload` | product images `admin`; reference images `protect`; magic-byte validation |
| `/health`, `/health/ready`, `/health/live` | public; `/metrics` requires `METRICS_TOKEN` |

## 4. Roles and permission boundaries

| Role | Source | Boundary |
|---|---|---|
| Visitor | none | public reads, cart, referral capture, contact, newsletter |
| Customer | `users.role='customer'`, JWT cookie (`id`, `role`, `tv`) | own records only; email verification required to order |
| Ambassador (referrer) | every registered user (`users.referralCode`) | own referral wallet; withdrawals need verified email + payout account; suspension flag |
| Vendor (owner) | `users.role='vendor'` + `vendors.status='approved'` | own products/orders/coupons/wallet; pending store refused |
| Vendor staff | `vendor_staff` table, separate JWT (`role:'vendor_staff'`, rejected by `protect`) | parent vendor's data limited by permissions: `manage_orders`, `view_customers`, `manage_inventory`, `manage_products`, `manage_coupons`, `manage_storefront`, `manage_staff`, `view_earnings`, `request_payouts` (owner-grant only) |
| Admin | `users.role='admin'` | everything admin-gated; single admin tier (no dual control — DEC-PAY-1) |

Session revocation: `tokenVersion` (`tv`) checked on every request; bumped on logout/password/email change.
Purpose-bound tokens (`oauth_exchange`, `oauth_state`, `register_pending`, `legal_consent`, `referral_visit`) are
refused as sessions (VAL-1).

## 5. Database (60 tables)

Core: `users`, `user_addresses`, `user_devices`, `sessions`, `settings`, `categories`, `product`, `stock_moves`,
`product_sales_daily`, `carts`, `wishlist`, `designs`, `reviews`, `review_reports`, `notifications`, `contacts`,
`subscribers`, `suggestions`, `support_tickets`, `message_posts`, `vendor_messages`, `promotions`, `campaigns`,
`campaign_products`, `campaign_vendors`, `authenticity_certificates`, `ai_tryon_usage`, `admin_audit_log`.
Orders/checkout: `orders`, `order_items`, `vendor_order_items`, `vendor_order_fulfillment`, `order_vendor_marks`,
`coupons`, `payment_methods`, `custom_requests`, `return_requests`, `buyback_requests`, `exchange_rates`,
`shipping_carriers`, `shipping_rates`, `vendor_shipping_destinations`.
Money: `escrow_allocations`, `vendor_wallets`, `wallet_transactions`, `vendor_withdrawals`, `payout_attempts`,
`financial_events` (append-only journal), `platform_revenue`, `commission_rules`, `referral_commissions`,
`referral_wallets`, `referral_ledger`, `referral_withdrawals`, `webhook_events`.
Ops: `scheduler_locks`, `scheduler_job_status`, `reconciliation_checks`, `vendors`, `vendor_staff`.

Migrations: `setupDB.js` (loads `branding_house.sql`; refuses non-loopback hosts) then the 32 scripts of
`npm run db:migrate` in `backend/package.json` order (`migrateNewTables` … `migrateReferrals`). All additive and
re-runnable; there is no migrations-history table — idempotency is per statement (existence checks / duplicate codes).

## 6. Background jobs (`cleanupJobs.js`; each under a distributed lock, status in `scheduler_job_status`, failures alerted)

| Job | Interval | Purpose |
|---|---|---|
| cleanupUnverifiedUsers | 24 h | remove stale unverified signups |
| autoReleaseExpiredEscrows / autoReleaseExpiredVendorEscrows | 2 h | release escrow after the window (guards: paid, not cancelled/refunded) |
| recoverStuckPendingOrders | 30 min | verify pending orders with references at Paystack; back-off (FV-7) |
| recoverIncompletePaidOrders | 15 min | finish paid side effects after a crash |
| releaseExpiredReservations | 30 min | return reserved stock of expired checkouts |
| escalateStaleCustomRequests | 1 h | SLA escalation |
| scanWishlistRestocks / scanWishlistPriceDrops / sendAbandonedCartEmails | 1 h | marketing notifications |
| reconcileStuckTransfers | 30 min | vendor payouts awaiting Paystack |
| reclaimStaleProcessingWebhooks | 15 min | crashed webhook claims → retryable |
| reconcileAvailableAllocations | 15 min | stranded wallet credits |
| reconcileRefundedButPaid / reconcileStaleRefundClaims | 15 min | refund claims → provider state |
| reconcileRefundedPlatformRevenue | 1 h | FV-8 revenue reversals |
| reconcileUnmatchedCharges | 30 min | charges without an order |
| promoteReferralCommissions / reconcileReferralRefunds / recordMissingReferralCommissions / reconcileReferralWithdrawals | 30 min | referral lifecycle |
| sendWeeklyVendorDigest | 7 days (not on boot) | vendor email digest |

Jobs run only while the API process is up — a sleeping host (free tier) pauses all recovery.

## 7. External services

| Service | Used for | Config names |
|---|---|---|
| Paystack | charges (inline JS), verify, refunds, transfer recipients, transfers, banks list, webhooks | `PAYSTACK_SECRET_KEY`, `VITE_PAYSTACK_PUBLIC_KEY` |
| Google OAuth | sign-in/sign-up | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_CALLBACK_URL` (Facebook strategy present, no routes) |
| SMTP (nodemailer) | OTP, receipts, alerts, digests | `ENABLE_EMAIL`, `EMAIL_SERVICE`/`EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM`, `EMAIL_DISABLED` |
| Replicate | AI try-on | `AI_TRYON_ENABLED`, `REPLICATE_API_TOKEN`, `AI_TRYON_*` |
| Redis (optional) | shared rate limits, single-use nonce store | `REDIS_URL` |
| Sentry (optional) | errors/traces | `SENTRY_*` |
| S3-compatible storage (optional) | product/reference uploads (`/api/upload`) and profile pictures (`/api/profile/upload`, since STORE-1) | `STORAGE_BACKEND=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`, `S3_PATH_STYLE` |

## 8. Payment, commission, referral, refund, escrow and payout paths

- **Charge:** `POST /api/orders` (server prices, stock reserved) → owner binds `paymentReference` (`PUT /api/orders/:id`) → Paystack inline → `charge.success` webhook **or** `POST /api/payments/verify-paystack` **or** `recoverStuckPendingOrders` → validated flip (amount + GHS + single row) → `applyPaidOrderSideEffects` (stock, coupon, revenue, escrow hold, referral, journal; marker-tracked).
- **Commission:** `commissionService` resolves product → category → vendor → global rule per line; snapshot frozen on the order (`commissionSnapshot`); fee stored per allocation.
- **Referral:** `POST /api/referrals/visit` cookie → bind at signup → commission at paid flip (pending/under_review) → available when escrow released → withdraw (`kente_rtr_` transfers) or pay an order; refunds adjust/reverse.
- **Escrow:** allocations `pending → held → available (wallet credit) → releasing → released` or `failed` (void/clawback).
- **Payout:** `POST /api/vendors/withdraw` → reservation committed before Paystack → transfer → `transfer.*` webhook / `reconcileStuckTransfers` → settle once; ambiguous → reserved/`reconciliation_required`; admin `/api/admin/payouts/*`.
- **Refund:** admin cancel (`PUT /api/orders/:id/cancel`), return approval (`PUT /api/returns/:id`, full or per-vendor partial), late-charge reconciliation → shared `orders.refundReference` claim → Paystack refund → journal `refund:<id>`; `refund.*` webhooks recorded, `refund.failed` alerts.

## 9. Environment variables by component (names only)

**Backend — required in production:** `NODE_ENV`, `PORT` (host-provided), `FRONTEND_URL`, `TRUST_PROXY`,
`COOKIE_SAME_SITE`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`, `DB_SSL_CA` (if needed),
`JWT_SECRET`, `SESSION_SECRET`, `PAYSTACK_SECRET_KEY`.
**Backend — feature/optional:** `OAUTH_CALLBACK_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`,
`FACEBOOK_APP_SECRET`, `ENABLE_EMAIL`, `EMAIL_*`, `REDIS_URL`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`,
`SENTRY_TRACES_SAMPLE_RATE`, `METRICS_TOKEN`, `LOG_FORMAT`, `STORAGE_BACKEND`, `S3_*`, `AI_TRYON_*`,
`REPLICATE_API_TOKEN`, `PLATFORM_FEE_RATE`, `ESCROW_RELEASE_DAYS`, `CUSTOM_ADVANCE_RATIO`, `MAX_OTP_ATTEMPTS`,
`OTP_EXPIRY_MINUTES`, `CART_RECOVERY_COOLDOWN_HOURS`, `PAID_EFFECTS_RECOVERY_BATCH`, `STUCK_PENDING_RECOVERY_BATCH`,
`DB_POOL_SIZE`, `DB_WARM_CONNECTIONS`, `API_RATE_LIMIT_MAX`.
**Backend — never in production:** `ALLOW_DESTRUCTIVE_DB`, `ALLOW_REMOTE_TEST_DB`, `EMAIL_DISABLED`,
`DB_SSL_ALLOW_UNVERIFIED`, `SEED_ADMIN_PASSWORD` (seed script only).
**Backups (operator machine/VM):** `BACKUP_DIR`, `BACKUP_PASSPHRASE`, `BACKUP_RETENTION`, `BACKUP_UPLOADS`.
**Frontend (Vercel, build-time, public):** `VITE_API_URL` (empty on Vercel), `VITE_PAYSTACK_PUBLIC_KEY`,
`VITE_SOCIAL_INSTAGRAM`, `VITE_SOCIAL_FACEBOOK`, `VITE_SOCIAL_LINKEDIN`, `VITE_SOCIAL_WHATSAPP`.

`backend/.env.example` documents every variable the runtime code reads (DOC-1 closed 2026-10-13; checked by
scanning all `process.env.*` reads). Formats that matter: `FRONTEND_URL` = comma-separated bare origins, the first
is the link/redirect base (read only through `config/frontendOrigins.js`; production boot refuses non-https or
path-bearing entries); `OAUTH_CALLBACK_URL` = an **origin** (the code appends `/api/auth/google/callback`);
production `DB_SSL=1` needs a readable `DB_SSL_CA` or boot refuses.

**Operator tools:** `npm run preflight --prefix backend -- --target=staging|production [--db]`,
`npm run smoke --prefix backend -- --web=<origin> [--api=<origin>]` (see `STAGING_VALIDATION_RUNBOOK.md` §10).
