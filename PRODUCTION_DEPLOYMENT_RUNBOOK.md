# Production Deployment Runbook — Kente Market

**Human-controlled. Not executed by the engineering mission.** Run only after the staging
runbook passes and the owner has approved production. Each step names who checks it.

## 0. Go/no-go gate

- [ ] `STAGING_VALIDATION_RUNBOOK.md` acceptance criteria met (attach evidence).
- [ ] Decisions D-1…D-4 (`FINAL_PRODUCTION_READINESS_REPORT.md` §5) recorded.
- [ ] Production `exchange_rates` holds **operator-approved** rates for GBP, USD, CAD, EUR
      (the migration seeds approximations when the table is empty — D-4).
- [ ] Release commit contains every file in report §6; CI green on it.
- [ ] Maintenance window announced if desired (migrations are additive; no downtime is
      required on MySQL — confirm on TiDB in staging).

- [ ] **Vendors informed (SEC-11):** staff withdrawals now need the owner-granted
      `request_payouts` permission; `view_earnings` is read-only. Owners must re-grant it to
      staff who request payouts.
- [ ] Owner decision DEC-PAY-1 recorded (second-admin approval for manual payout bookings, or
      single admin + runbook).

## 1. Configuration checklist (Render backend)

Names only — values come from the secret store, never from a developer `.env`.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV=production` | yes | enables hard-fail checks at boot |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL=1`, `DB_SSL_CA` (if required) | yes | production TiDB only |
| `JWT_SECRET`, `SESSION_SECRET` | yes | long random, unique to production |
| `PAYSTACK_SECRET_KEY` | yes | **live** key; boot fails without it |
| `FRONTEND_URL` | yes | exact production origin (CORS/cookies); boot fails without it |
| `TRUST_PROXY` | yes | the hop count **measured on staging** (staging runbook §2, OPS-1) — Vercel rewrite + Render proxy; never `true` |
| `COOKIE_SAME_SITE` | yes | per Render/Vercel topology |
| `REDIS_URL` | recommended | shared rate limits across replicas (`rediss://`) |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` | recommended | error visibility for `ADMIN ALERT` / recovery logs |
| `METRICS_TOKEN` | if metrics scraped | |
| `EMAIL_*` / `ENABLE_EMAIL` | yes for receipts | |
| `GOOGLE_*`, `FACEBOOK_*`, `OAUTH_CALLBACK_URL` | if social login | |
| `PLATFORM_FEE_RATE`, `ESCROW_RELEASE_DAYS`, `CUSTOM_ADVANCE_RATIO` | business | do not change without owner approval |
| `PAID_EFFECTS_RECOVERY_BATCH` (50), `STUCK_PENDING_RECOVERY_BATCH` (100) | optional | new; defaults are safe |
| (none new for payouts) | — | migration 30 (`migratePayoutLifecycle.js`) must run before the new backend; it is the last step of `db:migrate` and exits 1 on any failure |
| `STORAGE_BACKEND=local` | yes | only `local` is implemented; uploads need a persistent disk |
| `AI_TRYON_*`, `REPLICATE_API_TOKEN` | if try-on enabled | |
| **Never set in production**: `ALLOW_DESTRUCTIVE_DB`, `ALLOW_REMOTE_TEST_DB`, `EMAIL_DISABLED` | | |

Vercel: `VITE_API_URL`, `VITE_PAYSTACK_PUBLIC_KEY` (**live** public key), social links.

## 2. Order of operations

1. **Freeze**: pause admin payouts/withdrawal approvals for the window.
2. **Backup**: `npm run db:backup --prefix backend` (encrypted, off-site) **and** a TiDB Cloud
   snapshot. Record the timestamp `T0`. Verify the backup file decrypts.
3. **Migrate** (from a trusted operator machine whose env points at production — never run
   `db:setup` against production; it now refuses anyway):
   `npm run db:migrate --prefix backend 2>&1 | tee migrate-prod.log`
   → explain every `Could not`/`Error` line; run `DATABASE_MIGRATION_REVIEW.md` §4 queries
   (use `T0` for the "untracked historical paid orders" check).
4. **Deploy backend** (Render) — the new code needs `orders.paymentSideEffects` (step 3).
5. **Smoke test backend**: boot log, scheduler banner, `/health`, a test-mode-free read
   path (product list), admin login.
6. **Deploy frontend** (Vercel production promote).
7. **Live smoke**: one small real purchase by staff (domestic), confirm E1 assertions,
   then refund it via admin cancel and confirm the refund journal.
8. **Unfreeze** payouts.

## 3. Monitoring for the first 72 hours

- **New jobs/behaviour after this release:** `reconcileRefundedPlatformRevenue` (hourly) backfills
  revenue reversals for historical refunded orders (≤ 100/run; see `DATABASE_MIGRATION_REVIEW.md` §8).
  `reconcileStaleRefundClaims` and `recoverStuckPendingOrders` now write `reconciliation_checks`; review
  `GET /api/admin/ops/reconciliation-reviews` daily (refund/payment items needing a human) and
  Admin → Payouts (payouts).

- `scheduler_job_status`: all `ok`; alert on `failed`.
- Logs/Sentry: `side effects incomplete`, `ADMIN ALERT`, `MANUAL RECONCILIATION REQUIRED`,
  `batch limit`, `Amount/currency mismatch`, `REFUSING`.
- `webhook_events` rows not `processed` older than 1 hour.
- Unresolved payouts: `GET /api/admin/payouts/unresolved` (or the SQL in
  `PAYOUT_RECONCILIATION_RUNBOOK.md` §1). Admin alerts "Vendor payout needs attention" and
  "Vendor wallet out of balance" are now raised automatically (deduplicated). Follow the
  runbook; never re-send a payout whose outcome is unknown.
- Before deploying, record `SELECT status, COUNT(*) FROM payout_attempts GROUP BY status`. Before any
  **code rollback**, confirm no attempt is `reconciliation_required` (the old code does not know it).
- Admin notifications titled "Paid order side effects incomplete", "Stale refund claim…",
  "Unmatched charge…".
- Daily: run the reconciliation queries in the staging runbook §4 against production
  (read-only).

## 4. Recovery / rollback

- **Code rollback**: redeploy the previous Render/Vercel release. Schema changes are
  additive; the previous backend ignores new columns. Orders paid by the new code keep
  `paymentSideEffects`; if the new code is redeployed later, recovery resumes for them.
- **Data**: never roll back the database for a code problem — money has moved at Paystack
  since `T0`. Restore from backup only for data corruption, after reconciling every
  Paystack transaction and refund since `T0` against `financial_events`.
- **Stuck money**: follow the admin alert text; never re-issue a refund without checking
  the Paystack dashboard (claims are kept on unknown outcomes on purpose).

## 5. Additions — session `566deb7e` (2026-10-12)

### 5.1 Launching without a custom domain

The current topology works on provider URLs: the SPA on `https://<project>.vercel.app`, the API on
`https://kente-api.onrender.com`, and `vercel.json` rewrites `/api/*` and `/uploads/*` to Render, so the
browser talks to one origin (first-party cookies; no third-party-cookie dependency for normal API calls).

- `FRONTEND_URL` = the exact Vercel production URL (CORS allow-list and OAuth redirects use it). Preview
  deployments get different URLs and will be refused by CORS unless added deliberately.
- `OAUTH_CALLBACK_URL` = the origin Google redirects back to; register
  `<OAUTH_CALLBACK_URL>/api/auth/google/callback` in the Google console. If you use the Vercel URL here the
  callback also goes through the rewrite (one more proxy hop — see `TRUST_PROXY`).
- Paystack dashboard (test mode until you decide otherwise): webhook URL
  `https://<vercel-or-render-url>/api/payments/paystack-webhook` (`routes/paymentRoutes.js`); callback URL =
  the Vercel URL.
- When a custom domain is bought later: update `FRONTEND_URL`, `OAUTH_CALLBACK_URL`, the Google console
  redirect, the Paystack webhook/callback, `vercel.json` if the API moves, and re-measure `TRUST_PROXY`.

### 5.2 Commission go-live checks

- [ ] Owner decision on the headline rate (10 % seeded vs 12 % advertised) and on the referral programme —
      `COMMISSION_SYSTEM_COMPLETION_REPORT.md` §6. Changing the global rule affects only orders placed after it.
- [ ] Before launch, read the active rules: `SELECT * FROM commission_rules WHERE isActive = 1`.
- [ ] No migration is needed for the commission fixes (no DDL). They take effect for orders allocated after
      the deploy; existing allocations keep their stored fee.
- [ ] Staging scenarios E33–E41 passed.

### 5.3 OAuth

- [ ] SEC-12: sign-ins whose provider email is **not verified** are now refused with the generic
      `google_failed` error (previously they could link to an existing account). Expect no impact on normal
      Gmail accounts. Facebook login has no routes and stays disabled; if it is ever enabled, its profile does
      not carry a verified flag and every email-based Facebook sign-in would be refused until that is designed.

### 5.4 Test → live payments (do not do this until you decide to)

Switching Paystack to live is a separate, owner-run change: swap `PAYSTACK_SECRET_KEY` (Render) and
`VITE_PAYSTACK_PUBLIC_KEY` (Vercel) to live keys **together**, update the live-mode webhook URL in the
Paystack dashboard, redeploy both, then do the single staff purchase + refund in §2 step 7. Transfers
(vendor withdrawals) also need live-mode transfer recipients; test-mode recipient codes do not carry over.

### 5.5 Referral programme (session `566deb7e`)

- [ ] Migration `migrateReferrals.js` (additive: new tables, nullable/defaulted columns, three settings rows
      that keep the programme **off**). It is the last step of `db:migrate`; run on TiDB staging first (E23-style).
- [ ] Coupon behaviour changes at deploy for new orders: admin coupons are funded by the platform, seller
      coupons by the seller (`COMMISSION_SYSTEM_COMPLETION_REPORT.md` §7). Tell sellers before go-live.
      Existing admin coupons above the platform rate are not edited; checkout caps them per item.
- [ ] Turn the programme on only after: the headline platform rate is set, the referral rate is chosen
      (≤ platform rate), and staging E42–E56 pass.
- [ ] Referral withdrawals use the same Paystack balance as vendor payouts (`kente_rtr_` references); the
      transfer webhook URL is unchanged.
- [ ] Monitoring: admin alert "Referral withdrawal needs attention"; jobs `promoteReferralCommissions`,
      `reconcileReferralRefunds`, `recordMissingReferralCommissions`, `reconcileReferralWithdrawals` in
      `scheduler_job_status`; Admin → Referrals "Under review" list.
- [ ] Legal: Terms need a referral section (eligibility, window, no refund on orders paid with earnings,
      reversal on refunds) — `REFERRAL_SYSTEM_DESIGN.md` §8.

## 6. Additions — session `fe49cfc1` (2026-10-12)

### 6.1 Corrections to §1
- **`STORAGE_BACKEND`:** §1 says "only `local` is implemented". That is wrong — `Services/storageService.js`
  implements `s3` (S3-compatible, SigV4) for `/api/upload`. Choose: `local` **with a persistent disk**, or `s3`
  with `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`
  (`S3_PATH_STYLE` if the provider needs it). Since 2026-10-13 profile pictures also go through the storage
  backend (STORE-1 fixed), so `s3` needs no persistent disk.
- **`FRONTEND_URL`:** bare https origin(s); the **first** is the canonical base of reset links, OAuth redirects,
  Paystack `callback_url` and referral links (CFG-1 fixed 2026-10-13; boot refuses malformed entries).
- **`OAUTH_CALLBACK_URL`:** an origin only — the code appends `/api/auth/google/callback`.
- **`DB_SSL_CA`:** required with `DB_SSL=1` in production (boot refuses otherwise unless
  `DB_SSL_ALLOW_UNVERIFIED=1`, which should not be used).
- **Before deploy:** `npm run preflight --prefix backend -- --target=production --db` on the production host (0 FAIL);
  **after deploy:** `npm run smoke --prefix backend -- --web=<prod-origin> --api=<api-origin>` (all PASS).

### 6.2 Additional go/no-go items
- [ ] `STAGING_VALIDATION_RUNBOOK.md` §9 completed, including the measured `TRUST_PROXY` value with evidence and
      the TiDB checklist (§9.8). TiDB compatibility is **unverified** until then.
- [ ] Production Paystack dashboard (live mode) webhook URL set to the production API; live keys only in the
      production secret store.
- [ ] Owner decisions recorded: FV-9, R-6 (incl. refunds after vendor payout), R-7, REF-ASYNC follow-up
      (`DATABASE_AND_FINANCIAL_INTEGRITY_REPORT.md` §4).
- [ ] Admin on-call knows the two new alerts: "Paystack refund FAILED — customer not refunded" (refund the customer
      manually in Paystack; do not re-run cancel/return) and "Refund after vendor payout — manual recovery needed"
      (listed in `GET /api/admin/ops/reconciliation-reviews`).
- [ ] Optional: the production DB may carry 3 redundant indexes from older migration runs (MIG-3,
      `DATABASE_AND_FINANCIAL_INTEGRITY_REPORT.md` §1). Harmless; drop only after review.

### 6.3 Monitoring additions
- `financial_events` rows with `eventType='refund.failed'` — each needs a manual customer refund.
- `reconciliation_checks` with `job='refundAfterRelease'` and `state='needs_review'`.
