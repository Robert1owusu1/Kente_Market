# Staging Validation Runbook — Kente Market release candidate

Purpose: prove on infrastructure that matches production (TiDB Cloud, Render, Vercel,
Paystack **test mode**) what local validation could not: TiDB compatibility, provider
behaviour, and end-to-end flows. Every step is human-executed. Nothing here touches the
production database or live Paystack keys.

## 0. Preconditions (all must be true before starting)

1. A **separate** TiDB Cloud database (or cluster) for staging, restored from a recent
   production backup with customer PII **scrubbed**, or seeded test data. Never the
   production database.
2. Separate Render service + Vercel preview pointing at staging; staging-only
   `JWT_SECRET`, `SESSION_SECRET`, `METRICS_TOKEN`.
3. `PAYSTACK_SECRET_KEY` / `VITE_PAYSTACK_PUBLIC_KEY` = Paystack **test** keys. Paystack
   test-mode webhook URL set to the staging API (`/api/payments/paystack-webhook`).
4. `EMAIL_DISABLED=1` or a sandbox SMTP (Mailtrap or similar). No real customer emails.
5. The release commit includes **every untracked file** listed in
   `FINAL_PRODUCTION_READINESS_REPORT.md` §6 (migrations and services referenced by
   `package.json` and imports — a tracked-only commit breaks `db:migrate` and boot).
6. CI green on the release commit (secret scan, typecheck ×2, lint, DB-less tests, vitest,
   audit ratchet, build, MySQL 8.4 full suite).

## 1. Schema migration on staging

```bash
npm run db:backup --prefix backend            # against STAGING env
npm run db:migrate --prefix backend 2>&1 | tee migrate-staging.log
grep -nE "Could not|Error|failed" migrate-staging.log   # every hit must be explained
```
Then run every query in `DATABASE_MIGRATION_REVIEW.md` §4. Specifically confirm on TiDB:
- `user_addresses.countryCode` — now a **VIRTUAL** generated column (TIDB-1, changed
  2026-10-12 because TiDB rejects adding a STORED one). Expect `Added user_addresses.countryCode`
  and `Added idx_addresses_country` in the log. If either fails, record the message; no
  application code reads the column, so it does not block checkout.
- `orders.paymentSideEffects` exists and is `json`.
- `uq_custom_requests_orderId` was added (no duplicates reported).

**Acceptance:** all §4 queries return the expected values; no unexplained `Could not`.

## 2. Boot and health

- Backend starts; logs show `MySQL Connection Established` and the scheduler banner
  including `incomplete paid orders 15m`.
- `scheduler_locks` and `scheduler_job_status` exist (`migrateOps.js`); after 30 min,
  `SELECT jobName,lastStatus,lastError FROM scheduler_job_status` shows `ok` for
  `recoverIncompletePaidOrders`, `recoverStuckPendingOrders`, `reconcileStaleRefundClaims`,
  `reconcileUnmatchedCharges`, `reconcileRefundedButPaid`.
- Health endpoints answer without exposing config or secrets.
- **Proxy hop count (OPS-1).** Traffic reaches Node through the Vercel rewrite *and* Render's
  proxy. From two different networks (e.g. office Wi-Fi and a phone on mobile data), hit an
  endpoint through the Vercel domain and read `req.ip` in the backend log (temporarily raise
  log level or use the request log). Increase `TRUST_PROXY` until each client shows **its own**
  public address, and record the value. Then call `https://<render-host>/api/...` directly with
  a forged `X-Forwarded-For: 1.2.3.4` and confirm the logged IP is **not** `1.2.3.4` (otherwise
  restrict direct origin access). Wrong values either put every customer in one rate-limit
  bucket or let callers choose their IP.

## 3. End-to-end scenarios (Paystack test mode)

Record order ids and references for each. "Journal" = `financial_events`.

| # | Scenario | Expected |
|---|---|---|
| E1 | Domestic (GH) single-vendor order, card, webhook delivered | order `paid`; `paymentSideEffects` has all 4 markers true; one `charge.collected:<ref>` journal row; stock −qty once; allocations `held`; **one** confirmation email |
| E2 | Same, but block the webhook (wrong URL) and complete via return to site | verify-paystack flips; same assertions as E1 |
| E3 | Re-send the same webhook from the Paystack dashboard | 200 "Duplicate ignored"; nothing changes |
| E4 | Mixed order: platform product + vendor product + coupon | coupon slot settled once (`couponUseState=2`); `platform_revenue.discountAmount` = discount × platform share of the **whole** order; vendor allocation + platform net + discount = gross |
| E5 | Multi-vendor order, then return approved for one vendor (partial) | only that vendor voided; `refundedAmount` incremented; response `refundOutcome` |
| E6 | Full return approved | Paystack test refund issued; order `refunded`; stock restored; admin sees success toast |
| E7 | Full return where the refund fails (refund an already-refunded test charge) | admin sees **warning** toast; order stays `paid` or claim kept as described in `SECURITY_FINDINGS.md` R-5 |
| E8 | Admin cancel of a paid order | refund once; repeat cancel does not refund again |
| E9 | Pay for an order, cancel it before the webhook arrives (late charge) | late-charge refund via reconciliation; no resurrection to `paid` |
| E10 | Custom request: submit → vendor quote → accept → pay | **201**; order `paid` with the customer's delivery address; advance allocation `available` + wallet credit; balance `held` |
| E11 | International order (GB) with configured carrier rate and **operator-entered** FX rate | shipping converted to GHS server-side; charge in GHS; order snapshot stores currency/rate |
| E12 | International lane with **no** carrier rate | observe the fallback-price behaviour (decision D-3) and confirm it matches what the business approved |
| E13 | Remove the FX rate for a currency | checkout returns `SHIPPING_FX_UNAVAILABLE` (fail closed), nothing charged |
| E14 | Vendor withdrawal ≤ available balance (transfers in test mode) | ledger debit + payout attempt; transfer webhook settles; balance reconciles |
| E15 | Crash recovery: pause the DB connection mid-webhook (or kill the process right after the paid flip) | order is `paid` with missing markers; within ~25 min `recoverIncompletePaidOrders` completes it; stock taken exactly once |
| E16 | Tenant isolation: vendor A requests vendor B's product/coupon/staff/order ids | 403 on every write; no data from B returned |
| E17 | Two browser tabs submit the same vendor withdrawal simultaneously | one transfer; `SUM(payout_attempts.amount)` + remaining `payoutAmount` = original (also covered locally by `withdrawalConcurrency.test.js`) |
| E18 | R-8 redesign: withdraw 40 of a 100 allocation, then 60; make the **first** transfer fail (Paystack test-mode failing recipient, if available) | first attempt → `failed`, allocation back to `available` with 40, wallet unchanged until the 60 succeeds; no webhook 500; `GET /api/admin/payouts/unresolved` empty afterwards |
| E20 | Double-click Withdraw in the vendor UI | one `vendor_withdrawals` row, one transfer; second click shows "already submitted" |
| E21 | Turn on transfer OTP in Paystack test mode (if offered) and withdraw | admin alert "provider_otp"; funds stay reserved; resolving in the dashboard settles via webhook |
| E22 | Block the webhook URL, withdraw, wait > 30 min | reconciler settles from `transfer/verify`; `checkCount` / `lastCheckedAt` advance; no duplicate transfer at Paystack |
| E23 | Run migration 30 on TiDB staging | all statements succeed (ENUM append, 14 columns, 2 indexes, `vendor_withdrawals`); script exits 0; re-run exits 0 |
| E24 | Admin → Payouts (`/admin?section=payouts`): open an unresolved test payout, press **Verify with Paystack** | outcome message matches Paystack test-mode state; `success` settles once; `pending` changes nothing; history shows `payout.reconcile` |
| E25 | Park a payout (e.g. send a test webhook with a wrong amount), then try Verify without the acknowledgement/note, then with them | 400 without; with them it stays `reconciliation_required` (mismatch) and history shows `payout.review.reverify` with the note |
| E26 | As a vendor-role user and as staff, call `/api/admin/payouts/*` | 403 (authenticated) / 401 (anonymous); no Paystack call |
| E27 | Staff with only `view_earnings` tries to withdraw; owner grants `request_payouts`; a staff manager tries to grant it to someone | 403 "Missing permission: request_payouts"; then 200; manager grant refused |
| E28 | Paystack test webhook burst: ≥ 15 concurrent `charge.success` deliveries for distinct pending orders (pool default 10) | all 200 within seconds; every order `paid` with complete `paymentSideEffects` (FV-13) |
| E29 | Create > 100 abandoned test checkouts (pending, with references), then pay one new order with the webhook blocked; wait for `recoverStuckPendingOrders` | the paid order is recovered on the next run; abandoned ones show back-off in `reconciliation_checks` (FV-7) |
| E30 | Fully refund (cancel) a paid order that contains a platform-owned product | `platform_revenue` has a `refund` row = −`platform_product`; journal `platform_revenue.reversed` (FV-8) |
| E31 | Partial vendor refund while that vendor's payout is in flight, then make the transfer fail | money clawed back (wallet −amount, allocation `failed`), not withdrawable (INT-1) |
| E32 | TiDB: run migration 31; `EXPLAIN` the FV-6/FV-7 selections (`LEFT JOIN reconciliation_checks … ORDER BY (rc.lastCheckedAt IS NOT NULL), rc.lastCheckedAt`) and `reconcileAvailableAllocations` (`NOT EXISTS` on `wallet_transactions`) | migration exit 0 twice; no full scans of `orders`/`wallet_transactions` beyond the bounded population |
| E19 | Force a backend error on a cached GET (e.g. stop the DB for one product-detail request), then restore and reload | the reload shows the product (errors are no longer cached — SEC-8); a provider 401 during checkout shows an error, not a logout (SEC-7) |

## 4. Reconciliation checks after the scenarios

```sql
-- every tracked paid order complete
SELECT id, paymentSideEffects FROM orders WHERE paymentStatus='paid' AND paymentSideEffects IS NOT NULL
  AND (JSON_EXTRACT(paymentSideEffects,'$.stockDecremented') IS NULL OR JSON_EXTRACT(paymentSideEffects,'$.escrowHeld') IS NULL);
-- no duplicate charge journals
SELECT reference, COUNT(*) FROM financial_events WHERE eventType='charge.collected' GROUP BY reference HAVING COUNT(*)>1;
-- wallet = ledger
SELECT w.vendorId, w.available_balance,
       (SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) FROM wallet_transactions t
         WHERE t.vendorId=w.vendorId AND t.status='succeeded') AS ledger
  FROM vendor_wallets w HAVING ROUND(available_balance,2) <> ROUND(ledger,2);
-- stuck webhooks
SELECT event, reference, processing_status, last_error FROM webhook_events WHERE processing_status <> 'processed';
```
(The wallet/ledger query is indicative — adjust to the ledger's debit types used by withdrawals.)

## 5. Rollback criteria (stop the release)

Any of: a paid order without a `charge.collected` journal; any duplicate journal, refund,
or stock decrement; a refund without a refund journal; wallet ≠ ledger; a cross-tenant
read/write; a migration statement failing without explanation; boot failure; a scheduler
job in `failed` state that is not understood.

## 6. Acceptance criteria

All of §1–§4 pass; decisions D-1…D-4 in the final report are recorded; a staging
penetration test of auth, upload and checkout endpoints has been done or explicitly
waived by the owner.

## 7. Additions — commission completion and OAuth (session `566deb7e`, 2026-10-12)

Run after §3. Record the allocation rows (`SELECT vendorId, allocationType, amount, platformFeeRate, platformFee, payoutAmount, status FROM escrow_allocations WHERE orderId = ?`).

| # | Scenario | Expected |
|---|---|---|
| E33 | Admin → Commissions: create a **category** rule (e.g. 12 % on one category), a **vendor** rule and a **product** rule | each saves (201) and the list shows its target (COM-1 — this failed with 400 before); `admin_audit_log` has `commission.create` with the full rule |
| E34 | One vendor, two products: one with a product rule (20 %), one without (global 10 %); 1 × 100 each | one allocation: amount 200, `platformFee` 30, `payoutAmount` 170 (COM-3) |
| E35 | Product in the category with the 12 % rule, 2 × 100, no vendor/product rule | `platformFee` 24 (COM-2) |
| E36 | Place an order, then change the vendor's rule, then deliver + release | wallet credit = the payout frozen at checkout, not the new rate (COM-5) |
| E37 | Custom request **without** a base product: quote → accept → pay | advance + balance allocations exist for the weaver; advance credited (COM-4) |
| E38 | Vendor → Settings | "Platform Commission" equals the rate the engine resolves for the vendor (vendor rule, else global) (COM-7) |
| E39 | Coupon order across two vendors; then refund one vendor; then cancel the rest | `Σ payout + Σ fee + discount = goods gross`; after the vendor refund only that vendor's fee is gone; after cancel `SUM(platformFee) WHERE status <> 'failed'` = 0 |
| E40 | Google sign-in with an account whose Google email is verified (normal) | links / signs in as before (SEC-12 must not block it) |
| E41 | `TRUST_PROXY` measurement (OPS-1): from two different networks hit `/api/auth/csrf-token` through the Vercel URL and check the logged `req.ip` differs and is the client's address | set `TRUST_PROXY` to the measured hop count before go-live |

Reconciliation query for commission (read-only):

```sql
-- every allocation balances to the pesewa
SELECT id FROM escrow_allocations WHERE ROUND(platformFee + payoutAmount, 2) <> ROUND(amount, 2)
  AND status IN ('pending','held');
-- commission earned per day (excludes voided/refunded allocations)
SELECT DATE(created_at) d, SUM(platformFee) FROM escrow_allocations WHERE status <> 'failed' GROUP BY d;
```
(`payoutAmount` on `available` rows shrinks with partial withdrawals, so the first query only checks unreleased rows.)

## 8. Referral programme and coupon funding (session `566deb7e`)

Preconditions: migration `migrateReferrals.js` ran (last step of `db:migrate`); Admin → Referrals: set a
standard rate (e.g. 0.04, must be ≤ the global platform rate), choose 30 days / 1 year, turn on.

| # | Scenario | Expected |
|---|---|---|
| E42 | User A copies the link from "Refer & Earn"; in a **different browser**, open it, register user B, verify email | `users.referredBy` of B = A; A's page shows "1 people signed up"; no commission |
| E43 | Same as E42 but register B in the **same browser** A uses | B is not attributed (same device) |
| E44 | Register `a.lias+x@gmail.com` through A's link (A = `alias@gmail.com`) | not attributed |
| E45 | B buys GH₵1,000 (test card); webhook delivered | commission `pending` 4 % of list price; A's balance unchanged |
| E46 | Re-send the webhook from Paystack; also reload the success page (verify) | still exactly one commission |
| E47 | B's order delivered and escrow released (or wait for auto-release) | commission `available`, A's balance +40 once |
| E48 | Admin coupon 10 % on a GH₵1,000 item at 20 % platform | customer 900, seller payout 800, referral 40 |
| E49 | Seller coupon 10 % on the same item | customer 900, seller payout 700, referral 40 |
| E50 | Admin tries a 50 % admin coupon or a referral rate above the platform rate | 400 with "cannot exceed the platform commission" |
| E51 | Full refund of an `available` commission's order | commission `reversed`, A's balance −40 (can go negative) |
| E52 | Partial (one-vendor) refund on a two-vendor referred order | commission reduced to the other vendor's share |
| E53 | B pays with the same card A used before | commission `under_review`; Admin → Referrals shows the reason; approve/reject requires a note and is audited |
| E54 | A adds a test MoMo payout account and withdraws ≥ GH₵10 | `processing` → `paid` only after Paystack's transfer webhook/verify; balance reconciles |
| E55 | Block the transfer webhook, withdraw, wait > 30 min | reconciler settles from `transfer/verify`; no duplicate transfer |
| E57 | Seller S copies the store link from Vendor dashboard → Refer Customers; customer C opens it on **C's own phone**, registers, buys S's product, order completes | S's referral balance +4 % of list price; S's vendor payout for the sale unchanged (price − platform commission) |
| E56 | A pays a whole order with earnings (checkbox), then tries to cancel / request a return | order paid (`referral_credit`); cancel and return answer 409 "final"; seller escrow held normally |

Reconciliation (read-only):
```sql
-- wallet = ledger
SELECT w.userId, w.balance, SUM(l.amount) ledger FROM referral_wallets w JOIN referral_ledger l ON l.userId = w.userId
 GROUP BY w.userId HAVING ROUND(w.balance,2) <> ROUND(ledger,2);
-- never more than one commission per order (enforced by UNIQUE, should return 0 rows)
SELECT orderId, COUNT(*) FROM referral_commissions GROUP BY orderId HAVING COUNT(*) > 1;
-- platform never negative after referral
SELECT rc.id FROM referral_commissions rc WHERE rc.amount > rc.cap;
```

## 9. Staging preparation — session `fe49cfc1` (2026-10-12). PREPARED, NOT EXECUTED

Nothing in this section has been run. It complements §0–§8; where they overlap, follow the stricter rule.

### 9.1 Hosting requirements

| Component | Requirement |
|---|---|
| Frontend | Static host serving `dist/` (`npm run build`), SPA fallback to `index.html`, and same-origin rewrites of `/api/*` and `/uploads/*` to the **staging** API. On Vercel: a separate project or a preview whose `vercel.json` rewrites point at the staging API — the committed `vercel.json` points at the production API (`kente-api.onrender.com`) and **must not** be used unchanged for staging. Build env: `VITE_API_URL` empty, `VITE_PAYSTACK_PUBLIC_KEY` = **pk_test**. |
| Backend | Node 22, `npm ci --omit=dev` in `backend/`, start `npm start` (`NODE_ENV=production`, Sentry preloaded). One instance first (the scheduler runs in-process; multi-instance only after the lock is validated). Must not sleep: all recovery jobs stop while the process is down (free tiers sleep; `keep-alive.yml` targets production only). |
| Database | **Dedicated staging TiDB** database/cluster (never the existing hosted DB); TLS (`DB_SSL=1`, `DB_SSL_CA` if the provider needs it); user with DDL rights for migration, DML for runtime. |
| File storage | Either a persistent disk mounted at `backend/uploads`, or `STORAGE_BACKEND=s3` with a **staging** bucket. Note STORE-1: profile pictures always go to local disk, so without a persistent disk they vanish on redeploy. |
| Redis | Optional; recommended if more than one instance (shared rate limits, single-use nonces). |

### 9.2 Generated URLs and CORS (no custom domain needed)

1. Deploy the backend first → note its generated URL (`https://<staging-api>.onrender.com`).
2. Point the staging frontend's rewrites at it; deploy → note the frontend URL (`https://<staging-web>.vercel.app`).
3. Backend `FRONTEND_URL` = the frontend origin (scheme + host, no path). Since CFG-1 was fixed it may list several
   comma-separated origins: all are allowed by CORS/CSRF and the **first** is the canonical base of reset links,
   OAuth redirects, Paystack `callback_url` and referral links. Production boot refuses any entry that is not a bare
   https origin. Preview URLs are deliberately **not** allowed.
4. `COOKIE_SAME_SITE=lax` while the SPA calls the API same-origin through the rewrite (recommended). Only if the SPA
   calls the API cross-site directly: `none` (requires `NODE_ENV=production`; boot refuses otherwise).
5. `OAUTH_CALLBACK_URL` = `https://<staging-web>` — an **origin only**; the code appends `/api/auth/google/callback`
   (correction: an earlier draft of this step gave the full path, which would double it). Register
   `https://<staging-web>/api/auth/google/callback` in a **staging** Google OAuth client.
6. Verify: `curl -sI -H "Origin: https://<staging-web>" https://<staging-web>/api/products` shows
   `Access-Control-Allow-Origin` equal to the origin; with `Origin: https://evil.example` it must not.

### 9.3 TRUST_PROXY — derive, then verify (do not guess)

Topology to establish: browser → Vercel edge (rewrite) → Render edge/load balancer → Node. Each proxy that appends
to `X-Forwarded-For` is one hop. Procedure:
1. Start with `TRUST_PROXY=1`. Enable request logging (`LOG_FORMAT` default logs `ip`).
2. From two different networks, request `GET https://<staging-web>/api/products` and read the logged `ip`.
3. If both requests log the same address (a proxy's), increase by 1 and repeat (code caps at 3).
4. Pick the **smallest** value at which each client logs its own public IP.
5. Spoof test: `curl -H "X-Forwarded-For: 1.2.3.4" https://<staging-web>/api/products` and directly
   `https://<staging-api>.onrender.com/api/products` — the logged ip must **never** be `1.2.3.4`. If the direct
   origin call can spoof, restrict direct origin access or lower the value and accept per-proxy bucketing.
6. Confirm the login limiter buckets per client: 6 wrong passwords from network A → 429 for A only; B still gets 401.
Record the measured value and evidence; production uses the same value only if the topology is identical.

### 9.4 Database and migrations

```bash
# on the operator machine, env pointing ONLY at the staging TiDB (check DB_HOST twice)
cd backend
node -e "require('dotenv').config(); console.log(process.env.DB_HOST, process.env.DB_NAME)"   # visual check
npm run db:migrate 2>&1 | tee migrate-staging-1.log ; echo "exit=$?"
npm run db:migrate 2>&1 | tee migrate-staging-2.log ; echo "exit=$?"      # idempotency on TiDB
grep -nE "Could not|Error|failed" migrate-staging-*.log                   # explain every hit (MIG-2)
```
- Fresh staging DB: `db:setup` refuses non-loopback hosts by design (S-2). Load `branding_house.sql` with the TiDB
  client instead, then `db:migrate`. Never set `ALLOW_DESTRUCTIVE_DB`.
- Compare schemas of run 1 and run 2 (`SHOW CREATE TABLE` for the money tables) — must be identical.
- **Rollback limits:** migrations are additive with no down-migration chain; a code rollback leaves new columns in
  place (old code ignores them). Do not restore the database to undo a code problem once test payments have moved.
- TiDB compatibility remains **UNVERIFIED** until §9.8 passes.

### 9.5 Paystack test mode and webhooks

- Backend `PAYSTACK_SECRET_KEY` = **sk_test** of a Paystack test integration; frontend pk_test of the same account.
- Webhook URL in the Paystack dashboard (test mode): `https://<staging-web>/api/payments/paystack-webhook` (or the
  API URL directly). Signature: HMAC-SHA512 of the raw body with the secret key in `x-paystack-signature`; unsigned
  or re-serialised bodies are rejected (400). Events consumed: `charge.success`, `charge.failed`,
  `transfer.success|failed|reversed`, `refund.pending|processing|processed|failed` (recorded; `refund.failed` alerts).
- Never put a live key in staging; never point the live dashboard webhook at staging.

### 9.6 Scheduler, health and monitoring

- Boot log shows the scheduler banner; after 30 min `SELECT jobName,lastStatus,lastError FROM scheduler_job_status`
  shows `ok` for every job in `SYSTEM_INVENTORY.md` §6.
- Health: `/health/live` (process), `/health/ready` (DB; 503 `DEGRADED` when down). Point the host health check at
  `/health/ready`. `/metrics` only with `METRICS_TOKEN`.
- Sentry with `SENTRY_ENVIRONMENT=staging`. Watch admin notifications: "Paystack refund FAILED…", "Refund after
  vendor payout…", "Vendor payout needs attention", "Paid order side effects incomplete".

### 9.7 Additional staging scenarios (this session's fixes)

| # | Scenario | Expected |
|---|---|---|
| S1 | Copy the `#token=` from a Google sign-in callback URL into a `jwt` cookie and call `/api/users/profile` | 401 (VAL-1) |
| S2 | Two simultaneous referral withdrawals for one ambassador | one 202, one 400; no 500 (VAL-2) |
| S3 | Refund a test charge, then use the Paystack test tools (if available) to produce `refund.failed`, or send a dashboard test event | one admin alert, one `financial_events` `refund.failed` row; redelivery "Duplicate ignored" (REF-ASYNC) |
| S4 | Complete an order, let escrow release to the vendor, then cancel/refund it | allocation stays `released`; one "Refund after vendor payout" alert; `reconciliation_checks` row `needs_review` |
| S5 | Order update with only `totalAmount` | 400 (VAL-5) |
| S6 | Run `db:migrate` twice on staging TiDB | both exit 0; schema unchanged (VAL-3/4) |

### 9.8 TiDB verification checklist (closes "TiDB UNVERIFIED")

Run on staging TiDB: §9.4 twice; E7/E8/E17/E28 and S2 concurrency scenarios; check FK enforcement
(`SELECT @@tidb_enable_foreign_key`, insert an orphan row in a test transaction and expect failure) or record that
FKs are not enforced; `EXPLAIN` the recovery queries (E32). Record the TiDB version.

### 9.9 Staging test data and cleanup

- Use dedicated accounts with an identifiable pattern (e.g. `stg+<role>-<n>@<your-domain>`), and a dedicated test
  vendor and products titled `STAGING …`. Never import real customer PII unscrubbed.
- Cleanup after acceptance: the simplest safe method is to **drop the whole staging database** (it is dedicated).
  If it must be kept, delete in child-to-parent order scoped to the test user ids (referral_ledger,
  referral_withdrawals, referral_wallets, referral_commissions, financial_events, wallet_transactions,
  payout_attempts, vendor_withdrawals, escrow_allocations, order_items, vendor_order_items, return_requests, orders,
  webhook_events by reference prefix, notifications, products, vendors, users), and void outstanding test-mode
  transfers/refunds in the Paystack test dashboard. Never run these deletes with production credentials loaded.

## 10. Staging launch procedure (prepared 2026-10-13, session `fe49cfc1`) — human-executed, in order

Tools added for this (no data changes, never print secret values):
`npm run preflight --prefix backend -- --target=staging [--db]` (config + optional read-only schema check) and
`npm run smoke --prefix backend -- --web=https://<staging-web> [--api=https://<staging-api>]` (read-only HTTP checks).

| # | Step | Done when |
|---|---|---|
| 1 | **Release commit.** Commit the working tree on a release branch, including **all 87 untracked files** (code, migrations, tests, reports) and the 83 modified/deleted tracked files. Verified locally: a clean copy of exactly that file set (no `.env`, no uploads) installs fresh, passes the full suite and builds (`LOCAL_SYSTEM_TEST_REPORT.md` §Release set). | CI green on the commit, including the MySQL job (which now fails on any skipped suite) |
| 2 | **Staging database.** Create a dedicated TiDB database/cluster. Load `branding_house.sql` with the TiDB client (`db:setup` refuses remote hosts by design), then run `npm run db:migrate` twice from an operator shell whose env points only at staging (§9.4). | both runs exit 0; every `Could not` line explained |
| 3 | **Object storage (recommended).** Create a staging bucket + key (S3-compatible). Set `STORAGE_BACKEND=s3` and `S3_*` (public base URL recommended). Alternative: `local` + a persistent disk on `backend/uploads`. | preflight storage line PASS |
| 4 | **Backend service.** Node 22; build `npm ci --omit=dev` in `backend/`; start `npm start`; health check path `/health/ready`; one instance; no sleeping plan. Environment (names in `SYSTEM_INVENTORY.md` §9): `NODE_ENV=production`, staging-only `JWT_SECRET`/`SESSION_SECRET`/`METRICS_TOKEN`, `PAYSTACK_SECRET_KEY` = **sk_test**, `DB_*` + `DB_SSL=1` + `DB_SSL_CA` (host CA bundle, e.g. `/etc/ssl/certs/ca-certificates.crt` on Debian/Ubuntu images — confirm on the host — or TiDB Cloud's CA file), `TRUST_PROXY=1` provisionally, `COOKIE_SAME_SITE=lax`, `FRONTEND_URL` (set after step 5; boot refuses until it is valid), `EMAIL_DISABLED=1` or a sandbox SMTP, Sentry with `SENTRY_ENVIRONMENT=staging`. | service deployed (it may crash-loop until step 5 sets `FRONTEND_URL`) |
| 5 | **Frontend.** Separate Vercel project (or preview) whose rewrites point `/api/*` and `/uploads/*` at the **staging** API — do **not** use the committed `vercel.json` unchanged (it targets production). Build env: `VITE_API_URL` empty, `VITE_PAYSTACK_PUBLIC_KEY` = **pk_test** of the same Paystack account. Then set backend `FRONTEND_URL=https://<staging-web>` and `OAUTH_CALLBACK_URL=https://<staging-web>`; redeploy the backend. | SPA loads |
| 6 | **Preflight on the backend host** (shell with the service env): `npm run preflight --prefix backend -- --target=staging --db`. | 0 FAIL; each WARN read and accepted; TiDB version recorded |
| 7 | **Smoke:** `npm run smoke --prefix backend -- --web=https://<staging-web> --api=https://<staging-api>` | 13/13 PASS |
| 8 | **TRUST_PROXY measurement** (§9.3); set the measured value; redeploy; re-run step 7. | value + evidence recorded |
| 9 | **Paystack test webhook** URL set to `https://<staging-web>/api/payments/paystack-webhook` in **test mode**; Google OAuth staging client registered (§9.2). | a test-mode charge reaches `paid` |
| 10 | **Scenarios** E1–E56 (§3, §7, §8) and S1–S6 (§9.7); TiDB checklist (§9.8); reconciliation queries (§4). | §6 acceptance criteria met |
| 11 | **Cleanup / teardown** (§9.9). | staging DB dropped or test data removed |

Stop conditions: any FAIL in steps 6–7 that is not understood; §5 rollback criteria.
