# Bonwire Kente — Go-Live Checklist

A practical, ordered runbook to take the platform from the current (fully local)
state to a live launch. Work top to bottom. Each feature we built ships **OFF /
unpriced by design**, so nothing charges customers until you deliberately switch
it on here.

Legend: `[ ]` = do it · **Admin page** = the admin dashboard section · `setting`
= a row in the `settings` table (set via the admin UI noted, or SQL).

---

## 0. Before anything — environment & secrets

- [ ] **Decide hosting.** The project is currently fully local (`backend/.env`
  points at local MySQL; no TiDB/Vercel/Render/Redis/Sentry). For production you
  need a real DB host, a Node host for the API, and a static host for the SPA.
- [ ] **Backend `.env` for production** (keep the current local one for dev):
  - `NODE_ENV=production`
  - `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` → production DB; `DB_SSL=1` (+ `DB_SSL_CA` for a verified cert) if the DB requires TLS.
  - `FRONTEND_URL` → **a single production origin** (e.g. `https://bonwirekente.com`). *Single-origin matters:* it fixes the one OAuth-state test and is the correct value for prod. Multiple comma origins are only for local dev ports.
  - `OAUTH_CALLBACK_URL` → `https://api.yourdomain.com` (bare https origin).
  - `COOKIE_SAME_SITE=none` **only if** the SPA is on a different origin than the API (then `NODE_ENV=production` is required and cookies ship `Secure`); otherwise `lax`.
  - `JWT_SECRET`, `SESSION_SECRET` → fresh long random values (do **not** reuse the dev ones).
  - `EMAIL_USER/EMAIL_PASSWORD/EMAIL_FROM` → a real transactional mailbox (gift-card codes, OTP, order emails depend on it).
  - `PAYSTACK_SECRET_KEY` → **live** `sk_live_…` (test `sk_test_…` for staging).
  - Optional: `REDIS_URL` (multi-instance rate limiting), `SENTRY_DSN` (error monitoring), `REPLICATE_API_TOKEN` (AI try-on — only if you turn try-on on).
- [ ] **Frontend `.env`:** `VITE_PAYSTACK_PUBLIC_KEY` → **live** `pk_live_…`; `VITE_API_URL` = the API origin (empty only when same-origin via a proxy).
- [ ] **Never commit real secrets.** Confirm `.env` files are git-ignored.

---

## 1. Database

- [ ] **Back up** the target DB before migrating (`npm run db:backup --prefix backend`, or a manual dump).
- [ ] **Run migrations:** `npm run db:migrate --prefix backend`. It is idempotent and builds a fresh DB from scratch, including the two fixes found during testing (`escrow_allocations.released_at`, `vendors.status = 'suspended'`).
- [ ] **Create the first admin:** `npm run setup-admin --prefix backend` (then log in and change the password).
- [ ] **Set VAT:** **Admin → Settings** → `tax_rate` to your real VAT percent (tests assume **15**; set what's correct for you). Orders will not price without it.

---

## 2. Paystack dashboard (do this before testing any payment)

- [ ] **Webhook URL:** add `https://api.yourdomain.com/api/payments/paystack-webhook`.
- [ ] **Enable these webhook events** (several features depend on them):
  - `charge.success`, `charge.failed` (orders, gift cards, featured, first subscription charge)
  - `transfer.success`, `transfer.failed`, `transfer.reversed` (vendor payouts)
  - `subscription.create`, `subscription.disable`, `subscription.not_renew` (vendor plans **and** Kente Club)
  - `invoice.create`, `invoice.update`, `invoice.payment_failed` (recurring renewals)
  - `refund.pending/processing/processed/failed` (refund bookkeeping, group-buy auto-refunds)
- [ ] **Keys match environment:** live keys in prod, test keys in staging — the `sk_*` (backend) and `pk_*` (frontend) must be the **same mode**.

---

## 3. Flip the feature switches (admin dashboard)

Everything below is off/zero until you set it. Turn on only what you want live.

### Vendor plans & onboarding — **Admin → Vendor Plans**
- [ ] For each tier (Starter/Pro/Master): **set a Price**, confirm the commission %, features and product limit, then **Activate** (this creates the Paystack Plan — needs live keys + the webhook).
- [ ] Decide the **"Require vendors to pay for a plan"** toggle:
  - **ON** → approved vendors are locked until they pick & pay for a plan. (Recommended once tiers are priced & activated.)
  - **OFF** → vendors sell at the default 10% commission with no plan (legacy mode).
- [ ] **"Require Bonwire origin before approval"** — leave **ON** (the authenticity gate). Admins then verify each vendor's origin on **Admin → Vendors** (the "Verify Bonwire origin" button) before approving.

### Featured listings — **Admin → Vendor Plans → Featured listings card**
- [ ] Set **Price per day** and **Max days**, then toggle **Enabled**. Vendors on a `featured_eligible` plan (Pro/Master) then see the ⭐ "Feature" button on their products.

### Kente Club (customer membership) — **Admin → Kente Club**
- [ ] For each tier: set **Price** + **members discount %**, then **Activate** (creates the Paystack Plan). Members then get the discount automatically at checkout.

### Affiliate / Creator program — **Admin → Referrals**
- [ ] Set `referral.enabled` **ON** and a **standard rate** (and window days). *This powers both the normal referral program and the creator program* — without it, referral links earn nothing.
- [ ] Review **creator applications** and approve creators (sets their higher rate). Rates are auto-capped at the platform commission.

### Gift cards, wholesale, pre-orders, group-buy
- [ ] **Gift cards** work as soon as Paystack is live — no admin switch. (Optional: confirm `EMAIL_*` is set so recipients get their code.)
- [ ] **B2B wholesale** is per-product: vendors edit a product → "Offer this product for wholesale" (needs the `bulk_wholesale` plan feature, i.e. Master tier). Buyers then request quotes; accepted quotes are payable on-platform.
- [ ] **Pre-orders / group-buy** are per-product: vendors edit a product → "Sell as a pre-order" and/or set a group-buy target + deadline. No admin switch.

---

## 4. Operational readiness

- [ ] **Scheduled jobs run.** The API process runs the hourly/periodic sweeps
  (escrow release, payout reconciliation, abandoned-cart email, **featured-listing
  expiry, store-credit refund reconcile, group-buy deadline evaluation**,
  subscription recovery). Confirm the API stays up (a crashed/restarting process
  skips sweeps). If you run multiple API instances, set `REDIS_URL` so rate-limit
  and scheduler locks are shared.
- [ ] **Email deliverability** verified (send a test OTP / gift card to yourself).
- [ ] **Backups scheduled** on the production DB (daily dump + retention).
- [ ] **Monitoring:** set `SENTRY_DSN` (optional but recommended) to catch runtime errors.
- [ ] **Disaster recovery** — skim `DISASTER_RECOVERY.md` and the payout/refund runbooks.

---

## 5. Test-mode payment walkthrough (do on staging with TEST keys first)

Run one real round-trip of each money flow and confirm the webhook completed it.
After each, check **Admin → Platform Earnings** reflects the income, and the
`webhook_events` table shows the event `processed`.

- [ ] **Normal order:** add to cart → checkout → pay (card + MoMo) → order shows **paid**, escrow **held**; vendor's wallet credits after delivery + 7 days.
- [ ] **Gift card:** buy a card → recipient gets the emailed code → redeem → store credit increases → use it at checkout (whole order **and** split: credit + card).
- [ ] **Vendor plan:** approve a test vendor (after Bonwire verify) → they pick a plan → "Pay for plan" → dashboard **unlocks**; `vendors.platformFeeRate` becomes the plan's rate.
- [ ] **Kente Club:** join a tier → pay → membership **active** → a subsequent order shows the members discount.
- [ ] **Featured listing:** vendor clicks ⭐ → pays → product becomes featured with an expiry; appears in featured sections; **Platform Earnings → Featured** rises.
- [ ] **B2B wholesale Phase B:** buyer requests a quote → vendor quotes → buyer accepts → **Pay now** → an escrowed order is created (platform commission applied).
- [ ] **Recurring renewal (optional):** in Paystack test mode, let a subscription renew (or simulate `invoice.update`) → membership/plan stays active, revenue books again.
- [ ] **Refund path:** cancel a paid test order → Paystack refund issued → order **refunded**, escrow voided, platform revenue reversed, any store credit returned.

---

## 6. Final pre-launch smoke

- [ ] `npm run db:migrate --prefix backend` once more → all ✅, no ❌.
- [ ] Backend + frontend **typecheck clean** (`npm run typecheck --prefix backend`; `npx tsc --noEmit`).
- [ ] Full test suite green with the **single-origin** `FRONTEND_URL`:
  `FRONTEND_URL=https://yourdomain.com npm test --prefix backend` → expect all pass.
- [ ] Swap **test → live** Paystack keys (backend `sk_live_*`, frontend `pk_live_*`), confirm the webhook URL points at production.
- [ ] Do **one tiny live transaction** end-to-end (a small real order) and confirm the webhook marks it paid, then refund it.
- [ ] Announce / open the doors. 🎉

---

### Quick reference — settings keys
| Setting | Controls | Set via |
|---|---|---|
| `tax_rate` | VAT % on orders | Admin → Settings |
| `vendorPlans.required` | lock approved vendors until they pay for a plan | Admin → Vendor Plans |
| `vendorPlans.bonwireVerificationRequired` | require verified Bonwire origin before approval | Admin → Vendor Plans |
| `featured.enabled` / `featured.pricePerDay` / `featured.maxDays` | paid featured listings | Admin → Vendor Plans |
| `referral.enabled` / `referral.standardRate` / `referral.windowDays` | affiliate + creator program | Admin → Referrals |

### Quick reference — what has no switch (works once Paystack is live)
Gift cards · store credit (whole + split) · last-click affiliate attribution ·
per-product: wholesale, pre-order, group-buy (vendors configure these).
