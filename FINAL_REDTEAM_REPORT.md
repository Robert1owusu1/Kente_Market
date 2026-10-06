# Kente Market — Final Red-Team Report

**Target:** current working tree of `/home/roberto/Documents/project/ecom_new`
**Repository:** https://github.com/Robert1owusu1/Kente_Market
**Pass:** final adversarial review — every earlier fix re-verified from scratch, nothing accepted on the strength of a comment or a prior report
**Classification:** no real credentials, secrets, tokens or personal data are reproduced in this document

---

## 1. Scope, method and trust model

Two earlier models applied fixes and wrote reports (`REMEDIATION_REPORT.md`,
`REDTEAM_VERIFICATION_REPORT.md`, `SECURITY_AUDIT_REPORT.md`,
`PRODUCTION_HARDENING_AUDIT.md`). None of their claims were trusted. Every
finding was re-derived from the code, and where a claim mattered (money,
tenant isolation) it was re-proven live or by mutation.

Method used throughout:

1. Read the enforcement point, not the comment — middleware mount, controller
   branch, SQL predicate, DB constraint.
2. Build the exploit: modify/replay/concurrent requests, change IDs and JSON,
   call endpoints directly, rotate headers, send malformed input. The frontend
   is treated as an attacker-controlled convenience layer.
3. Fix only what is proven exploitable, and prove each fix by **mutation**:
   revert the fix, watch the new test fail, restore.
4. Re-run the whole suite plus the exact CI commands.

Where a prior report and the code disagreed, the code won (see §5).

---

## 2. Threat actors and coverage

| Actor | Capabilities modelled | Findings raised against it |
|---|---|---|
| Anonymous | unlimited requests, rotating `X-Forwarded-For`, malformed URLs/paths, no session | `redactUrl` DoS (P0, fixed), rate-limit bypass (P1, fixed), lockout maintenance (P2, fixed), enumeration oracles (P3: registration 400-vs-201 bounded by a per-email limiter; coupon/username oracles open), unauthenticated `/metrics` (P3, open) |
| Customer | owns orders/coupons, can replay and race their own checkout, can hit APIs directly | escrow under-allocation on multi-unit lines (P0, fixed), V-01 gross/net charge divergence (fixed this pass), V-04 coupon cap bypass (fixed this pass), refund double-spend (V-07, fixed) |
| Malicious vendor / compromised vendor staff | vendor JWT, vendor-scoped routes, own products/orders | vendor order-status PII + sibling line leak (P1, fixed), fulfilment forward-jump (V-11, fixed), staff permission gaps (P3, open) |
| Malicious admin / staff | privileged routes, mark-paid, cancel, coupon issuance | refund CAS on admin cancel (V-07, fixed), uncapped % coupon → negative `totalAmount` (P3, open) |
| Supply chain / CI maintainer | pushes to `main`, controls dependencies | missing secret scan / audit gate / DB job in CI (P2, **fixed this pass**), `axios@1.19.0` (P2, **fixed this pass**) |

---

## 3. Successful attacks (proven this pass)

| # | Attack | Actor | Result before fix | Severity | Status |
|---|---|---|---|---|---|
| A-1 | `POST /api/orders` with a line `qty: 3, price: 100` | customer | escrow created for **1** unit → 200 of vendor money never held | **P0** | fixed + tested |
| A-2 | `GET /?%=1` (also `?%ZZ=1`, `?%`) | anonymous | `redactUrl` threw `URIError` inside `res.on('finish')` → `uncaughtException` → **process exit** | **P0** | fixed + tested + live re-verified |
| A-3 | `GET /api/vendor-orders/:id` with a sibling vendor's line in the same order | vendor staff | raw row returned: buyer email, address, payment reference, sibling vendor line items and stock conflicts | **P1** | fixed + tested |
| A-4 | Reuse a password-reset URL path | anonymous (logs) | full reset token written to the access log in plaintext | **P1** | fixed + tested + live re-verified |
| A-5 | Rotate `X-Forwarded-For` while POSTing 14 passwords for one victim account | anonymous | every attempt reached the handler (401×8, forgot-password 200×8, staff 401×10) | **P1** | fixed + tested |
| A-6 | Let a locked-out victim try to self-recover with their correct password | victim of A-5 | `authenticate()` checked the lock **before** comparing, so even a successful reset left the account locked | **P1** | fixed + tested |
| A-7 | **V-01:** apply a coupon during checkout, then pay | customer (no tricks needed) | charge used the stale pre-coupon cached total → Paystack collected the **gross** amount, server had booked **net** → `verify-paystack` rejected `paidKobo !== expectedKobo` → money captured, order never flips to `paid` | **P0** | **found and fixed this pass** + tested |

### A-7 (V-01) — the fix that did not close the finding

A prior round labelled this "SECURITY FIX (V-01)" and added comments claiming
the RTK cache was invalidated. The coupon was still applied with a **raw
`axios.put`**, which never dispatches an invalidation, there was no
`refetch()`, and `refetchOnFocus` is not enabled anywhere in the app:

```ts
// src/Pages/CheckoutPage/checkout.tsx (before)
const { data } = await axios.put(`/api/orders/${preOrderId}`, { couponCode });
// comment says "Invalidate RTK query cache" — only setAppliedCoupon() ran
const payableTotal = resolvePayableTotal(serverTotal, total); // serverTotal = PRE-coupon
```

The server then rejects the collected money:

```js
// backend/routes/paymentRoutes.js
const expectedKobo = Math.round(parseFloat(order.totalAmount) * 100);
if (data.currency !== 'GHS' || paidKobo !== expectedKobo) return res.status(400)...
```

Fix applied: the coupon is now booked through the RTK `updateOrder` mutation
(which invalidates `{type:'Order', id}`) **and** the returned `totalAmount` is
latched into state, so the charge is correct even if Pay is clicked before the
refetch lands. Verified with `tsc` (0 errors), `eslint` (0 errors) and a new
regression test that fails when either half is removed.

---

## 4. Fixes that survived re-verification

| Fix | Verified by |
|---|---|
| escrow `qty` allocation | test (`3 × 100 → 300`) + mutation + `seclab/probe-escrow-qty.mjs` on live data → `underpaidBy: 0, exploitable: false` |
| `redactUrl` never throws | test over 12 malformed URLs + mutation + live (`200`, process stays up) |
| reset-token path redaction | test + mutation + live log line shows `/api/users/reset-password/[redacted]` |
| vendor order projection | test throws its own throwaway order with a sibling line and PII markers, asserts nothing survives; mutation → buyer email leak |
| account-keyed auth/reset limiters | test drives the **real** middleware with 14 rotating source IPs → exactly 5 allowed; mutation → unlimited |
| `resetPassword` clears lockout | test asserting `failed_login_attempts = 0` and `locked_until = NULL` |
| **V-02** `%2F` cross-tenant delete | `uploadRoute.js:121-132` / `:201-212`: `base !== filename \|\| '..' \|\| !/^\d+-(product\|reference)-…/` → 400 before ownership |
| **V-03** reservation leak | `orderController.js:378-399` restores `reservedUnits` with `reason:'reserve-rollback'` before the 400; `reservationService` returns `{reserved, failures}` |
| **V-05** OAuth state | signed `oauth_state` (HMAC, nonce, 10 min), httpOnly cookie, compared + signature-checked + cleared on callback (single use); Passport's own store disabled; **no Facebook route exists** |
| **V-06** staff logout principal | branches on `decoded.role === 'vendor_staff'` → bumps `vendor_staff.tokenVersion`, enforced at `authMiddleware.js:219-225` |
| **V-07** refund double-spend | all three entry points CAS-claim `refundReference IS NULL` and gate on `affectedRows === 0`, plus a UNIQUE index — **new test added** |
| **V-08** double stock restore | markers zeroed + `orderStatus='cancelled'` **before** the restore; sweeper only claims `pending` rows (CAS) — `rb01` tests 2 & 5, `rb04` |
| **V-09** Paystack path injection | `/^[A-Za-z0-9._-]{1,100}$/` (and a stricter shape) before the URL is built, then `encodeURIComponent` — **new test added** |
| **V-11** fulfilment forward jump | `nextIdx > ownIdx + 1 → 400`, covered by `vendorIsolation.test.js` |
| **V-04 / N-7** coupon cap on the money | atomic `UPDATE coupons SET usesUsed = usesUsed + 1 WHERE id = ? AND usesUsed < maxUses` claimed together with `orders.couponUseState 0→2` in one transaction; release on cancel/expiry/failure (`state 1→0`, conditional decrement); `couponMaxUses.test.js` 9 tests + **2 mutations (8/9 and 4/9 failed)** — see §6 |
| **N-2** `tv:0` tokens rejected | `authRoutes.js:243` now checks `undefined`/`null` explicitly |
| **N-4** shared `productionNote` clobber | vendor patch contains only `orderStatus`/`deliveredAt` |

**Refuted claims from earlier reports**

* *"RB-06 / V-05 OAuth state not addressed"* — **false**, it is properly
  closed (evidence above). The residual is only a missing functional test.
* *"`refundReconcile.test.js` failure is pre-existing and unrelated"* —
  **false**. It was cross-suite fixture pollution: orphaned `PARTIAL-` rows
  matched `reconcileRefundedButPaid`'s global scan. Cleaning the orphans made
  the suite pass; the file is green in every run below.

---

## 5. New vulnerabilities found in this final pass

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| N-7 | **Coupon usage cap is enforced on the counter, never on the money (V-04).** `Coupon.validate` checks `usesUsed >= maxUses` at apply time but nothing reserves a slot; consumption is deferred to payment (`escrowService.consumeCouponForOrder`) and callers ignore `consumed`. When the cap is hit the code journals `coupon.exhausted` and notifies admins — *"the discount was honored; reconcile manually"*. Attack: create N orders with a `maxUses=1` code while `usesUsed = 0` (all validate), then pay all N. N−1 discounted orders settle; the cap is never exceeded so nothing looks wrong. | **P1** (P2 if capped coupons are never issued) — **FIXED this pass** | `models/couponModel.js:185-187, 253-262`; `Services/escrowService.js:263-291`; `controllers/orderController.js:493-495`; `routes/paymentRoutes.js:196-202, 436-443`. No test asserted it → now `tests/couponMaxUses.test.js` (9 tests, 2 mutations) + migration `migrateCouponUse.js`. |
| N-8 | **Auth cookies can be issued without the `Secure` flag.** Every `secure:` option is `process.env.NODE_ENV === 'production'`, while the shipped `backend/.env` has `NODE_ENV` **empty** and `COOKIE_SAME_SITE=none`. Live: `Set-Cookie: csrf_token=…; Path=/; SameSite=None` with **no `Secure`**. `.deploy/DEPLOY.md` does set `NODE_ENV=production`, so this is a deployment footgun rather than a live breach — but nothing in the code detects it. | **P2 — FIXED this pass** | `server.js:162`, `middleware/csrfMiddleware.js:46`, `utils/generateToken.js:63`, `routes/authRoutes.js:47,61,130…` |
| N-9 | **IP-keyed limiters are fully bypassable by rotating `X-Forwarded-For`** when the Node port is reachable without an appending reverse proxy. Measured live: fixed IP → `RateLimit-Remaining` 580→579→578; rotating XFF → frozen at 598 (a fresh bucket per request), and the access log records the attacker-supplied IP. `.deploy/DEPLOY.md`'s nginx *does* append, so rightmost = real client and production is safe — but the config ships `TRUST_PROXY=1` with no guard. The account-keyed limiters are unaffected by design. | **P2 — FIXED this pass** | live measurement above; `backend/.env` `TRUST_PROXY=1`; `middleware/rateLimitMiddleware.js:46-57` |
| N-10 | **Rate-limit counters reset when Redis recovers from degraded mode.** While Redis is down the per-instance fallback counts correctly; the moment the TLS handshake lands the store switches to Redis, whose counter starts at 0 — the same 14-request probe then observed **8 allowed instead of 5**. Bounded by outage frequency, but it silently grants an extra allowance on every recovery. | **P3** | `utils/redisClient.js:129-141` (`viaRedis` switches source mid-window) |
| N-11 | **CI does not exercise most of the security surface.** No database job (in CI's DB-less mode **50 of 127 tests skipped and 15 blocks skipped entirely** — measured at the time of the finding; with this pass's new suites it is 54 of 148), no secret scan, no `npm audit` gate, and the frontend suite (`npm run test:frontend`, 44 tests) is never invoked. | **P2 — FIXED this pass** | `.github/workflows/ci.yml` |
| N-12 | **Both CI gates were red before this pass.** `npm run lint` failed with **24 errors** (unused vars in `rb01/rb02/rb04`) and `npm run typecheck --prefix backend` exited **2** (3 implicit-`any` params in `orderController.js`) — added by the earlier rounds. Fixed here; both now exit 0. | **P2 — FIXED** (trust in CI) | reproduced before/after |
| N-13 | **Frontend dependency advisory:** `axios@1.19.0` is the last vulnerable release of the 1.0.0–1.19.0 range (prototype-pollution gadgets, header injection, ReDoS, redirect-SSRF). It is a runtime dependency (`^1.11.0`); the backend already runs `1.20.0`. Frontend audit: 8 high, 2 moderate (only `axios` is runtime; the rest are `tailwindcss`/`typescript-eslint` build chain). Backend: 3 high, all in the dev-only `nodemon → chokidar → braces` chain (runtime deps audit clean). **FIXED this pass:** `axios` → `^1.20.0`, `source-map-js` → 1.2.2, and two criticals that surfaced mid-pass fixed rather than accepted (`shell-quote` → `^1.12.0` via `overrides`; `concurrently` has no fixed release and is accepted with a reason in the baseline). The remaining 5 highs are the unfixable `tailwindcss` 3.x chain — see the audit-ratchet note in §8. | **P2 — FIXED this pass** | `npm audit`, `package-lock.json:2506` |
| N-14 | **The canonical schema is stale: a database built from the repo cannot run the app.** `branding_house.sql` lacked `users.legal_consent_at` (written by `usersModel.create` and `config/passPort.js` on every signup) and the `sessions` table (`express-mysql-session`). A fresh install failed registration with `ER_BAD_FIELD_ERROR`, and **5 test suites failed the same way** — only databases created while the dump still matched the code happened to work. Invisible to CI only because CI never built a database. | **P2** (new installs, CI) — **FIXED this pass** | column diff dump-vs-live on clean MySQL 8.4 → 4 missing columns; `Unknown column 'legal_consent_at' in 'field list'`. Now the dump is synced and `migrateSchemaSync.js` (existence-checked, idempotent) covers existing databases. |
| N-15 | **`db:migrate` does not run on the database CI (and a new deploy) actually uses.** `migrateAdvanceRatio.js` used `ADD COLUMN IF NOT EXISTS` — TiDB/MariaDB syntax that **MySQL 8 rejects** — and `migrateOrderItems` / `migrateVendorOrderItems` passed `LIMIT ? OFFSET ?` to `connection.execute`, which mysql2 answers with `Incorrect arguments to LIMIT`. On stock MySQL the chain aborted at script #18, leaving half a schema. The local TiDB hid both because TiDB accepts them. | **P2** (new installs) — **FIXED this pass** | `npm run db:setup` on MySQL 8.4: exit 1 → exit 0 across all 22 steps (schema + migrations). |
| N-16 | **Product search meant two different things on the two engines.** The FULLTEXT path (MySQL — i.e. production) used `IN NATURAL LANGUAGE MODE`, which **ORs** the words, while the LIKE fallback (TiDB — dev) ANDs them: `REDCLOTH nosuchwordxyz` returned the REDCLOTH row in production and nothing in dev, and the P1 contract test passed only because TiDB has no FULLTEXT index. Now every *indexable* word must match (one parameterised `MATCH` per word, ANDed), with words the engine cannot index **dropped rather than required** — measured on MySQL 8.4, `+the kente` and `+k kente` both return **0 rows**, so requiring them would have been a worse regression than the OR it replaced. | **P2** (a P1 control was green by accident) — **FIXED this pass** | `models/productModel.js`; `tests/productSearch.test.js` failed on MySQL before the fix, passes after. |
| N-17 | **Test fixtures relied on TiDB not enforcing foreign keys.** `reservation` and `stockRace` inserted products/orders whose parent user did not exist; MySQL raises the FK error, `INSERT IGNORE` converts it into **0 affected rows**, and it surfaces later as a confusing assertion (`created > 0`) rather than as the real cause. In `redteam-final` the vendor was picked with `SELECT … LIMIT 1` — an arbitrary row another suite may delete mid-test, making it a genuine cross-suite race. All three now create their own never-deleted fixtures. | **P3** (test infrastructure) — **FIXED this pass** | 3 suites failing on MySQL → 0; `redteam-final` 10/10 in three consecutive runs. |

---

## 6. Regression tests added

`backend/tests/redteam-final.test.js` — **10 tests**, 7 pure (run on CI with no
database) + 3 DB-gated:

1. `redactUrl` never throws on malformed percent-encoding (anonymous DoS)
2. `redactUrl` still strips sensitive values (fix did not disable redaction)
3. `redactUrl` strips password-reset tokens from the path (P1 token leak)
4. checkout charges the coupon **NET** total, not a stale pre-coupon cache (V-01)
5. escrow allocation covers the full line quantity (`qty:3 @ 100 → 300`)
6. vendor order-status response is projected for non-admin vendors
7. account limiters key on the target account, not on spoofable IP
8. concurrent escrow releases credit the wallet exactly once
9. V-09: Paystack reference validated as a path token before any outbound call
10. V-07: every refund entry point CAS-claims the marker before Paystack

**Mutation proof — every test fails when its fix is reverted:**

| Test | Mutation applied | Result |
|---|---|---|
| 1/2 | remove `try/catch` in `redactUrl` | `URIError` → fails |
| 3 | remove `SENSITIVE_PATH_SEGMENTS` | token survives → fails |
| 4 | `setCouponNetTotal(...)` → `void netTotal` | `not ok 4` |
| 5 | `it?.qty` only | `100 ≠ 300` → fails |
| 6 | raw order row instead of `projectVendorOrder` | buyer email leak → fails |
| 7 | drop `max: 5` (or re-key on IP) | 14×200 → fails |
| 8 | disable CAS **and** the DB `INSERT IGNORE` | `Duplicate entry … uq_wallet_credit_allocation` |
| 9 | delete the reference guard | `not ok 9` |
| 10 | `refundReference IS NULL` → no-op | `not ok 10` |

Test 8 specifically proves the two-layer defence: disabling only the
application CAS still passes because the DB unique key holds; disabling **both**
fails with the duplicate-key error.

Also repaired the test infrastructure itself: the file used to hang forever
after printing results (exit 124) because importing `rateLimitMiddleware`
*connects* the module-scope Redis client, and the failed DB probe left a
dangling pool. `after()` now closes both, and `REDIS_URL` is pinned empty for
this file so the limiter probe is deterministic.

`backend/tests/couponMaxUses.test.js` — **9 tests** for N-7/V-04, 8 DB-gated
functional scenarios + 1 source guard:

1. `maxUses=1`: first order discounted, second refused (cap holds across payment)
2. concurrency `N=10`, `maxUses=1` → **exactly 1** discounted order settles
3. concurrency `N=20`, `maxUses=5` → **exactly 5** discounted orders settle
4. retry idempotency: `consumeCouponForOrder` 3× adds exactly 1 use
5. all four settlement call sites (verify, webhook, admin mark-paid, reconcile)
   consume **one** slot between them
6. failed/cancelled payment releases the slot; the expiry sweeper releases it too
7. settled payment keeps its slot forever (replays, sweeper, direct release all refuse)
8. vendor A's coupon never discounts vendor B **and** never burns capacity on B
9. `couponUseState` stays out of `Order.update`'s whitelist, booking reserves
   atomically, and settlement uses `consumeForOrderOnce` (source-level, **no DB**,
   so CI without a database still enforces it)

**Mutation proof for V-04:**

| Mutation | Result |
|---|---|
| **A** — bypass `Coupon.reserveUse`'s atomic conditional UPDATE (book the slot regardless of the cap) | **8/9 fail**, e.g. test 2: `exactly 1 of 10 concurrent checkouts may win, got 10` |
| **B** — force `state = null` at settlement so the legacy bare `incrementUses` runs | tests 1, 4, 5, 7 fail (`2 !== 1`) |

Both mutations were reverted and `grep MUTATION` is clean.

`backend/tests/loginLockout.test.js` — **21 tests** for the whole P2 batch
(V-10 a/b/c, N-8, N-9): 14 source guards (no database needed, so CI's DB-less
job enforces them too), 3 unit tests of the cookie rule, and 4 behavioural tests
that drive the real model against a real database.

| # | Block | What it pins |
|---|---|---|
| 1–4 | V-10(a) static | window/threshold/duration are explicit bounded constants; the increment is **one conditional `IF()` carrying the decay clause**; the lock is a CAS on `failed_login_attempts >= ?`; counter + lock + window marker are cleared together on success |
| 5–7 | V-10(b) static | forgot-password answers only 200/400 with **exactly one 200** whose body is exactly `{ message: FORGOT_PASSWORD_REPLY }`, logs + drops the token on SMTP failure, has no 5xx path; `validateResetToken` replies **once** with one fixed literal (comments stripped first, so docs cannot hide a live field), no `valid:` flag, no 4xx; the shared reply is declared once and referenced once |
| 8–9 | V-10(c) static | `accountRegisterLimiter` = 5 / 15 min keyed on the **probed email**, no `skipSuccessfulRequests` (both the 400 and the 201 must cost the prober); the register route mounts it after the IP limiter |
| 10–15 | N-8 | `cookieSecure` forces Secure for `SameSite=None` *and* for production *and* otherwise follows the request scheme (3 env-mutating unit tests, restored in `finally`); ≥12 call sites derive from it and no file still hardcodes `secure: NODE_ENV === 'production'`; the session cookie uses the same rule with an `auto` fallback; the boot guard exists, exits with code 1, and runs before the app is wired up; `backend/.env` no longer ships the unsafe pair |
| 16–17 | N-9 | `TRUST_PROXY > 0` produces a warning naming X-Forwarded-For, the IP-keyed limits that inherit it, and escalating wording in production; the level is parsed explicitly and clamped 0..3 |
| 18–21 | V-10(a) DB | 10 failures inside one window lock the account and a locked account refuses even the correct password; a quiet period decays the counter to 1 without re-locking; **after the lock expires one attempt does not re-arm it and the correct password works again**; a successful login clears all three fields |

**Mutation proof for the P2 batch** (each run in a clean CI-style environment
against MySQL 8.4, then reverted):

| Mutation | Layer that must catch it | Result |
|---|---|---|
| **M1a** — delete the `OR last_failed_at < DATE_SUB(...)` decay clause | static **and** DB | **4 fail**: the window-clause guard + all three lockout DB tests |
| **M1b** — `INTERVAL ${LOGIN_FAILURE_WINDOW_MINUTES}` → `INTERVAL 999999` (the static guard still passes: the shape is intact, the behaviour is not) | DB only | **2 fail**: quiet-period decay, post-expiry re-lock — proves the DB tests catch what source-reading cannot |
| **M2** — reply becomes `user ? FORGOT_PASSWORD_REPLY : 'No account here.'` | static | **1 fail**: forgot-password body guard |
| *(all reverted)* | — | **21/21 pass** |

---

## 7. Tests executed

| Run | Command | Result |
|---|---|---|
| Full suite (sequential), **CI database** | `node --test --test-concurrency=1 "tests/**/*.test.js"` against MySQL 8.4 | **212/212 pass, 0 fail, 0 skipped, exit 0** |
| CI invocation, **CI database** | `npm test` (`--test-concurrency=4`) against MySQL 8.4 | **212/212 pass, 0 fail, 0 skipped, exit 0** |
| CI invocation, **dev database** | `npm test` against TiDB | **212/212 pass, 0 fail, 0 skipped, exit 0** |
| **CI job, end to end (N-11)** | `npm run db:setup && npm test` with no `.env`, CI-style env, MySQL 8.4 service | **`db:setup` exit 0** (schema + all 21 migrations) **then 212/212, exit 0** |
| CI invocation (no database) | `DB_HOST=127.0.0.1 DB_PORT=1 … node --test "tests/**/*.test.js"` | **148 tests: 94 pass, 54 skipped, 0 fail, exit 0** (was 127/77/50) |
| **New P2 suite, with DB (TiDB)** | `node --test tests/loginLockout.test.js` | **21/21 pass, exit 0** |
| **New P2 suite, with DB (MySQL 8.4)** | same, CI-style env | **21/21 pass, exit 0** |
| **New coupon suite, with DB** | `node --test tests/couponMaxUses.test.js` | **9/9 pass, exit 0** (≈113 s) |
| **New coupon suite, CI mode (no DB)** | `DB_HOST=127.0.0.1 DB_PORT=9 … node --test tests/couponMaxUses.test.js` | DB suite `SKIP`, source guard **1/1 pass, exit 0** |
| New red-team test file, with DB | `node --test tests/redteam-final.test.js` | **10/10 pass, exit 0** (3 consecutive runs on MySQL after the fixture fix) |
| New red-team test file, CI mode (no DB) | `DB_HOST=127.0.0.1 DB_PORT=1 … node --test tests/redteam-final.test.js` | **7 pass, 3 skipped, exit 0** (was exit 124) |
| Frontend unit tests | `npx vitest run` (`npm run test:frontend`) | **6 files, 44/44 pass** |
| Lint (CI gate) | `npm run lint` | **exit 0**, 0 errors / 13 warnings (was 24 errors) |
| Frontend typecheck (CI gate) | `npx tsc --noEmit -p tsconfig.json` | **exit 0** |
| Backend typecheck (CI gate) | `npm run typecheck --prefix backend` | **exit 0** (was exit 2; one regression caught and fixed while adding the portable column probe) |
| Secret scan, CI command | `gitleaks detect --source . --redact --exit-code 1` (v8.24.3) | **exit 0 — 124 commits, no leaks** |
| Secret scan, changed files | `gitleaks dir` per path (all 59 changed/untracked files) | **0 findings** (a multi-path `gitleaks dir` call silently scans the *whole* directory and picks up the gitignored `backend/.env`; CI does not use that form) |
| Audit gate (both workspaces) | `node .github/scripts/audit-gate.mjs <audit.json> <baseline.json>` | **exit 0** for frontend and backend |
| Dependency audit, runtime only | `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** (both workspaces) |
| Live: DoS re-verify | `GET /?%=1`, `?%ZZ=1`, `?%` | all `200`, process stays up |
| Live: token redaction | `GET /api/users/reset-password/<jwt>` | log shows `…/reset-password/[redacted]` |
| Live: XFF bypass | 12 rotating vs fixed source IPs | `RateLimit-Remaining` frozen at 598 vs decrementing 580→578 |
| Live: escrow qty probe | `seclab/probe-escrow-qty.mjs` | `underpaidBy: 0, exploitable: false` |
| Live: rate limiting | 14 attempts, rotating XFF, one account | before: unlimited; after: 5 allowed → `429`, unrelated account unaffected |
| Dependency audit | `npm audit` (both workspaces) | frontend 8 high / 2 moderate, backend 3 high — all dev-chain except frontend `axios` |

**Flakiness note.** The database used for this review is a shared TiDB and can
return `DB ping failed` / `ETIMEDOUT` under sustained load. One sequential run
(v7) failed exactly one test (`vendorIsolation` → *"single-vendor order flows
through pipeline step by step"*) with `DB ping failed` in the log; that file
passes **9/9 when run alone**, and the next full run was clean. The same
signature reappeared in the first TiDB run of the P2 batch
(`couponMaxUses` → *"settled payment keeps its slot"*, `DB ping failed`) — that
file is green in both 212/212 runs above. Any suspect result was re-run
per-file to separate infrastructure from regression.

Two later runs were poisoned by a **DNS outage** (`getaddrinfo EAI_AGAIN
gateway01…tidbcloud.com`, 21 connection errors in one `npm test`) and by the
fixtures that outage's failed cleanups left behind; both were discarded and
re-run from scratch.

**Engine difference that only the second database exposed.** TiDB's `users.email`
is `utf8mb4_bin` while MySQL 8.4's is `utf8mb4_0900_ai_ci`. The new lockout
fixture inserted a mixed-case address, so `findByEmail` (which lowercases its
lookup) found it on MySQL and *not* on TiDB — every behavioural test in that
suite failed there for a reason that had nothing to do with the lockout. The
fixture is lowercase now, and the suite passes **21/21 on both engines**. This is
the same class of bug as the search/FULLTEXT divergence in §5 (N-16): two
engines, one contract, and the CI job is what made the second engine a required
test target instead of an assumption.

Cross-suite isolation hardening was needed while adding the coupon suite: the
expiry sweeper query is global (`pending AND escrowStatus='none' AND stale`),
and a fresh order still carries `escrowStatus = 'none'`, so one suite's rows
were sweepable by *another* suite's sweeper. The new suite now parks every row
it creates (`escrowStatus='releasing'`), scopes its own sweep call
(`releaseExpiredReservations(0, { notesLike })` — an optional, default-off
parameter; production behaviour unchanged), and restores state in a `finally`.
That removed the last `rb01` *"sweeper should not release already cancelled
order"* flake.

Fixture pollution in `refundReconcile.test.js` (orphaned `PARTIAL-` rows) was
root-caused and cleaned; that suite is green in all runs above.

---

## 8. Remaining issues by severity

### P0 — immediate financial/security blocker
**None open.** The two P0s found in this pass (escrow `qty`, `redactUrl` crash)
and V-01 are fixed, mutation-proven and covered by tests.

### P1 — public production blocker
**None open.** N-7 / V-04 (coupon cap enforced only on the counter, not on
the money) was the last P1: it is now fixed with atomic reservation at booking
time, mutation-proven and pinned by `couponMaxUses.test.js` (see §4 and §6).
The previously-reported P1s (rate-limit bypass, reset-token log leak, vendor
PII/sibling-line leak) were already closed earlier in this pass.

### P2 — pilot hardening
**All six closed this pass.** What each one was, and what now pins it:

* **V-10 — lockout maintenance DoS.** 10 wrong passwords over ~30 min locked a
  victim for 1 h and the DB counter never decayed, so **one request per hour**
  re-locked them indefinitely. Now the increment is a single conditional
  `UPDATE` that resets the counter to 1 when `last_failed_at` is older than
  `LOGIN_FAILURE_WINDOW_MINUTES` (15 min, matching the 5/15-min account
  limiter), so re-reaching the threshold needs 10 *fresh* failures inside one
  window. Cleared on successful login, on `resetPassword` and on OAuth
  adoption. The forgot-password 5xx-on-SMTP-failure oracle and the
  `valid: true|false` reset-token oracle are gone: both endpoints answer one
  byte-identical 200 (SMTP failure is logged, the unusable token is dropped,
  nothing is surfaced). Pinned by `loginLockout.test.js` (21 tests, 3
  mutations, §6).
  *Residual, reclassified to P3:* **registration still answers 400 ("address
  taken") vs 201**, because closing it needs OTP verification redesigned (the
  token is issued inside that same request). It is now **bounded**: a new
  `accountRegisterLimiter` (5 per 15 min, keyed on the probed email, counting
  *both* answers) is mounted next to the existing IP limiter, so a prober pays
  per address and rotating `X-Forwarded-For` buys nothing.
* **N-8 — cookies without `Secure`.** `cookieSecure(req)` now derives the flag
  per request: `SameSite=None` → always `Secure`; production → always
  `Secure`; otherwise the actual request scheme. All 12 call sites use it, the
  session cookie uses the same rule with an `auto` fallback, and the server
  **refuses to boot** `COOKIE_SAME_SITE=none` outside production (next to the
  existing CSRF guard). The shipped `backend/.env` now reads `lax`.
* **N-9 — XFF spoofing of IP-keyed limiters.** Boot now prints a warning
  whenever `TRUST_PROXY > 0`, naming X-Forwarded-For, the IP-keyed limits that
  inherit it, and escalating its wording in production; the value is parsed
  explicitly and clamped to 0..3 (still 0 when unset).
* **N-11 — CI did not exercise the security surface.** `.github/workflows/ci.yml`
  gained four things: a **secret scan** (pinned gitleaks 8.24.3 over the full
  history + working tree, exactly as validated locally), a **frontend test
  step** (`npm run test:frontend`), an **audit ratchet** (§ below), and a
  **database job** with a disposable `mysql:8.4` service that runs
  `db:setup` (schema + all 21 migrations) and then the full suite. The 54
  skipped tests (12 wholly-skipped suites plus the 3 DB-gated tests in the
  red-team file) now run on every merge.
* **N-12 — gates red.** Lint (was 24 errors) and both typechecks (backend was
  exit 2) are fixed and green; the workflow keeps them as separate steps so a
  regression shows up by name.
* **N-13 — frontend `axios@1.19.0`.** Bumped to `^1.20.0` (installed 1.20.0)
  plus a non-breaking `npm audit fix` (source-map-js → 1.2.2).

**On the audit gate (why it is a ratchet, not `npm audit --audit-level=high`).**
A raw gate cannot pass here: `braces` — reached from `tailwindcss` 3.x in the
frontend and from `nodemon` in the backend — is advisory-affected in *every*
published version, and npm's only offered fix is `npm audit fix --force`, i.e.
the breaking tailwindcss v4 migration (tracked as a post-launch item). A gate
that is red on day one gets ignored and then deleted. So `.github/scripts/audit-gate.mjs`
compares `npm audit --json` against `.github/audit-baseline.{frontend,backend}.json`
and fails only on a **new** high/critical advisory, on an accepted one **getting
worse** (baseline "high" must not silently accept "critical"), or on an audit
that **did not run** — while printing a notice when a baseline entry disappears
(fixing something must not turn the build red). Runtime dependencies stay
clean: `npm audit --omit=dev` exits 0 in both workspaces. Two criticals that
appeared mid-pass were fixed rather than baselined: `shell-quote` (command
injection in `quote()`) via an `overrides` entry to `^1.12.0`, and `axios`
above; `concurrently` has no fixed release (its advisory range is `>=9.2.3`,
including 10.x) and is dev-only, so it is accepted **with its reason recorded**
in the frontend baseline — that is what the baseline is for.

### P3 — post-launch
`X4a` unauthenticated `/metrics`; `N-6` suspended vendors stay in public
listings/trending (purchase is blocked, display is not); `C5` pending vendor
applicants get `role='vendor'` and pass the owner branch of `vendorOrStaff`;
`A8` any vendor staff can edit the storefront profile/read reviews (self-scoped
only); `I3` negative absolute stock accepted, **no `CHECK` constraint anywhere**;
`M-1` OTP attempts reset on every resend; `M-6` raw name interpolation in
`emailService.js` (the order-mail twin is escaped and tested); `M-7`/`M-8` no
product price schema, only 2 `validate()` mounts across 31+ mutating routes;
`C2` admin coupon has no ≤100% cap and the PUT path writes an unclamped total
(possible negative `totalAmount`, integrity only); **the registration 400-vs-201
existence oracle (V-10 residual)** — closed as far as rate limiting can close it
(`accountRegisterLimiter`, 5/15 min keyed on the probed email, both outcomes
counted) but the answer itself still differs, because fixing that means
redesigning when the OTP token is issued; `X1` coupon-existence oracle
behind an IP-keyed limiter; `A5` login timing oracle (no dummy bcrypt on the
user-not-found branch); `N-5` `db:migrate` has no transaction/per-row
try/catch; `F2` unanchored extension regex (magic-byte check is the real
authority); `F4a` try-on URL validation is syntactic only; `N-10` limiter reset
on Redis recovery; `R2` `refundedAmount` check-then-act (unreachable — the
V-07 claim allows one claim per order); V-07/V-09/V-05 have no *functional*
(negative) tests, only source assertions.

---

## 9. Remediation order

1. **N-7 / V-04 (P1)** — ~~reserve a coupon slot atomically when the coupon is
   booked, or refuse to settle a discounted order when `consumed === false`
   (charge full / hold for admin). Add a test that N orders against a
   `maxUses=1` coupon settle at most once. Do not simply move consumption
   earlier without a release path, or abandoned carts will burn redemptions.~~
   **Done (this pass).** Chose the reserve-at-booking option: an atomic
   conditional `UPDATE` on `coupons.usesUsed` inside a transaction, tied to the
   order via a new `orders.couponUseState` marker (0 none / 1 reserved /
   2 settled), released on cancel/expiry/failure and made permanent on
   settlement — so the cap is decided *before* Paystack ever charges a
   discounted amount, and abandoned carts do not burn redemptions. 9 tests,
   2 mutations, both reverted.
2. **V-10 (P2)** — ~~decay `failed_login_attempts` (windowed counter instead of
   an all-time one), and make register / forgot-password / reset-token responses
   byte-identical regardless of whether the account exists.~~
   **Done (this pass).** The increment is now one conditional `UPDATE`
   (`IF(last_failed_at stale → 1, else +1)`) followed by a threshold-guarded
   lock, cleared on success / `resetPassword` / OAuth adoption; a new nullable
   `users.last_failed_at` column is added by `migrateLoginWindow.js`. Both
   forgot-password and reset-token validation answer a single byte-identical
   200 (SMTP failure and unknown/expired tokens included). Registration's
   400-vs-201 cannot be closed without redesigning OTP verification, so it is
   bounded by `accountRegisterLimiter` (5/15 min keyed on the probed email,
   both outcomes counted) and tracked as P3. 21 tests, 3 mutations, §6.
3. **N-8 + N-9 (P2)** — ~~refuse to boot when `COOKIE_SAME_SITE=none` and
   `NODE_ENV !== 'production'`; warn when `TRUST_PROXY > 0` without a documented
   proxy; prefer deriving `secure` from the request scheme for auth cookies.~~
   **Done (this pass)** — `cookieSecure(req)` at all 12 call sites, the boot
   guard sits with the existing CSRF guard and exits 1, the TRUST_PROXY warning
   escalates in production, and `backend/.env` now ships `lax`.
4. **N-11 (P2)** — ~~add a CI job with a disposable database so the 54 skipped
   tests (12 wholly-skipped suites + the red-team file's DB-gated tests)
   actually run, add a secret scan, add
   `npm audit --audit-level=high` as a gate, and run `npm run test:frontend`.~~
   **Done (this pass).** The audit gate is an explicit ratchet rather than a
   bare `--audit-level=high`, for the reason set out in §8: `braces` has no
   fixable version and a permanently-red gate is not a gate. Secret scan,
   frontend tests and the `mysql:8.4` DB job are in `.github/workflows/ci.yml`
   and were validated locally first (same gitleaks version and flags; the
   same `db:setup && npm test` sequence against a clean MySQL 8.4).
   *Note:* getting that job green required fixing four pre-existing
   portability/fixture bugs the DB-less CI could never see (§5): a stale
   `branding_house.sql`, TiDB-only SQL in `migrateAdvanceRatio.js` and in the
   two `LIMIT ? OFFSET ?` backfill migrations, and `INSERT IGNORE`-masked FK
   violations in three test fixtures.
5. **N-13 (P2)** — ~~`npm audit fix` (frontend `axios` → `1.20.0`).~~
   **Done (this pass)** — `axios@^1.20.0`, `source-map-js` 1.2.2, and
   `shell-quote` pinned to `^1.12.0` through `overrides` (a critical that
   appeared mid-pass and was fixed rather than accepted).
6. **Rotate the leaked Paystack test key (hygiene, do it anyway).** This pass's
   secret scan found a real-looking `sk_test_…` key committed in
   `backend/.env.example`; the file is fixed and its fingerprint is in
   `.gitleaksignore` (so the scanner cannot be poisoned into ignoring *other*
   findings), but the key itself is still valid until Paystack revokes it.
   Revoke it, then confirm `gitleaks detect --source .` stays at 0 findings.
7. **P3 batch** — `/metrics` auth, `CHECK` constraints for stock, vendor-status
   predicate on public product queries (`productModel.js:187-189` is bypassed
   because every public controller passes `approvalStatus='approved'`),
   escaping in `emailService.js`, price schema, negative functional tests for
   V-05/V-07/V-09.

---

## 10. False positives and disproven claims

| Claim | Verdict |
|---|---|
| "RB-06 / OAuth state not addressed" (`REMEDIATION_REPORT.md`) | **False** — signed, single-use, cookie-bound state is fully implemented and verified. |
| "`refundReconcile.test.js` failure is pre-existing and unrelated" | **False** — cross-suite fixture pollution from orphaned `PARTIAL-` rows. |
| "R3 — refund stock restore is broken" | **False positive** — skip-conflicts + marker clear are correct; covered by `refundRestore.test.js`. |
| "X2 — Redis rate limiting fails open" | **False positive** — the degraded path counts in per-instance memory; the old `'0'` fail-open is gone and documented. |
| "X3 — try-on without a limit" | **False positive** — daily limit enforced. |
| "V-09 still open" (older draft) | **Closed** — but it had no test until this pass. |
| Escrow still under-allocating multi-unit lines | **Disproven** — live probe returns `underpaidBy: 0`. |

---

## 11. Verified security strengths

* **Two-layer money invariants.** `releaseAllocation` uses a conditional
  `held → available` update *and* a DB unique key
  (`uq_wallet_credit_allocation`); only disabling both reproduces the duplicate
  credit. Same pattern for refunds (`uq_orders_refundReference`), payment
  idempotency and stock markers.
* **Server-authoritative pricing.** Totals are recomputed from stored items and
  a server-validated coupon; Paystack verification demands an exact kobo match
  on both verify and webhook paths — which is exactly why V-01 mattered.
* **Upload handling is solid.** Magic-byte validation, strict filename grammar
  (`\d+-(product|reference)-…`), SVG rejected, path traversal rejected before
  ownership checks.
* **No hardcoded secrets**, `.env` untracked, production boot refuses to start
  without `SESSION_SECRET`, `JWT_SECRET`, `FRONTEND_URL` and
  `PAYSTACK_SECRET_KEY`.
* **CSRF coupling is asserted in code**: `COOKIE_SAME_SITE=none` without
  `csrfProtection` mounted exits at boot.
* **Escrow lifecycle is genuinely defensive**: per-allocation reason states,
  allocation-scoped clawback keys, TOCTOU re-checks on retry, idempotent
  duplicate-webhook handling.
* **Coupon cap is enforced on money, not on counters.** The slot is taken by an
  atomic conditional `UPDATE` (never check-then-set), recorded per order in a
  column clients cannot write, released only by the single process that wins the
  `state 1 → 0` CAS, and made permanent by the `state 1 → 2` transition at
  settlement — so cancel + sweeper + reconciliation can never release twice, and
  no replay can consume twice. Settlement idempotency and permanent consumption
  are asserted across all four call sites (verify, webhook, admin mark-paid,
  reconcile).
* **The lockout is now a property of the database, not of the process.** The
  counter increments through one conditional statement (`IF(last_failed_at
  stale → 1, else +1)`) followed by a threshold-guarded lock — no in-memory
  mutex, no check-then-act, nothing an attacker can race by sending concurrent
  requests — and it is released by the same clock that bounds the limiter window.
  Locked accounts are indistinguishable from bad passwords (no 423 oracle), and
  forgot-password/reset validation answer with one byte-identical 200 whether
  the account exists, the token is dead or SMTP is down.
* **CI now fails on the things this review kept having to check by hand.** Every
  merge runs a secret scan over the full history, the lint/typecheck/test/build
  gates, a dependency-advisory ratchet that cannot silently accept a *worse*
  advisory, and — for the first time — the whole backend suite against a real
  disposable MySQL, so the 54 tests (and 15 suites) that were decorative in
  CI-less runs are now required evidence. The same code passes on both engines
  (TiDB in dev, MySQL 8.4 in CI), which is what exposed the schema drift, the
  non-portable migrations and the search divergence recorded in §5.

---

## 12. Final assessment

**Not production ready yet — but it is close, and the money paths are now the
strongest part of the system.**

The two P0s found in this pass (multi-unit escrow under-allocation, and an
anonymous process-killing DoS) plus the V-01 charge/book divergence were real,
reproducible and would have cost money on day one. All three are fixed,
mutation-proven and pinned by tests that fail against the reverted code.

Ten of the twelve prior-round findings I re-derived independently — V-02, V-03,
V-05, V-06, V-07, V-08, V-09, V-11, N-2, N-4 — hold up under adversarial
re-reading, which is better than the earlier reports claimed for themselves.
Two of the round-2 findings do not: **V-01 was still exploitable** (the "fix"
added comments but kept a raw `axios.put`, so the charge used the stale
pre-coupon total — closed in this pass), and **V-04 remained open** — the coupon
cap was enforced on the counter rather than on the money. **V-04 is now closed
too**: the slot is reserved atomically at booking (before Paystack ever charges
a discounted amount), tied to the order, released on cancel/expiry/failure and
made permanent on settlement; 9 tests and 2 reverted mutations prove it.
**V-10 is closed too**: the counter decays inside a 15-minute window, so one
request per hour can no longer hold a victim's account locked — 21 tests (4 of
them behavioural against a real database) and 3 reverted mutations prove it,
including the exact mutation that made the lock permanent.

**No P0 and no P1 remains open, and no P2 remains open either.** What is left
before a pilot is operational rather than adversarial: watch the first runs of
the new CI database job (a green gate on day one is evidence, not a habit),
rotate the legacy Paystack test key that this pass found pasted into an old
version of `backend/.env.example` (the fingerprint is in `.gitleaksignore`, so
the scanner will not flag it again, but the key itself should still be revoked),
and take the `tailwindcss` 3.x → 4 migration out of the frontend baseline.
Before general launch: the P3 batch — metrics auth, stock `CHECK` constraints,
vendor-status predicate on public queries, and the enumeration oracles that are
bounded but not closed (registration 400-vs-201, coupon and username oracles) —
plus the operational items in §9.

Confidence statement: every "fixed" verdict above is backed either by a test
that was shown to fail when the fix is reverted, or by a live measurement
recorded in §7. No finding is marked closed on the strength of a comment, a
commit message or a previous report.
