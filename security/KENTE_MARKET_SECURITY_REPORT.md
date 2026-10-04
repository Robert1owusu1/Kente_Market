# Kente Market — Pre-Launch Security Assessment

**Targets:** `kente-market.vercel.app` (frontend) · `kente-api.onrender.com` (backend API)
**Date:** 2 October 2026
**Method:** source-code review of the local project · local exploitation harness · passive production fingerprinting
**Verdict:** the codebase is **genuinely well-hardened** — substantially above typical for this stack. Two configuration findings remain, both fixable with environment variables before launch.

---

## 0. Scope, authorization & safety

You confirmed you are authorized to test this platform pre-launch. Production was treated as **read-only** throughout, consistent with your instruction not to let attacks affect live production.

**Everything sent to production (complete list):**

| # | Request | Purpose |
|---|---|---|
| 1 | `GET /` | header / fingerprint capture |
| 2 | `GET /api/tryon/status` × 8 | observe `RateLimit-*` header keying (KTM-01/02 evidence) |
| 3 | `OPTIONS /`-class CORS probe | confirm allow-list behaviour |
| 4 | `GET /api/products`, `/api/tryon/status` | endpoint reachability |

No login attempts, no POST/PUT/DELETE, no payload injection, no load, no writes. **All exploitation was performed locally** against `backend/seclab/`, which imports the project's *own* `middleware/rateLimitMiddleware.js`.

---

## 1. Findings

### KTM-01 — Global rate-limit bucket behind the proxy chain
**Severity: HIGH** (conditional — verify deployed `TRUST_PROXY` first, ~5 min)

| | |
|---|---|
| **Location** | `backend/server.js:116–123` (`app.set('trust proxy', …)`)<br>`backend/middleware/rateLimitMiddleware.js:45–57` (`authLimiter`, key = `req.ip`)<br>Config values: `backend/.env.example:13` (`TRUST_PROXY=0`), `.deploy/DEPLOY.md:79` and `.deploy/ARM_VM_SETUP.md:62` (both `TRUST_PROXY=1`) |
| **Root cause** | Real chain is **client → Cloudflare → Render → app = 2 proxy hops** (confirmed by `Server: cloudflare`, `CF-RAY`, `x-render-origin-server: Render`). Express returns the right-most `X-Forwarded-For` entry that is *not* a trusted hop. With `TRUST_PROXY=1` only the Render socket is trusted, so `req.ip` resolves to **Cloudflare's edge IP — identical for every visitor.** |
| **Exploit scenario** | An unauthenticated attacker sends **5 failed logins**. Because every user shares one bucket, `authLimiter` (max 5 / 15 min) is exhausted **site-wide**: no customer can log in for 15 minutes, repeatably. The shared bucket also applies to `apiLimiter` (600 / 15 min for the whole site) — a few dozen page views of real traffic would 429 the entire application. |
| **Status** | **Mechanism reproduced locally** with the project's real middleware (below). Whether it is live depends on the value actually set in Render. |

**Local reproduction — `backend/seclab/{app.mjs,run.mjs}`:**

```
=== TRUST_PROXY=1  (deployed per DEPLOY.md) ===
req.ip attacker=104.16.0.1  victim=104.16.0.1  -> SHARED BUCKET
  ATTACKER  attempt 1..5 -> HTTP 401  (failed logins, counted)
  VICTIM    attempt 1    -> HTTP 429  (blocked - bucket already empty)
  VICTIM    attempt 2    -> HTTP 429  (blocked)

=== TRUST_PROXY=2  (fixed: 2 proxy hops) ===
req.ip attacker=203.0.113.10  victim=198.51.100.20  -> separate buckets
  ATTACKER  attempt 1..5 -> HTTP 401  (his own allowance)
  VICTIM    attempt 1..2 -> HTTP 401  (normal - unaffected)
```

**Remediation**

```bash
# Render → Environment → set BOTH before launch
TRUST_PROXY=2        # Cloudflare + Render = 2 hops
REDIS_URL=redis://…  # see KTM-02
```

```js
// backend/server.js:116-123 — fail loudly instead of silently merging all users
const trustProxySetting = process.env.TRUST_PROXY !== undefined
  ? Math.max(0, Math.min(parseInt(process.env.TRUST_PROXY, 10) || 0, 3))
  : (process.env.NODE_ENV === 'production' ? 0 : 1);

if (process.env.NODE_ENV === 'production') {
  const expected = Number(process.env.EXPECTED_TRUST_PROXY);
  if (Number.isFinite(expected) && trustProxySetting !== expected) {
    console.error('❌ TRUST_PROXY mismatch — rate limiting will key on the wrong IP');
    process.exit(1);            // must equal proxy hops in front of the app
  }
}
app.set('trust proxy', trustProxySetting);
```

> **Why it is silent:** nothing errors, no log line appears, and the limiter keeps returning valid `RateLimit-*` headers — it simply counts everyone together. It only becomes visible once real traffic starts, i.e. at launch. Your own comment at `server.js:114` anticipates the opposite risk (spoofing) — spoofing is *not* the problem here; under-counting hops is.

**Verification step:** Render dashboard → Environment → read `TRUST_PROXY`.
- `1` or `0` → **exploitable today, fix before launch**
- `2` → KTM-01 does not apply; only KTM-02 remains

---

### KTM-02 — Rate-limit store is per-instance (no shared Redis)
**Severity: MEDIUM** · **Confirmed on production**

| | |
|---|---|
| **Location** | `backend/server.js:183` (warning) · `backend/middleware/rateLimitMiddleware.js:16–19` (`redisStore()` returns `{}` when `REDIS_URL` unset) |
| **Evidence** | 8 read-only GETs returned **two independent counters** — bucket A (`reset ~900`): 598→596→594→592→590; bucket B (`reset ~707`): 586→584→582. Two counters = two instances each with its own in-memory store. |
| **Impact** | Limits are **split** across instances (effective cap roughly double the configured value, so weaker than designed), and **all counters reset to full on every redeploy** — an attacker can simply wait for a deploy to reclaim a fresh allowance. |
| **Trigger** | `server.js:183` already warns: *"REDIS_URL not set — rate limiting is per-instance; set it before scaling to multiple instances."* Two instances are live, so the warned condition is met. |
| **Remediation** | Set `REDIS_URL` in Render. Your `rate-limit-redis` + `redis` deps are already installed and `createRateLimitStore()` activates automatically — **config only, no code change.** |

---

### KTM-03 — `Access-Control-Allow-Origin: *` on Vercel static assets
**Severity: INFORMATIONAL**

`GET https://kente-market.vercel.app/` returns `Access-Control-Allow-Origin: *`. Acceptable for public static assets served without credentials, and the **API correctly uses an allow-list** (see §2). No action required; noted for completeness.

---

### Minor observations (no action required)
- `vary: Accept-Encoding,Accept-Encoding` — duplicated token on the Render origin (harmless; cosmetic).
- `crypto.randomInt(100000, 999999)` at `utils/emailService.js:70` — upper bound is exclusive so `999999` is never issued. Trivial, no security impact.

---

## 2. Positive controls verified (this is the bulk of the audit)

The prior `PRODUCTION_HARDENING_AUDIT.md` did real work. The following were **checked and confirmed sound**:

| Area | Evidence |
|---|---|
| **No hardcoded secrets** | Backend: every credential is `process.env.*`; no literal matched `SECRET/API_KEY/PASSWORD = '…'`. `server.js:166-168` **hard-fails boot** if `JWT_SECRET` missing in production; `server.js:143` refuses a fallback session secret. Frontend: only `VITE_PAYSTACK_PUBLIC_KEY` (public by design). |
| **Secrets not committed** | Root `.env` is empty, no `backend/.env`. `branding_house.sql` (26 KB) is **schema + category seed only** — no user rows, hashes or tokens. `.gitignore` covers `.env*`. |
| **CORS** | Explicit **allow-list** (`securityMiddleware.js:64-100`); never reflects an arbitrary origin; comment explicitly rejects wildcard-with-credentials and untrusted Vercel previews. Production probe: no `ACAO` echoed to an unknown origin. |
| **Webhook signature** | `paymentRoutes.js:268-284`: HMAC-**SHA512** over the **raw** body (`req.rawBody`, captured at `server.js:199`), compared with `timingSafeEqual`. Plus idempotency claim (`webhook_events`), reference-must-map-to-exactly-one-order, and **full order amount validated in kobo** before flipping to paid. |
| **Injection (SQL)** | Queries use `pool.execute('… ?', [params])` throughout; dynamic `SET ${sets}` clauses build column names from **hard-coded allow-lists** (`vendorController.js:762`, `campaignController.js:68`). Dynamic `SELECT ${column} FROM ${table}` only ever receives literals. Interpolated `LIMIT/OFFSET/ORDER BY` pass through `safeLimit`/`safeSortBy` sanitizers. |
| **AuthN / AuthZ** | JWT in httpOnly cookie; `tokenVersion` **session revocation** on password/email change (`authMiddleware.js:73,153`); role guards `protect`/`admin`/`vendor`/`vendorOrStaff` + granular staff `requireVendorPermission`. `getAllMessages` is `protect, admin`. |
| **IDOR / BOLA** | Ownership checks confirmed on orders (`orderController.js:512,558,846`), messages (`msg.vendorId !== req.user.id`, `customerId` check, thread query filters `m.customerId = ?`), vendor coupons (incl. a **patched** NULL-`vendorId` BOLA documented at `vendorController.js:741-746`), try-on predictions (`prediction.userId !== req.user.id`). Coupon/promotion routes are `protect, admin`. |
| **Brute force** | `authLimiter` 5/15 min, `staffAuthLimiter` keyed **email+IP**, `passwordResetLimiter` 3/h, OTP verify rate-limited, `registerLimiter` 10/15 min — **plus** DB-level lockout: 10 failures → 1 h (`usersModel.js:475`). Two independent layers. |
| **OTP** | `crypto.randomInt` (CSPRNG), 10-min expiry (`emailService.js:69-79`). |
| **Uploads** | Magic-byte sniffing for PNG/JPEG/GIF/WebP, **SVG rejected**, decompression-bomb dimension cap 8192 px (`utils/imageValidator.js`). Path-traversal guard `assertKeySafe` restricts keys to `^(products\|references)/[^/]+$` (`storageService.js:20-29`). |
| **XSS (frontend)** | **Zero** matches for `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, `eval` across `src/`. JWT never stored in localStorage — only the profile object (`authSlice.ts:22`). |
| **CSRF** | Double-submit token, HMAC with `JWT_SECRET`, `timingSafeEqual` (`csrfMiddleware.js:30-35,140`); localhost bypass disabled in production. |
| **Error handling** | 4xx messages pass through; **5xx always generic** `'An error occurred'`; stack logged server-side only (`errorMiddleware.js:19-23`). |
| **Headers** | Both origins send CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, COOP, CORP, Referrer-Policy, Permissions-Policy. API origin additionally: `origin-agent-cluster`, `x-download-options`, `x-permitted-cross-domain-policies`, `x-dns-prefetch-control`. |
| **Dependencies** | All current, no known CVEs: `express 5.1.0`, `jsonwebtoken 9.0.3`, `multer 2.0.2`, `axios 1.12.2`, `helmet 8.1.0`, `bcryptjs 3.0.2`, `express-rate-limit 8.2.1`, `mysql2 3.15.0`. |
| **AI feature (try-on)** | Fail-closed flag (`isTryOnEnabled`), per-user daily credit cap, ownership check on status polling, outbound call to a fixed Replicate URL. |
| **Test suite** | **46/46 local unit tests pass** (`npm run test:unit`) — covering escrow, refunds, stock races, idempotency, upload validation, path traversal, session revocation. |

---

## 3. Evidence index

| Artifact | Path |
|---|---|
| Evidence page (screenshot source) | `backend/seclab/results.html` |
| Screenshots (viewport + full page) | `C:\Users\leonl\AppData\Local\Temp\opencode-browser-UgGLaO\0\screenshot.png`<br>`C:\Users\leonl\AppData\Local\Temp\opencode-browser-WixA2J\0\screenshot.png` |
| Exploit harness | `backend/seclab/app.mjs`, `backend/seclab/run.mjs` |
| Raw machine-readable results | `backend/seclab/results.json` |
| Local static server | `backend/seclab/serve.mjs` (`http://127.0.0.1:4310/results.html`) |

**Re-run the exploit:**
```bash
cd backend/seclab && node run.mjs     # prints both scenarios, writes results.json
```

---

## 4. Priority actions before launch

| # | Action | Effort | Finding |
|---|---|---|---|
| **P0** | Read deployed `TRUST_PROXY` in Render; set to **`2`** (Cloudflare + Render = 2 hops) | 1 env var | KTM-01 |
| **P0** | Set `REDIS_URL` so limiters share one durable store | 1 env var | KTM-02 |
| **P1** | Add the `EXPECTED_TRUST_PROXY` fail-fast guard to `server.js` | ~8 lines | KTM-01 |
| **P2** | (Optional) Serve CSP in report-only mode for a few days to catch any inline-script regressions before enforcing | config | hygiene |

Both P0 items are **environment variables only — zero code changes, zero regression risk**, which is exactly what you want this close to launch.

---

## 5. Not tested / residual risk

- **Authenticated API surface** — no credentials were used, so handler-level logic (escrow, payouts, refunds) was reviewed by reading source but not exercised end-to-end. Your existing tests cover much of this; a staging pass with a test vendor account would close the gap.
- **`TRUST_PROXY` actual value** — the single open question; KTM-01's applicability hinges on it.
- **Render XFF behaviour** — the analysis assumes Render appends the connecting hop (standard behaviour). If Render instead replaces the header with the true client IP, `TRUST_PROXY=1` would already be correct and KTM-01 downgrades to informational.
- **No load / DoS testing** was performed against production, by design.
