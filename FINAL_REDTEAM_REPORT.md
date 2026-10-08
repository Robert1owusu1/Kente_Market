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
5. **Never certify a guard by reading it.** The final batch added this rule after
   V-07 came back certified — source assertions had counted
   `refundReference IS NULL` and `affectedRows === 0` in the file while the
   guard compared `undefined === 0` and never fired. Every fix since is pinned
   by a test that drives the real router over a socket or the real model against
   a real database, and by a mutation run recorded with its denominator: a
   suite reporting `# pass 0` counts as **invalid**, not as a kill.

Where a prior report and the code disagreed, the code won (see §5) — including
when the prior report was this one (§10).

---

## 2. Threat actors and coverage

| Actor | Capabilities modelled | Findings raised against it |
|---|---|---|
| Anonymous | unlimited requests, rotating `X-Forwarded-For`, malformed URLs/paths, no session | `redactUrl` DoS (P0, fixed), rate-limit bypass (P1, fixed), lockout maintenance (P2, fixed), enumeration oracles (P3: registration 400-vs-201 bounded by a per-email limiter; coupon-existence oracle closed by X1; the "username oracle" could not be reproduced — see §10), unauthenticated `/metrics` (P3 → fixed, `metricsTokenGuard`) |
| Customer | owns orders/coupons, can replay and race their own checkout, can hit APIs directly | escrow under-allocation on multi-unit lines (P0, fixed), V-01 gross/net charge divergence (fixed this pass), V-04 coupon cap bypass (fixed this pass), refund double-spend (V-07), **refund double-spend actually reachable because the V-07 guard was dead code (V-07b, P0, fixed)** |
| Malicious vendor / compromised vendor staff | vendor JWT, vendor-scoped routes, own products/orders | vendor order-status PII + sibling line leak (P1, fixed), fulfilment forward-jump (V-11, fixed), suspended-vendor products still listed (N-6, fixed), pending applicant holding every vendor capability (C5, fixed), staff editing the storefront with an empty permission object (A8, fixed) |
| Malicious admin / staff | privileged routes, mark-paid, cancel, coupon issuance | refund CAS on admin cancel (V-07 — **whose guard turned out to be dead code: V-07b, P0, fixed this pass**), uncapped % coupon → negative `totalAmount` (C2, fixed), partial-refund balance pre-check blind to prior refunds (N-23, fixed) |
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
| A-8 | **N-18:** 20 `POST /api/orders` landing in the same millisecond (an ordinary burst — no tricks) | customer / burst traffic | the `orders.orderNumber` (UNIQUE) race lost one INSERT → `ER_DUP_ENTRY` → **500 and the basket lost** (coupon slot and stock were rolled back correctly) | **P2** | **found and fixed this pass** + tested |
| A-9 | **N-19:** ordinary Google login from `kente-market.vercel.app` in a browser that already holds a `csrf_token` cookie (any visitor whose session JWT expired while the 30-day CSRF cookie lived on) | customer (returning visitor — no tricks) | `POST /api/auth/oauth/exchange` answered **403 `CSRF token missing`** → no session cookie minted → the follow-up `GET /api/users/profile` answered 401 → **Google login dead**, console shows `OAuth profile fetch error: Not authenticated` | **P1** | **found and fixed this pass** + tested |
| A-10 | **N-20:** a vendor clicks a fulfilment pipeline button (`processing → packaging → shipped → arrived → delivered`) — an ordinary action, no tricks | vendor staff (logged in, authorized) | the handler **wrote the status change and then never answered**: it awaited a customer-notification insert and an SMTP send *before* `res.json`, the SPA aborted at 15 s (`fetchBaseQuery` `timeout: 15000`), and the UI reported **"Failed to update order status"** for an update that had already been saved. Firefox HAR for the failing POST: `status: 0` (no response ever reached the browser), toast at ~15 s, order row already `shipped`/`arrived` on reload | **P2** (the write always landed — no money, no authorization and no data impact, and the UI reconciles on refresh; the defect is a false failure report plus a stale view) | **found and fixed this pass** + tested |
| A-11 | **V-07b — the refund CAS guard was dead code.** Ask for a refund (partial or full) or cancel an order that already carries a refund marker, or issue two refund requests concurrently | malicious vendor staff / compromised customer / admin | the guard read `.affectedRows` **off the array** `pool.execute` returns (`[rows, fields]`), so the comparison evaluated `undefined === 0` → **always false** → the `refundReference IS NULL` claim never refused anything and every entry point proceeded to move money again. The V-07 report, the source assertions (`migrationSafety.test.js:214`, `redteam-final.test.js:591`) and a UNIQUE index that exists but does not block (the three paths write different marker strings) all certified this as fixed | **P0** | **found and fixed this pass** + tested |
| A-12 | **V-09b — `reference: ".."` in `POST /api/payments/verify-paystack`** (and the same residue in the unattended recovery job) | authenticated customer | the character class `[A-Za-z0-9._-]` forbids `/` but permits `.`, so `..` passed the guard and WHATWG normalization rewrote `https://api.paystack.co/transaction/verify/..` to `https://api.paystack.co/transaction/` — the request left the verify prefix. Same host, no query string reachable (`?` is refused too), so nothing could be read elsewhere and the key never left Paystack: it defeated the **claim** that path injection was prevented rather than enabling a practical attack | **P3** | **found and fixed this pass** + tested |

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
| **V-05** OAuth state | ~~source reading only~~ → **functional**. `tests/oauthStateGate.test.js` drives the real router over a socket: signed `oauth_state` (HMAC, nonce, 10 min), httpOnly cookie, compared + signature-checked + purpose-checked + cleared on callback; Passport's own store disabled (`state: false`); **no Facebook route exists**. 10 cases, 8 mutations (6 detected, 2 equivalent) |
| **V-06** staff logout principal | branches on `decoded.role === 'vendor_staff'` → bumps `vendor_staff.tokenVersion`, enforced at `authMiddleware.js:219-225` |
| **V-07 / V-07b** refund double-spend | **the original verification of this row was wrong, and is retracted.** The three entry points *did* carry `refundReference IS NULL` and gate on `affectedRows === 0` — but `.affectedRows` was read off the **array** `pool.execute` returns (`[rows, fields]`), so the gate compared `undefined === 0`, which is false, and **never refused**. The source assertions that counted both strings (`migrationSafety.test.js:214`, `redteam-final.test.js:591`) passed anyway, and the UNIQUE index does not block because the three paths write different marker strings (`:cancel:` / `:partial:` / `:return:`). Fixed by destructuring at all three sites: `orderController.js` cancel, `returnController.js` partial and full. Now `tests/refundDoubleSpend.test.js` — 5 cases, one order each: 3 refusals assert **409 and a Paystack spy at zero calls**, 2 controls assert exactly one call against the order's own reference (a control is what keeps an unwired path from reading as a correct refusal); **9 mutations, 9 detected** |
| **V-08** double stock restore | markers zeroed + `orderStatus='cancelled'` **before** the restore; sweeper only claims `pending` rows (CAS) — `rb01` tests 2 & 5, `rb04` |
| **V-09 / V-09b** Paystack path injection | the character class + `encodeURIComponent` were **not sufficient**: the class forbids `/` but permits `.`, so a reference of `..` passed it and WHATWG normalization moved the URL off the verify prefix (A-12). Both wide-class sites now validate **the URL they build** — construct it, assert `origin` and that `pathname` is byte-for-byte the intended path, then send `verifyUrl.href`, so what was validated is what goes on the wire. `tests/paystackReferenceGuard.test.js`: 17 cases over a real socket, driving both the route and the unattended `recoverStuckPendingOrders`, discriminating on **whether axios was called at all** — because every rejection and several ordinary outcomes all answer 400; **8 mutations (5 detected, 3 equivalent)** |
| **V-11** fulfilment forward jump | `nextIdx > ownIdx + 1 → 400`, covered by `vendorIsolation.test.js` |
| **V-04 / N-7** coupon cap on the money | atomic `UPDATE coupons SET usesUsed = usesUsed + 1 WHERE id = ? AND usesUsed < maxUses` claimed together with `orders.couponUseState 0→2` in one transaction; release on cancel/expiry/failure (`state 1→0`, conditional decrement); `couponMaxUses.test.js` 9 tests + **2 mutations (8/9 and 4/9 failed)** — see §6 |
| **N-2** `tv:0` tokens rejected | `authRoutes.js:243` now checks `undefined`/`null` explicitly |
| **N-4** shared `productionNote` clobber | vendor patch contains only `orderStatus`/`deliveredAt` |
| **N-19** raw-`fetch` state-changing calls echo the CSRF token | live probe matrix against `kente-api.onrender.com` (cookie × header × origin) that isolated the failing layer; the fix itself is pinned by `src/utils/__tests__/csrf.test.ts` source guard over the whole SPA (3 mutations), `backend/tests/csrfToken.test.js` (11 tests, 1 mutation) and `src/store.csrfReset.test.ts` (5 tests, 1 mutation) |
| **N-20** no request is ever held open by outbound mail | behavioural proof: a local black-hole SMTP endpoint (TCP handshake, no greeting) makes `sendEmailSafely` return in **5.0 s** instead of nodemailer's stock **30 s**, and the transporter's three stage caps are asserted to sit inside the SPA's 15 s budget; plus a source guard that the vendor status handler **responds before** it notifies, with self-tests proving the matcher rejects both wrong orderings (4 mutations — 3 backend, 1 frontend — §6) |

**Refuted claims from earlier reports**

* *"RB-06 / V-05 OAuth state not addressed"* — **false**, it is properly
  closed (evidence above). The residual it named — no functional test — is
  now closed too by `oauthStateGate.test.js`; what remains is only that
  single-use is enforced client-side (§8 P3, item 5).
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
| N-11 | **CI does not exercise most of the security surface.** No database job (in CI's DB-less mode **50 of 127 tests skipped and 15 blocks skipped entirely** — measured at the time of the finding; with this pass's new suites it is 54 of 165), no secret scan, no `npm audit` gate, and the frontend suite (`npm run test:frontend`, 44 tests at the time of the finding, 54 now) is never invoked. | **P2 — FIXED this pass** | `.github/workflows/ci.yml` |
| N-12 | **Both CI gates were red before this pass.** `npm run lint` failed with **24 errors** (unused vars in `rb01/rb02/rb04`) and `npm run typecheck --prefix backend` exited **2** (3 implicit-`any` params in `orderController.js`) — added by the earlier rounds. Fixed here; both now exit 0. | **P2 — FIXED** (trust in CI) | reproduced before/after |
| N-13 | **Frontend dependency advisory:** `axios@1.19.0` is the last vulnerable release of the 1.0.0–1.19.0 range (prototype-pollution gadgets, header injection, ReDoS, redirect-SSRF). It is a runtime dependency (`^1.11.0`); the backend already runs `1.20.0`. Frontend audit: 8 high, 2 moderate (only `axios` is runtime; the rest are `tailwindcss`/`typescript-eslint` build chain). Backend: 3 high, all in the dev-only `nodemon → chokidar → braces` chain (runtime deps audit clean). **FIXED this pass:** `axios` → `^1.20.0`, `source-map-js` → 1.2.2, and two criticals that surfaced mid-pass fixed rather than accepted (`shell-quote` → `^1.12.0` via `overrides`; `concurrently` has no fixed release and is accepted with a reason in the baseline). The remaining 5 highs were the `tailwindcss` 3.x chain — cleared by the v4 migration in this revision, so `audit-baseline.frontend.json` is now an empty `accepted` (see the audit-ratchet note in §8). | **P2 — FIXED this pass** | `npm audit`, `package-lock.json:2506` |
| N-14 | **The canonical schema is stale: a database built from the repo cannot run the app.** `branding_house.sql` lacked `users.legal_consent_at` (written by `usersModel.create` and `config/passPort.js` on every signup) and the `sessions` table (`express-mysql-session`). A fresh install failed registration with `ER_BAD_FIELD_ERROR`, and **5 test suites failed the same way** — only databases created while the dump still matched the code happened to work. Invisible to CI only because CI never built a database. | **P2** (new installs, CI) — **FIXED this pass** | column diff dump-vs-live on clean MySQL 8.4 → 4 missing columns; `Unknown column 'legal_consent_at' in 'field list'`. Now the dump is synced and `migrateSchemaSync.js` (existence-checked, idempotent) covers existing databases. |
| N-15 | **`db:migrate` does not run on the database CI (and a new deploy) actually uses.** `migrateAdvanceRatio.js` used `ADD COLUMN IF NOT EXISTS` — TiDB/MariaDB syntax that **MySQL 8 rejects** — and `migrateOrderItems` / `migrateVendorOrderItems` passed `LIMIT ? OFFSET ?` to `connection.execute`, which mysql2 answers with `Incorrect arguments to LIMIT`. On stock MySQL the chain aborted at script #18, leaving half a schema. The local TiDB hid both because TiDB accepts them. | **P2** (new installs) — **FIXED this pass** | `npm run db:setup` on MySQL 8.4: exit 1 → exit 0 across all 22 steps (schema + migrations). |
| N-16 | **Product search meant two different things on the two engines.** The FULLTEXT path (MySQL — i.e. production) used `IN NATURAL LANGUAGE MODE`, which **ORs** the words, while the LIKE fallback (TiDB — dev) ANDs them: `REDCLOTH nosuchwordxyz` returned the REDCLOTH row in production and nothing in dev, and the P1 contract test passed only because TiDB has no FULLTEXT index. Now every *indexable* word must match (one parameterised `MATCH` per word, ANDed), with words the engine cannot index **dropped rather than required** — measured on MySQL 8.4, `+the kente` and `+k kente` both return **0 rows**, so requiring them would have been a worse regression than the OR it replaced. | **P2** (a P1 control was green by accident) — **FIXED this pass** | `models/productModel.js`; `tests/productSearch.test.js` failed on MySQL before the fix, passes after. |
| N-17 | **Test fixtures relied on TiDB not enforcing foreign keys.** `reservation` and `stockRace` inserted products/orders whose parent user did not exist; MySQL raises the FK error, `INSERT IGNORE` converts it into **0 affected rows**, and it surfaces later as a confusing assertion (`created > 0`) rather than as the real cause. In `redteam-final` the vendor was picked with `SELECT … LIMIT 1` — an arbitrary row another suite may delete mid-test, making it a genuine cross-suite race. All three now create their own never-deleted fixtures. | **P3** (test infrastructure) — **FIXED this pass** | 3 suites failing on MySQL → 0; `redteam-final` 10/10 in three consecutive runs. |
| N-18 | **Two orders created in the same millisecond collide on the UNIQUE `orderNumber`, and checkout answers 500.** Both checkout paths minted the key from the wall clock — `"ORD-" + Date.now()` and `` `CUS-${Date.now()}` `` — against `orders.orderNumber VARCHAR(100) UNIQUE NOT NULL`, so any two orders inserted in the same millisecond ask for the *same* value. The loser throws `ER_DUP_ENTRY`; the catch block releases the coupon slot and restores stock (the N-7 economic invariant held throughout — no money moved, no slot leaked), but the customer still gets `500 Internal server error` and loses the basket. Reproduced **2/8 local runs** and in **CI runs 45 and 46** — on byte-identical code that *passed* the runs on either side (44 and 47), which is precisely why it presented as infrastructure flakiness and survived to this pass. Same class, fixed alongside: the regular checkout's SELECT-then-INSERT on `paymentReference` also answered 500 when the UNIQUE key won the race (the custom-request path already answered 400); both now answer 400 with the pre-check's wording. | **P2** (checkout availability under concurrency — no authorization or money impact, but P1-shaped during a burst) — **FIXED this pass** | `controllers/orderController.js`, `controllers/customRequestController.js`; failing log `Duplicate entry 'ORD-1791330964942' for key 'orders.orderNumber'`; now `utils/orderNumber.js` (`PREFIX-<epoch-ms>-<8 hex>`) + `tests/orderNumber.test.js` (6 tests, 2 mutations). |
| N-19 | **Google login was dead in production: every raw `fetch` in the SPA bypassed the CSRF interceptor.** `main.tsx:28` attaches `X-CSRF-Token` through an **axios** request interceptor; the OAuth exchange (`OAuthCallback.tsx:87`) is a *raw* `fetch` carrying only `Content-Type`. `csrfProtection` layer 2 (`csrfMiddleware.js:117`) rejects any state-changing request that carries the `csrf_token` cookie without the matching header — and that cookie is set on every session issue and lives **30 days**, while the session JWT expires sooner, so "expired session + live CSRF cookie" is the ordinary state of a returning visitor. Live probe matrix against production (`POST /api/auth/oauth/exchange`, `kente-api.onrender.com`): allowed Origin with no cookie → **401** (CSRF passed, route reached); allowed Origin + cookie + no header → **403 `CSRF token missing`** ← the browser's case; cookie + wrong header → 403 `CSRF token mismatch`; foreign Origin → 403 `Cross-site request rejected`; Origin with a trailing slash → 403. Layer 1 was healthy and layer 2 was the killer. The 401 on `/api/users/profile` in the incident report is purely downstream: no session cookie was ever minted. Same class, found in the same sweep: `useLegalConsent.ts:45` (POST `/api/auth/consent` — the Google-**signup** consent) had the identical shape and would 403 the same users, while forgot-password and reset-password escaped only because they *omit* `credentials`, so the cookie never travels. The second half: `getOrIssueCsrfToken` (`csrfMiddleware.js:73`) echoed **any** existing cookie without re-checking its HMAC, so after a `JWT_SECRET` rotation every state-changing request from every returning visitor would 403 for the rest of the cookie's 30-day life, with no recovery short of clearing cookies by hand. And the third: session issuance rotates the cookie while the SPA's cache reset was keyed on the *signed-in boolean*, so a re-sign-in that never flips it (persisted `userInfo`, expired JWT) kept the pre-rotation token — the same 403 one step later, now on every state-changing request. | **P1** (Google login — and Google signup consent — dead in production for exactly the visitors who already had an account) — **FIXED this pass** | `src/main.tsx:28`, `src/Pages/Auth/OAuthCallback.tsx:87`, `src/hooks/useLegalConsent.ts:45`, `src/Pages/Auth/ForgotPassword.tsx:82`, `src/Pages/Auth/ResetPassword.tsx:151`; `backend/middleware/csrfMiddleware.js:73,117`; probe matrix above; now `csrfJsonHeaders()` + `tests/csrfToken.test.js` (11 tests) and `src/utils/__tests__/csrf.test.ts` (10 tests) + `src/store.csrfReset.test.ts` (5 tests) |
| N-20 | **A write that committed was reported to the user as a failure, because the HTTP response waited on outbound mail.** `updateVendorOrderStatus` wrote the status change, then awaited `Notification.create` **and** `sendOrderStatusEmail` *before* `res.json` (`vendorOrderController.js:487-516` before the fix). nodemailer's stock budgets are **2 minutes to establish the connection, 30 s for the SMTP greeting and 10 minutes of socket idle**, while the SPA aborts every RTK call at **15 s** (`fetchBaseQuery({ timeout: 15000 })`). So in production the request simply never came back: RTK answered `{ status: 'TIMEOUT_ERROR', data: undefined }` — **no body at all** — the universal `err?.data?.message \|\| 'Failed …'` pattern had nothing to quote, and the vendor was told *"Failed to update order status"* for a save that had already landed. Evidence: Firefox HAR of the failing request (POST `status: 0`, zero response headers, while the `OPTIONS` preflight answered **204** — so CORS and the token layer were healthy); the toast arriving at **~15 s**, i.e. exactly the client timeout; the order row already `shipped`/`arrived` on reload; GETs on the same origin answering in **0.5–1.9 s** (the API was warm, so it was not general slowness); and **every** failing click having taken the `advanced` branch — the only branch that notifies before responding. *Honest limit:* the SMTP step itself was not observed in Render's log at click time (the window available was service startup, not the request), so mail is the **best-supported attribution, not a directly measured one** — which is why the fix does not depend on it: the entire notify block now runs **after** the response, so whichever step inside it was slow can no longer hold the request. Same class, **9 more sites** still hold a response open on a send: `updateOrderToPaid` (`orderController.js:1090`), `confirmOrderReceived` (`orderController.js:1277`), register OTP / forgot-password / welcome / two resend-OTP paths (`userController.js:132,232,364,401,490`) and the two payment sends (`paymentRoutes.js:221,495`). Two of those are reachable from RTK mutations with the same 15 s budget — the customer's **Confirm receipt** (`useConfirmOrderReceivedMutation`, `OrderDetails.tsx:96`) and the admin **Mark as paid** — so they could false-fail identically; they are now bounded by the SMTP caps below rather than reordered (reordering money-path handlers is tracked as P3). | **P2** (production defect in the vendor fulfilment flow — no authorization, money or data impact, since the write always landed) — **FIXED this pass** | `backend/controllers/vendorOrderController.js:500` responds first and `:503` detaches the notification (logging the notify duration whenever it exceeds 1 s, so the cost is visible in Render); `backend/utils/emailService.js:46-49,73` caps `connectionTimeout`/`greetingTimeout`/`socketTimeout` at **5/5/10 s** and adds an opt-in `EMAIL_HOST` relay; `src/utils/mutationError.ts` classifies transport failures and both order screens re-sync on an unknown outcome. Tests: `backend/tests/emailResponseBudget.test.js` (3) + `src/utils/__tests__/mutationError.test.ts` (10), **4 mutations** — §6. |
| N-21 | **V-07b — the refund CAS guard was dead code, so V-07 was never actually fixed.** All three entry points read `.affectedRows` off the **array** `pool.execute()` returns (`[rows, fields]`), so the comparison evaluated `undefined === 0` → false, and the `refundReference IS NULL` claim refused nothing. The source assertions that counted both strings passed anyway (`migrationSafety.test.js`, `redteam-final.test.js`), and the UNIQUE index does not block because the three paths write *different* marker strings (`:cancel:` / `:partial:` / `:return:`). V-07's original verification therefore certified a guard that could not fire: the double-spend it reported as closed was still reachable by a vendor staff member, a compromised customer, or an admin cancel. This is the one finding in this report where the **evidence was wrong, not the code's intent** — §4 retracts it. | **P0 — FIXED this pass** | destructuring at `orderController.js` cancel and `returnController.js` partial + full; `tests/refundDoubleSpend.test.js` (5 cases, own order each): 3 refusals assert **409 and a Paystack spy at zero calls**, 2 controls assert **exactly one call against that order's own reference** — a control is what keeps an unwired path from reading as a correct refusal. **9 mutations, 9 detected.** |
| N-22 | **V-09b — the Paystack reference guard accepted `..`.** `[A-Za-z0-9._-]{1,100}` forbids `/` but permits `.`, and WHATWG normalization collapsed `https://api.paystack.co/transaction/verify/..` → `https://api.paystack.co/transaction/`, so a request left the verify prefix — at **both** wide-class sites: `POST /api/payments/verify-paystack` and the unattended `recoverStuckPendingOrders` job. No secret could move (same host, `?` refused too so nothing elsewhere was readable, the key never leaves Paystack): it defeated the *claim* that path injection was prevented rather than enabling a practical attack, which is why it grades P3 and not higher. | **P3 — FIXED this pass** | both sites now validate **the URL they build** — construct it, assert `origin` and a byte-for-byte `pathname`, then send `verifyUrl.href`; `tests/paystackReferenceGuard.test.js` (17 cases over a real socket, discriminating on **whether axios was called at all**, since every rejection and several ordinary outcomes all answer 400). **8 mutations: 5 detected, 3 equivalent** (origin clause unreachable over the class; `encodeURIComponent` identity over the class; the raw template is the same string). |
| N-23 | **The partial-refund balance pre-check could not see prior refunds.** `new Order(row)` never copied `refundedAmount`, so `validatePartialRefund` computed `remaining = totalAmount - 0` and compared the requested amount against the **whole total** instead of what was left — it could not tell a first attempt from a replay. Measured, not inferred: replay vendor A's exact share on a fresh return after their share is refunded → the balance check passes, `ReturnRequest.updateStatus` spends the one-way `pending→approved` flip, and only *then* does the SQL write guard or the refundReference CAS refuse (409) — leaving **a return marked approved with no money moved and no retry possible**, precisely the failure the P1 pre-validation comment exists to prevent. No funds can leave: the SQL guard `refundedAmount + ? <= totalAmount` was always correct and remains the backstop, so this is a workflow-integrity defect, not a fund-loss one. Found by mutation testing: the survivor came back `fail=0` because no test exercised a replay above the remaining balance. | **P2 — FIXED this pass** | the constructor now carries the column (its only reader); `partialRefunds.test.js` +1 asserts 400 **and** `return.status === 'pending'` **and** `refundedAmount` unchanged; part of the **14/14 mutation battery** in §6. |

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

`backend/tests/orderNumber.test.js` — **6 tests** for N-18, all pure (no
database, so CI's DB-less job enforces them too):

| # | Block | What it pins |
|---|---|---|
| 1–2 | source guards | checkout mints `newOrderNumber("ORD")` and the custom path `newOrderNumber("CUS")` — never a bare timestamp |
| 3 | backend-wide sweep | **no** source under `controllers/ Services/ models/ routes/ utils/` declares an `orderNumber` from `Date.now()` |
| 4 | frozen clock | with `Date.now()` pinned to a single value, 2 000 numbers are still all distinct: uniqueness comes from entropy, not from the clock (the pre-fix code returned the *same* string 2 000 times) |
| 5 | format | `PREFIX-<epoch-ms>-<8 hex>`, always inside `VARCHAR(100)` |
| 6 | volume | 20 000 consecutive numbers never repeat |

**Mutation proof:**

| Mutation | Result |
|---|---|
| helper loses its entropy (`` `${prefix}-${Date.now()}` `` — the original bug) | **3 fail**: frozen clock, format, 20 000 |
| controller reverts to `"ORD-" + Date.now()` | **2 fail**: the checkout source guard + the backend-wide sweep |
| *(both reverted)* | **6/6 pass** |

The end-to-end proof is `couponMaxUses.test.js` test 3 (20 concurrent
checkouts, "no checkout may fail with a non-cap error"): it was the assertion
that caught the 500 — 2 failures in 8 runs before the fix, 0 in the runs after.

`src/utils/__tests__/csrf.test.ts` — **10 tests** (frontend, N-19):

| # | Block | What it pins |
|---|---|---|
| 1 | helper unit | `csrfJsonHeaders()` returns `Content-Type` **and** `X-CSRF-Token` taken from `GET /api/auth/csrf-token`, fetched with `credentials: 'include'` (cross-origin: without it the cookie neither travels nor gets stored) |
| 2–3 | degradation | token fetch rejects, or answers non-2xx → the call still succeeds with `Content-Type` only; it never throws and never echoes a stale value |
| 4 | cache lifecycle | one fetch per session; `resetCsrfToken()` (login/logout) forces a fresh fetch |
| 5 | `isSafeMethod` | GET/HEAD/OPTIONS are safe, everything else — including an unknown method — fails closed |
| 6–8 | scanner self-tests | the source scanner **finds** a raw state-changing fetch with no header, **accepts** the same one once it uses the helper, and ignores `refetch()` / GET lookalikes — so a broken scanner cannot make the guard pass vacuously |
| 9 | **whole-SPA source guard** | every raw state-changing `fetch(` under `src/` (≥4: exchange, consent, forgot-password, reset-password) echoes the token; `offenders` must be empty |
| 10 | pin on the incident | `OAuthCallback.tsx`'s `/api/auth/oauth/exchange` call is state-changing, sends `credentials`, and builds its headers with the helper |

**Mutation proof:**

| Mutation | Result |
|---|---|
| revert the OAuth exchange header to `{ 'Content-Type': … }` — i.e. the exact shipped bug | **2 fail**: the whole-SPA guard **and** the incident pin |
| revert the Google-signup consent header (`useLegalConsent.ts`) | **1 fail**: the whole-SPA guard |
| *(both restored)* | **10/10 pass** |

`backend/tests/csrfToken.test.js` — **11 tests** (pure, no database, so CI's
DB-less job enforces them too):

| # | Block | What it pins |
|---|---|---|
| 1–6 | `csrfProtection` | cookie with no header → 403 `CSRF token missing` (the production answer); matching-but-unverifiable pair → 403 `CSRF token mismatch`; a valid echoing pair passes; no cookie at all still passes (public endpoints, webhooks, first login); safe methods bypass; a foreign Origin is refused before the token layer |
| 7–10 | `getOrIssueCsrfToken` | issues a signed token when absent; **echoes a healthy cookie unchanged** (no gratuitous rotation); **re-issues** a cookie that no longer verifies under today's `JWT_SECRET` — `Set-Cookie` and response body must agree, and the fresh value must verify; end-to-end: stale cookie → 403 → heal through the read channel → the echoed pair passes |
| 11 | `setCsrfCookie` | session issue still writes a correctly signed value |

**Mutation proof:**

| Mutation | Result |
|---|---|
| heal reverted — `if (existing) return existing`, i.e. the shipped behaviour | **2 fail**: the RE-ISSUES test **and** the end-to-end recovery test |
| *(restored)* | **11/11 pass** |

`src/store.csrfReset.test.ts` — **5 tests** for the cache-lifecycle half of
N-19. Session issuance always rotates the `csrf_token` cookie, so the
in-memory token has to die with the auth object:

| # | What it pins |
|---|---|
| 1 | signing in drops the cached token |
| 2 | signing out drops it |
| 3 | **a re-sign-in that never flips the signed-in flag** (persisted `userInfo`, expired JWT, no 401 seen yet) still drops it — this is the path the boolean comparison missed, and it is what would have 403'd the user's *next* state-changing request with `CSRF token mismatch` |
| 4–5 | unrelated dispatches do **not** invalidate (no churn, no extra round trip per render) |

**Mutation proof:** key the reset on `Boolean(userInfo)` again (the shipped
logic) → **1 fail** (test 3); restored → **5/5 pass**.

`backend/tests/emailResponseBudget.test.js` — **3 tests** for N-20 (pure; no
database, so CI's DB-less job enforces them too):

| # | Block | What it pins |
|---|---|---|
| 1 | **behavioural** | a local black-hole SMTP endpoint (completes the TCP handshake, never sends a `220` greeting) must be abandoned **inside the client budget**: `sendEmailSafely` returns `false` in ~5.0 s. Before the fix this is nodemailer's stock `GREETING_TIMEOUT` of **30 s** (and a refused connect is 120 s) — either way past the SPA's 15 s abort, which is what turned a committed write into a "failed" toast |
| 2 | configuration | `createTransporter()` carries `connectionTimeout` / `greetingTimeout` / `socketTimeout`, each `> 0` **and** `≤ 15000`, so no stage can inherit an unbounded default |
| 3 | source guard | in `vendorOrderController.js` the success `res.json` appears **before** `Notification.create` and `sendOrderStatusEmail`, **and** the notify block is detached (`void (async () => {`) rather than awaited. The matcher self-tests on two synthetic sources — notifies-first must be rejected, responds-but-still-awaits must be rejected — so a broken extractor cannot make the assertion pass vacuously |

**Mutation proof:**

| Mutation | Result |
|---|---|
| drop `...SMTP_TIMEOUTS` from the transporter config (the shipped behaviour) | **2 fail**: the black-hole test aborts at its own 10 s timeout instead of returning in 5, and the cap assertion finds `undefined` |
| move `res.json` back below the notification block — i.e. restore the original bug | **1 fail**: `notification runs before the response` |
| replace `void (async () => {` with an awaited call | **1 fail**: `notification is still awaited by the handler` |
| *(all restored)* | **3/3 pass** |

`src/utils/__tests__/mutationError.test.ts` — **10 tests** (frontend, N-20):
7 unit tests of `describeMutationError` — the server's own message wins; a
`TIMEOUT_ERROR` (the exact shape RTK produced here, with `data: undefined`) and
a `FETCH_ERROR` are both reported as *unknown outcome*; a `PARSING_ERROR` is
**not**, because a response did arrive; a blank server message falls back rather
than toasting nothing; and unrecognisable shapes (`undefined`, a plain `Error`,
an `AbortError`) fall back — plus 2 source guards per order screen (2 × 2),
which require `VendorOrdersSection.tsx` and `OrdersPage.tsx` to route failures
through `describeMutationError` and to `refetch()` when the outcome is unknown,
and fail if the old `toast.error(x?.data?.message || '…')` pattern reappears.

**Mutation proof:** restore the old catch in `VendorOrdersSection.tsx` → **1
fail** (the classifier guard); restored → **10/10 pass**.

### The final batch (batches ①–④): 18 suites, 245 tests

Everything in the table below was added after the N-20 revision of this report,
closing the P3 batch and the three functional-test gaps. All three HTTP suites
share `tests/helpers/httpHarness.js` (`startServer`, `collectCookies`,
`seeRedirect`) so they drive the **real router over a socket** — a request
through Express, not a function call — because §3 A-11 is precisely what
source-reading looked like while the guard it was reading could never fire.

| Suite | Tests | Finding | Mutation result |
|---|---|---|---|
| `metricsAuth.test.js` | 13 | X4a `/metrics` public | **4/4** |
| `stockIntegrity.test.js` | 19 | I3 absolute stock writes unclamped | **1/1** |
| `couponBounds.test.js` | 19 | C2 % cap + negative `totalAmount` | **3/3** |
| `migrationSafety.test.js` | 22 | N-5/N-5b, R2 | **2/2** |
| `productPriceValidation.test.js` | 18 | M-7/M-8 price schema + mounts | **2/2** |
| `vendorVisibility.test.js` | 13 | N-6 suspended vendors listed | **2/2** |
| `vendorApprovalGate.test.js` | 20 | C5 pending applicant as vendor | **5/5** |
| `storefrontPermission.test.js` | 16 | A8 storefront write ungated | **6/6** |
| `redisRecovery.test.js` | 14 | N-10 allowance on Redis recovery | **6/6** |
| `otpResend.test.js` | 13 | M-1 resend resets the counter | **6/6** |
| `emailHtmlEscaping.test.js` | 6 | M-6 raw interpolation in mail | **8/8** |
| `uploadGate.test.js` | 7 | F2 extension filter unanchored | **8/8** |
| `tryOnSsrf.test.js` | 14 | F4a syntactic URL validation | **9/9** |
| `loginTiming.test.js` | 14 | A5 login timing oracle | **12 detected, 1 equivalent** |
| `couponOracle.test.js` | 5 | X1 coupon oracle answers | **7/7** |
| `refundDoubleSpend.test.js` | 5 | V-07 / **V-07b** | **9/9** |
| `paystackReferenceGuard.test.js` | 17 | V-09 / **V-09b** | **5 detected, 3 equivalent** |
| `oauthStateGate.test.js` | 10 | V-05 functional | **6 detected, 2 equivalent** |
| | **245** | | **100 kills / 106 mutants (6 equivalent)** |

**What counts as a kill, here.** Every mutation is applied to a byte-snapshotted
file, the suite runs, the file is restored from the snapshot and its sha256
verified before the next mutant may start, and a run that reports `# pass 0` is
treated as **invalid, never as a detection** — an all-skipped suite reads as a
survivor's mirror image and would silently credit a kill that never happened.
**Six** mutants are recorded as *equivalent* rather than detected, in three
groups: `A5`'s `'timing-equaliser'` → `''` (bcryptjs prices both identically);
`V-05`'s removal of `!queryState` and of `!cookieState` (each subsumed by
`queryState !== cookieState`, which still catches a mismatch either way); and
three over the Paystack character class, where the mutant produces a
byte-identical string. They are listed instead of being quietly dropped,
because a kill count only means something if the denominator was never edited.

**Honest record of this battery.**

* **Three commits had shipped with no mutation tally at all** — `5b277b4` (X4a),
  `cac70be` (I3/C2/R2/N-5/M-7/M-8) and `f5804a7` (N-6) — so their suites were
  *tested* but not *proven*. The battery above was run to close that gap rather
  than to write a larger number: **14/14 detected, 0 survived.**
* **The first run of that battery produced one survivor, and it was real.**
  Mutant C1 (removing `refundable-balance > 0.005`) came back `24 pass, 0 fail`,
  which could have been written up as "equivalent, subsumed by the SQL write
  guard". It was not equivalent: the pre-check runs **before** the one-way
  `pending→approved` flip, so without it a replay consumes the approval and then
  fails. It survived because no test drove a replay above the remaining balance.
  Adding that test (`partialRefunds.test.js`) exposed the second half of the
  defect — the balance check never saw `refundedAmount` at all (N-23) — and only
  then did the mutant turn into a kill. **The survivor is reported as a survivor
  because that is what found the bug.**
* **Two earlier runs of the V-07 batch were invalid and are not counted.** The
  mutation script's 6-space anchor matched as a substring of a 10-space one, so
  three mutants reported `fail=0` with the tests never having executed — and at
  the end of that run both controllers were **empty**. What truncated them was
  never identified; the restore path read as correct and no test writes source.
  Recovered with `git checkout` plus re-applying the three edits, and the script
  was rewritten to refuse a file under 1000 bytes, snapshot as bytes, restore
  from that snapshot, verify the digest before the next mutant, and flag any run
  where the tests skipped. The clean re-run was 9/9 with both files
  byte-identical before and after (77612 and 21390 bytes). The three original
  "survivors" were phantoms and are excluded from every count in this report.

---

## 7. Tests executed

| Run | Command | Result |
|---|---|---|
| Full suite (sequential), **CI database** *(pre-N-19)* | `node --test --test-concurrency=1 "tests/**/*.test.js"` against MySQL 8.4 | **218/218 pass, 0 fail, 0 skipped, exit 0** |
| Full suite (sequential), **dev database** (N-19) | same command against TiDB | **229/229 pass, 0 fail, 0 skipped, exit 0** |
| Full suite (concurrency 4), **dev database** (N-20) | `npm test` against TiDB | **232/232 pass, 0 fail, 0 skipped, exit 0** |
| Full suite (sequential), **dev database** (N-20) | `node --test --test-concurrency=1 "tests/**/*.test.js"` against TiDB | **232/232 pass, 0 fail, 0 skipped, exit 0** |
| CI invocation, **CI database** *(pre-N-19)* | `npm test` (`--test-concurrency=4`) against MySQL 8.4 | **218/218 pass, 0 fail, 0 skipped, exit 0** (3 consecutive idle runs) |
| CI invocation, **dev database** (N-19) | `npm test` against TiDB | **229/229 pass, 0 fail, 0 skipped, exit 0** (3 consecutive runs, all captured — plus one earlier run with 1 unattributed failure, see the flakiness note) |
| **CI job, end to end (N-11)** *(pre-N-19)* | `npm run db:setup && npm test` with no `.env`, CI-style env, MySQL 8.4 service | **`db:setup` exit 0** (schema + all 21 migrations) **then 218/218, exit 0** |
| **CI job, end to end (N-19)** | GitHub Actions **run 49** on `852d213`, `mysql:8.4` service | `db:setup && npm test` **exit 0 → 229/229 on MySQL 8.4**; all 3 jobs green — Secret scan (4 s), Lint + tests + build (41 s), Backend tests (MySQL) (57 s) |
| **CI job, end to end (N-20)** | GitHub Actions **run 51** on `2628e65`, `mysql:8.4` service | `db:setup && npm test` **exit 0** on a suite of 232 tests (the 3 new pure mail-budget tests also run in the DB-less job); all 3 jobs green — Secret scan (6 s), Lint + tests + build (41 s), Backend tests (MySQL) (49 s). Job logs are admin-only, so the per-test breakdown comes from the identical local runs above; what run 51 proves is that `db:setup` + the full suite **exit 0 on MySQL 8.4** with this commit |
| **N-18 stability (repeated runs)** | 10 × `node --test tests/couponMaxUses.test.js`, then 8 × `db:setup && npm test` (before/after the fix) | **before:** 2/8 full-suite runs failed with `500 … Duplicate entry 'ORD-…'`; **after:** 10/10 targeted + 10/11 full-suite green (the 1 loss was the load-induced runner IPC error noted below) |
| CI invocation (no database) | `DB_HOST=127.0.0.1 DB_PORT=1 … node --test "tests/**/*.test.js"` | **168 tests: 114 pass, 54 skipped, 0 fail, exit 0** (was 165/111/54, 154/100/54, originally 127/77/50) |
| **New P2 suite, with DB (TiDB)** | `node --test tests/loginLockout.test.js` | **21/21 pass, exit 0** |
| **New P2 suite, with DB (MySQL 8.4)** | same, CI-style env | **21/21 pass, exit 0** |
| **New coupon suite, with DB** | `node --test tests/couponMaxUses.test.js` | **9/9 pass, exit 0** (≈113 s) |
| **New coupon suite, CI mode (no DB)** | `DB_HOST=127.0.0.1 DB_PORT=9 … node --test tests/couponMaxUses.test.js` | DB suite `SKIP`, source guard **1/1 pass, exit 0** |
| New red-team test file, with DB | `node --test tests/redteam-final.test.js` | **10/10 pass, exit 0** (3 consecutive runs on MySQL after the fixture fix) |
| New red-team test file, CI mode (no DB) | `DB_HOST=127.0.0.1 DB_PORT=1 … node --test tests/redteam-final.test.js` | **7 pass, 3 skipped, exit 0** (was exit 124) |
| **New CSRF suite, backend (N-19)** | `node --test tests/csrfToken.test.js` | **11/11 pass, exit 0** (pure — it also runs inside the no-DB row above) |
| **New CSRF suite, backend, mutation** | revert the `getOrIssueCsrfToken` heal | **2 fail** (RE-ISSUES + end-to-end recovery); restored → 11/11 |
| **New CSRF suite, frontend (N-19)** | `npx vitest run src/utils/__tests__/csrf.test.ts` | **10/10 pass, exit 0** |
| **New CSRF suite, frontend, mutations** | revert the OAuth exchange header (the shipped bug) / revert the Google-signup consent header | **2 fail** / **1 fail**; restored → 10/10 |
| **New CSRF cache suite (N-19)** | `npx vitest run src/store.csrfReset.test.ts` | **5/5 pass, exit 0**; mutation (reset keyed on `Boolean(userInfo)` again) → **1 fail**, restored → 5/5 |
| **N-19 live probe matrix** | `POST /api/auth/oauth/exchange` on `kente-api.onrender.com`, cookie × header × origin | no cookie → `401` (CSRF layer passed, route reached); **cookie + no header → `403 CSRF token missing`** (the incident); cookie + wrong header → `403 CSRF token mismatch`; foreign Origin → `403 Cross-site request rejected` |
| **New mail-budget suite (N-20)** | `node --test tests/emailResponseBudget.test.js` | **3/3 pass, exit 0** (pure — it also runs in the no-DB row above) |
| **New mail-budget suite, behavioural timing** | black-hole SMTP (accept, never greet) → `sendEmailSafely` | **returns `false` in 5041 ms**; nodemailer's stock `GREETING_TIMEOUT` is 30000 ms |
| **New mail-budget suite, mutations** | drop `...SMTP_TIMEOUTS` / move `res.json` back below the notify block / await the notify block | **2 fail** / **1 fail** (`notification runs before the response`) / **1 fail** (`notification is still awaited by the handler`); all restored → 3/3 |
| **New mutation-error suite, frontend (N-20)** | `npx vitest run src/utils/__tests__/mutationError.test.ts` | **10/10 pass, exit 0** |
| **New mutation-error suite, mutation** | restore `toast.error(err?.data?.message \|\| '…')` in `VendorOrdersSection.tsx` | **1 fail** (the classifier source guard); restored → 10/10 |
| **N-20 production evidence (Firefox HAR)** | `POST /api/vendors/orders/2040002/status` from `kente-market.vercel.app`, two attempts | both: preflight `OPTIONS` → **204** (CORS/token layer healthy), POST → **`status: 0`, no response headers**, toast at **~15 s**, and the order row already advanced on reload. A `GET /api/vendors/orders` on the same origin answered **200 in 1.1 s** immediately afterwards |
| Frontend unit tests | `npx vitest run` (`npm run test:frontend`) | **9 files, 69/69 pass** (was 8 files/59, 6 files/44) |
| Lint (CI gate) | `npm run lint` | **exit 0**, 0 errors / 13 warnings (was 24 errors) |
| Frontend typecheck (CI gate) | `npx tsc --noEmit -p tsconfig.json` | **exit 0** |
| Backend typecheck (CI gate) | `npm run typecheck --prefix backend` | **exit 0** (was exit 2; one regression caught and fixed while adding the portable column probe) |
| Secret scan, CI command | `gitleaks detect --source . --redact --exit-code 1` (v8.24.3) | **exit 0 — 160 commits, no leaks** (158 before this pass's two N-19 commits) |
| Secret scan, changed files | `gitleaks dir` per path (all 59 changed/untracked files) | **0 findings** (a multi-path `gitleaks dir` call silently scans the *whole* directory and picks up the gitignored `backend/.env`; CI does not use that form) |
| Secret scan, changed files (N-20) | `gitleaks dir` run once per path over the 7 files this finding touched (`vendorOrderController.js`, `emailService.js`, both order screens, `mutationError.ts` and its two new test files) | **0 findings, exit 0 for every path** |
| Audit gate (both workspaces) | `node .github/scripts/audit-gate.mjs <audit.json> <baseline.json>` | **exit 0** for frontend and backend |
| Dependency audit, runtime only | `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** (both workspaces) |
| Live: DoS re-verify | `GET /?%=1`, `?%ZZ=1`, `?%` | all `200`, process stays up |
| Live: token redaction | `GET /api/users/reset-password/<jwt>` | log shows `…/reset-password/[redacted]` |
| Live: XFF bypass | 12 rotating vs fixed source IPs | `RateLimit-Remaining` frozen at 598 vs decrementing 580→578 |
| Live: escrow qty probe | `seclab/probe-escrow-qty.mjs` | `underpaidBy: 0, exploitable: false` |
| Live: rate limiting | 14 attempts, rotating XFF, one account | before: unlimited; after: 5 allowed → `429`, unrelated account unaffected |
| Dependency audit | `npm audit` (both workspaces) | frontend 8 high / 2 moderate, backend 3 high — all dev-chain except frontend `axios` |
| **Full suite, dev DB (batch ①, X4a + data integrity)** | `npm test` | **323 tests, 0 fail** (232 + 91) |
| **Full suite, dev DB (batch ② + ③)** | `npm test` | **445 tests, 0 fail** (323 + 13 + 63 + 46) |
| **Full suite, dev DB (batch ④, V-07/V-09/V-05)** | `npm test` | **477 tests: 476 pass, 0 fail, 1 skipped, exit 0** (172.2 s) — 232 at N-20 + **245** |
| **CI invocation (no database), batch ④** | `DB_HOST=127.0.0.1 DB_PORT=59999 … node --test "tests/**/*.test.js"` | **353 tests: 298 pass, 55 skipped, 0 fail, exit 0** |
| **`redteam-final`, batch ④** | `node --test tests/redteam-final.test.js` | **10/10 pass, exit 0** |
| CI, batches ①–③ | GitHub Actions runs **53–64** | all success: 53 `5b277b4`, 54 `f5804a7`, 55–58 batch ② (`2a1b95c`, `f0838e0`, `74953c1`, `21e0606`), 59–64 batch ③ (`1b972e6`, `42a788f`, `d6c1540`, `9dd392b`, `4aacfbb`, `1b37ab3`) |
| CI, batch ④ + the N-23 fix + this rewrite | GitHub Actions runs **65** `5c27869`, **66** `9416087`, **67** `7d49981`, **68** `00e39dc`, **69** `04c934e`, **70** `351316d` | **all six success.** Runs 66–68 are batch ⑤; run 68 carried `63430f7` (N-23) and this report; 69–70 the last batch-⑤ pushes. The Tailwind v4 migration commit that follows is run **71**, verified after push |
| **Mutation battery, the three untallied commits** | `python3 /tmp/opencode/p3mut.py` + `p3mut2.py` | **14/14 detected, 0 survived, 0 invalid** — X4a 4/4, batch-1 8/8, N-6 2/2 |
| **Bad run, batch ④ (V-05 first attempt)** | `npm test` against TiDB | **477 tests: 475 pass, 1 fail** — `P0-3 consensus fulfilment` (`vendorIsolation.test.js:211`) answered 500 after 10.5 s with `Error fetching order: DB ping failed` in the log, and the run took **223 s instead of 172 s**. Isolated re-run of that file: **9/9**. Full re-run: **477/476/0/1 exit 0 with zero ping failures.** Environmental, recorded rather than dropped |
| **Bad run, batch ④ (V-09, hang)** | `node --test tests/paystackReferenceGuard.test.js` | printed every result and then **never exited** (exit 124, no `# tests` line). Root cause: the suite drives the real router, importing it runs `rateLimitMiddleware`, and `backend/.env` carries a live Upstash `REDIS_URL` — the module-scope client connects during import and its open socket holds the event loop. Fixed in the suite, not in production: `REDIS_URL` pinned empty before import (not `delete` — the limiter re-runs `dotenv.config()` and only keeps keys that still exist) plus a best-effort `quit()` in `after()` |
| **Bad run, batch ④ (V-09, anchors)** | mutation runner | 7 `ANCHOR-FAIL count 0` before the cause was read: `routes/paymentRoutes.js` is **CRLF** (576 CRs; `escrowService.js` and `authRoutes.js` are LF), so LF anchors did not match — and a 6-space anchor had matched as a substring of a 10-space one earlier, producing phantom `fail=0` results. Anchors now carry the file's own line ending and must match exactly once |
| **Final battery, whole gate, after N-23** | `lint → tsc ×2 → frontend → build → npm test → redteam-final → no-DB → 2× ratchet → gitleaks`, sequenced | **all 11 steps exit 0**: full suite **478 tests / 477 pass / 0 fail / 1 skipped, exit 0 (163 s)**; no-DB **354 / 298 pass / 56 skipped / 0 fail**; frontend **9 files, 69/69**; lint **0 errors, 13 warnings**; both typechecks exit 0; `redteam-final` **10/10**; both audit ratchets exit 0; gitleaks **179 commits, no leaks**, and **180 commits, no leaks** re-run after this report was committed; `dist/` built in 30.2 s |
| **v4 migration battery (state after palette + font pins)** | same 11 steps, sequenced | **all 11 exit 0** — lint 62 s (0 errors/13 warnings), tsc front 37 s + back 12 s, frontend **69/69**, build 33 s, full-db exit 0 (104 s), `redteam-final` 10/10 (4 s), no-DB exit 0 (45 s), ratchets 5 s + 6 s, gitleaks 7 s |
| **v4 migration battery (state this report certifies, bad run)** | same 11 steps after the `indigo-600` pin | **10/11**: lint, both typechecks, frontend 69/69, build, `redteam-final` 10/10, no-DB, both ratchets and gitleaks all exit 0; **`full-db` exit 1 at 272 s** — `couponMaxUses` (133 s), RB-01, RB-02, RB-03 subtests failed and every failure was `connect ETIMEDOUT`, hooks included, with `cleanup … skipped: connect ETIMEDOUT` lines. The TiDB-under-load signature above, not an assertion. Isolated re-run in the next row |
| **`full-db` isolated re-run #1 (same battery step)** | `npm test --prefix backend`, re-run alone | **red — 473 tests / 457 pass / 8 fail / 8 skipped, 340 s**: `couponMaxUses`, `rb01`, `rb04`, the `redteam-final` escrow hooks and `vendorIsolation` again — and again every failure's log carried the DB signature (`DB ping failed`, `connect ETIMEDOUT`, controller 500s), never an assertion. Second consecutive environmental failure, so the suite was decomposed rather than re-run blind |
| **Per-file decomposition of run #1's failures** | the five implicated files, `--test-concurrency=1`, **from `backend/`** (repo-root cwd misses `backend/.env` and skips with *no database configured* — an invalid green that was observed and rejected) | **37/37 pass, 0 fail, 0 skipped** — nothing fails when the shared connection load is removed |
| **`full-db` isolated re-run #2** | same battery step after quiescence | **green — 478 tests / 477 pass / 0 fail / 1 skipped, exit 0, 222 s**, zero ping/timeout lines; the 1 skip is the suite's deliberate `# SKIP engine parses but does not enforce CHECK` (application clamp is the documented sole defence), not a config skip |
| **Final coherent battery, whole gate (the state this report certifies)** | same 11 steps, sequenced, after all of the above | **all 11 exit 0** — lint 43 s (0 errors, 13 warnings); tsc front 67 s + back 16 s; frontend **69/69** (9 files, 30 s); build 32 s; **full-db 478 tests / 477 pass / 0 fail / 1 deliberate skip, exit 0 (208 s)**; `redteam-final` 10 tests / 0 fail in the battery's repo-root no-DB invocation (7 pass + 3 `no database configured` skips) **and 10/10, 0 skip re-run from `backend/` with the database** — CI's `npm test --prefix backend` covers it inside the full suite either way; no-DB forced path **354 / 298 pass / 56 skipped / 0 fail**; both audit ratchets exit 0 (frontend **0 accepted / 0 vulns**, backend 3 accepted); gitleaks **183 commits, no leaks** |
| **Built-CSS declaration diff, v3 vs v4** | `python3 /tmp/opencode/decl-diff.py` over both built stylesheets (v3 baseline: worktree at `351316d`, rebuilt **byte-identical, 113 472 B**) | **1407 vs 1420 selectors, 1315 common, 1693 classified declaration differences, 0 unexplained** — every difference lands in a bucket with a reason; full table below |
| **Live A/B probes, both builds in one browser** | identical fixture page served from each `dist`, `getComputedStyle` A/B | **identical on both builds**: font stacks, border colour/width, placeholder, `cursor: pointer`, line-height 32 px / 16 px, `transition` 0.15 s, `blur`/`backdrop-blur`/`drop-shadow`, indigo `rgb(79,70,229)`, dark toggle both ways, and the synthetic `space-y-4` cascade — details below |

**Flakiness note.** The database used for this review is a shared TiDB and can
return `DB ping failed` / `ETIMEDOUT` under sustained load. One sequential run
(v7) failed exactly one test (`vendorIsolation` → *"single-vendor order flows
through pipeline step by step"*) with `DB ping failed` in the log; that file
passes **9/9 when run alone**, and the next full run was clean. The same
signature reappeared in the first TiDB run of the P2 batch
(`couponMaxUses` → *"settled payment keeps its slot"*, `DB ping failed`) — that
file is green in every full-suite run above. Any suspect result was re-run
per-file to separate infrastructure from regression.

Two later runs were poisoned by a **DNS outage** (`getaddrinfo EAI_AGAIN
gateway01…tidbcloud.com`, 21 connection errors in one `npm test`) and by the
fixtures that outage's failed cleanups left behind; both were discarded and
re-run from scratch.

A third kind of noise is **not** application code: one full-suite run during
the N-18 verification failed with `Unable to deserialize cloned data due to
invalid or unsupported version` attributed to
`rb04-inventory-double-restore` — a node:test *runner* IPC parse error
(`failureType: uncaughtException` inside `#processRawBuffer`), not an
assertion, so that file's results were simply lost. The kernel journal shows
an OOM kill and load average 20 at that timestamp (the frontend vitest run,
gitleaks and both audits were executing beside the suite on a 3.5 GB box).
It did not recur in any idle run, and CI never shares a runner between jobs,
so it is an artefact of this review machine, not a shipped defect.

**This pass's own runs are recorded the same way, including the bad one.** The
first full-suite run after the N-19 change reported **1 failure out of 229** —
and I had piped that run through `tail`, so the failing test's name was gone
before I could read it. The three full-suite runs after it (all captured to a
log) and the sequential run were **229/229**. The only new code in that suite
is `csrfToken.test.js`: pure, no database, no clock, no network, run in
isolation four times green — so the shared TiDB remains the first suspect,
exactly as for every other single-test failure in this section. It is written
down rather than quietly dropped, because a report that lists only green runs
is not evidence of stability.

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

**The batch-④ flake class is the same one, with one new member.** The recurring
names are `rb01-inventory-sweeper`, `rb04-inventory-double-restore` and
`couponMaxUses`: green every time they are run alone with
`--test-concurrency=1`, and failing only inside a loaded full run. The V-05 run
above added `vendorIsolation` to that set with the identical signature — a DB
error in the log (`DB ping failed`) instead of an assertion, 10.5 s to fail, and
a total run time 51 s slower than a clean one. The rule applied throughout: a
failure whose log names a ping or packet error is re-run per file before it is
believed; if the per-file run is green *and* the next full run is green, it is
written down as environmental and left in this table. That exact sequence
occurred in this revision — two bad full runs, per-file **37/37**, then rerun #2
and the final battery both green — and all three rows are above. It never dropped from
the log, because a report containing only green runs is not evidence of
stability.

**Tailwind v3 → v4 equivalence evidence (this revision).** The migration's
objection was pixel-blindness, so it was closed with a diff instead of a
review. A parser normalised both built stylesheets (variable resolution with
per-rule scope, `calc()` evaluation, colour canonicalisation, vendor prefixes,
zero/quote/ratio formatting) and compared **every declaration of every shared
selector** — 1407 selectors in the v3 build, 1420 in v4, 1315 common, 1693
differing declarations, **0 unexplained**. The v3 baseline itself was rebuilt
from `351316d` and came out byte-identical (113 472 B, same asset hash), so
the diff measures the framework change and nothing else.

| Bucket | n | What it is, and why it renders the same |
|---|---:|---|
| `vardef` | 1367 | `--color-*` / `--text-*` / `--tw-*` custom-property declarations — v4's theme architecture. The values are pinned (below), not trusted |
| `opacity-mix` | 113 | v3 `rgba(R,G,B,a)` vs v4 `color-mix(in oklab, rgba(R,G,B,1) X%, transparent)`: same RGB by construction, `|Δa| ≤ 1/255` (v3 quantised the alpha to 8 bits), and premultiplied mixing against transparent black leaves the colour exact while alpha ramps linearly |
| `preflight` | 92 | universal/element preflight rewrites (font shorthand, `*` reset) — same computed boxes; several re-verified live |
| `v4-transform-architecture` | 56 | `transform: translate/scale/rotate(…)` split into the individual `translate:`/`scale:`/`rotate:` properties — the same matrices, now individually animatable |
| `lh-unitless` | 19 | line-height `2rem` vs ratio `1.33333`: verified `ratio × font-size = 2rem` (tolerance 1e-4 for 6-sig-fig printing). Live: **32 px on both builds** |
| `shadow-layers` | 15 | v4 shadows carry transparent zero-layers (`inset 0 0 #0000`) so rings can be animated in — identical visible shadow |
| `vendor-prefix-dropped` | 9 | v3 shipped `-moz-appearance`, `-webkit-appearance`, `-o-object-fit`, `-moz-user-select`, `-moz-column-gap`; v4 relies on the unprefixed property — each unprefixed sibling is present and equal in both |
| `vendor-prefix-added` | 4 | v4 emits `-webkit-backdrop-filter` where v3 emitted nothing — a superset |
| `gradient-cross-rule` | 4 | stops come from sibling `from-*`/`to-*` utilities in both builds; direction text is identical (`to right` vs `--tw-gradient-position: to right in oklab`). The real change is interpolation defaulting to oklab — measured at the midpoint: footer `#1a1611` alpha-fade **0.00**, grays 50→100 **0.00** and 900→800 **0.15**, hero amber→orange **4.58/255 worst channel at the exact midpoint**, endpoints exact everywhere |
| `transition-superset` | 3 | v4's `transition-property` list adds `outline-color`, gradient vars, `translate/scale/rotate`, `display`, `content-visibility`, `overlay`, `pointer-events` on top of v3's — a superset |
| `rounded-full` | 2 | v3 `9999px` vs v4 `calc(infinity * 1px)` → `3.40282e38px`: both clamp to half the box, so any element is a pill either way |
| `numeric-rounding` | 2 | `33.333333%` vs `33.3333%` — 6-significant-digit printing |
| `sr-only` | 2 | v4 keeps the `clip-path` longhand where v3 used the legacy `clip` |
| `default-opacity` | 2 | v3 declares `opacity: 1` on placeholder; v4 omits it — 1 is the default |
| `aspect-ratio` | 1 | `1/1` vs `1` — identical per spec |
| `px-format` | 1 | `max-width: 1536px` vs `96rem` — 96 × 16 = 1536 at the default root |
| `alpha-quantisation` | 1 | `drop-shadow(… rgba(0,0,0,0.15))` vs `0.14902` (= 38/255) — inside 1/255; the browser displays both as `0.15` (live probe) |
| `flex-shorthand` | 1 | `flex: 1` vs `1 1 0%` — the same values by spec |
| `preflight-derivable` | 1 | one side declares `border-style: solid`, the other derives it from the universal preflight |
| `unused-rule` | 1 | bare `.outline` (v3 `outline-style: solid` vs v4 `outline-width: 1px`) — no `outline` class token exists anywhere in `src/` (only JS object keys named `outline`), a dead utility in both builds |
| `hidden-important` | 1 | `[hidden] { display: none !important }` — no source rule combines `hidden` with a display class |

Honest limits of the tool, not of the equivalence: the evaluator refuses mixed
units (`calc(100vh - 200px)` — vh and px cannot be summed without a known
length context) and one shadow-var edge (`calc( * 1px)` after an empty
substitution); both texts are identical on both sides in every instance, so
they produce no diff either way. The diff's parser also merges repeated
selectors, so v4's `@supports`-guarded `color-mix` fallbacks (rgba rules that
mirror the modern ones) are invisible to it — they were inspected directly
instead: same selector, value equal to v3, emitted before the `color-mix`
version, which is exactly the intended progressive-upgrade order. And because
the bucketing skips `--`-prefixed declarations, **custom palette values were
not left to the diff**: all five families from the v3 `tailwind.config.js`
were compared line-by-line against the `@theme` block — `primary`
(`#fea928`/`#ffc25c`/`#ed8900`/`#f59e0b`), `gold`, `sand`, `night`, `royal`
— every hex identical; the only non-primary class in use, `bg-sand-50`,
resolves `#faf7f0` on both builds, and `royal`/`gold` produce no classes in
either build (unused in v3 too, so no utility was lost).

**What the diff found and what was fixed in source.**

* **Palette drift:** of the 95 default-palette shades the app uses, **65 had
  silently changed** under v4's oklch palette (worst: `green-400`, Δ69/255).
  All 95 are now pinned to their v3 hexes in `@theme`; `--font-sans` is pinned
  to the v3 stack (`font-mono`/`font-serif` were byte-identical, no pin
  needed). One shade escaped the first pass — `border-t-indigo-600` (the
  `-t-` infix defeated the prefix scan) — caught by a loose re-scan of every
  `-(family)-(N)` token and pinned to `#4f46e5`; live-probed `rgb(79,70,229)`
  on both builds.
* **Font resolution was a false alarm, then a real fix:** v4's `html` rule
  reads `font-family: var(--default-font-family, -apple-system…)` — the apple
  stack is a fallback only; `--default-font-family` resolves to the pinned
  `--font-sans`, and the live computed stack on both builds is exactly
  `ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", …`.
* **`space-y`/`divide` cascade conflicts:** v4's `:where()`-weighted spacing
  lost to 27 real JSX axis conflicts (12 FIRST, 11 MIDDLE, 4 LAST — all
  y-axis, zero divide cases, e.g. `space-y-4` on a child that carries its own
  `mt-*`/`mb-*`). Fixed per class: each conflicting utility gets a zero-rule
  with v4's exact selector (ties at specificity 0,0,0, wins by source order,
  still loses to child margins) plus a v3-form rule with v3's direction —
  **16 rules** in `@layer utilities`. Verified in the built CSS and live: the
  four-child cascade computes `mt/mb = 0/8, 16/0, 16/0, 16/0` **on both
  builds** — v3's semantics (gap on the start edge of all-but-first, opposite
  axis zeroed, child gap-axis margins overridden, off-axis margins preserved)
  reproduced exactly.
* **Renames, order-sensitive cases included:** `shadow-sm`→`shadow-xs` (30),
  `drop-shadow-sm`→`drop-shadow-xs` (1), `backdrop-blur-sm`→`backdrop-blur-xs`
  (13), `outline-none`→`outline-hidden` (75), 9 `bg-opacity-*` sites to slash
  syntax, `border-3` (a no-op in v3) removed, the shimmer keyframe
  re-expressed with `translate`, the dark variant declared as
  `@custom-variant dark &:is(.dark *)`, and five compound/peer-variant sites
  where v4's recomputed variants (`dark:group-hover:*`,
  `disabled:group-hover:opacity-100`, `peer-*` overrides) needed restoring.
* **v4 dropped preflight behaviours**, both restored verbatim in
  `@layer base`: `button, [role=button] { cursor: pointer }` and
  `:disabled { cursor: default }` — live-probed `cursor: pointer` on both
  builds rather than trusted from the CSS text.

**Live probes, recorded as run.** Both builds were served side by side and
probed through one browser session: font stacks (identical, v3 stack),
`border` → `rgb(229, 231, 235) 1px solid` on both, placeholder white/50 equal
(default placeholder `#9ca3af` via the pinned `--color-gray-400`),
`text-2xl` 24/32 px and `text-xs` 12/16 px on both (which also proves v4's
`@property --tw-leading { syntax: "*" }` + `* { --tw-leading: initial }`
sentinel resolves through to the theme value instead of clobbering it),
`transition` 0.15 s `cubic-bezier(.4,0,.2,1)` on both, `blur-xl` `blur(24px)`
and `backdrop-blur-md` `blur(12px)` on both, `drop-shadow-2xl` displayed as
`0.15` on both, indigo pin `rgb(79, 70, 229)` on both, and the dark toggle
flipping white/70 ↔ gray-800/70 on both (v3 serialises rgba, v4 oklab — same
colour). One probe artifact is worth writing down: the first dark-toggle
reads showed no change *on both builds* because
`* { transition-property: background-color…; transition-duration: 0.2s }`
was being measured at t≈0 of its transition; with transitions pinned to 0 s
the toggle flips immediately on both. The fixture's `shadow-xs` correctly
computes to `none` in the v3 build — the token does not exist there; the
`shadow-xs ≡ v3 shadow-sm` value identity (`rgba(0,0,0,0.05) 0 1px 2px`) was
probed separately before the rebuild.

---

## 8. Remaining issues by severity

### P0 — immediate financial/security blocker
**None open.** Four P0s were found *in this pass* and all four are fixed,
mutation-proven and covered by tests: escrow `qty`, the `redactUrl` crash, V-01
— and, in this final batch, **V-07b**, which was less a new defect than a
retraction: the refund CAS that V-07 reported as closed could never refuse
anything, because `.affectedRows` was read off the array `pool.execute` returns
(§3 A-11, §5 N-21). It refuses now, and 9 mutations each fail when the guard is
reverted — 9/9, not "the strings are present".

### P1 — public production blocker
**None open.** The last P1 found was **N-19**, and it did not come from
reading code: it arrived as a production incident — Google login answering
403 on `POST /api/auth/oauth/exchange`, then 401 on `/api/users/profile`, for
every returning visitor who still held a `csrf_token` cookie while the session
JWT had expired. The exchange was a raw `fetch` that bypassed the axios CSRF
interceptor, so the header was simply never sent (§3 A-9, §5). It is fixed
(`csrfJsonHeaders()` at all four raw state-changing call sites), the backend
read channel can no longer hand back a dead token, and the SPA's cache is
invalidated on every auth-object change rather than only on a sign-in flip.
Pinned by a whole-SPA source guard (3 mutations), 11 backend middleware tests
(1 mutation) and 5 cache-lifecycle tests (1 mutation) — §6. Before it, N-7 / V-04 (coupon cap enforced only on the counter, not on
the money) was the last P1: it is now fixed with atomic reservation at booking
time, mutation-proven and pinned by `couponMaxUses.test.js` (see §4 and §6).
The previously-reported P1s (rate-limit bypass, reset-token log leak, vendor
PII/sibling-line leak) were already closed earlier in this pass.
A second production report arrived after N-19 — a vendor's order-status update
always answered *"Failed to update order status"* — and was graded **P2**, not
P1: the write itself committed every time, no authorization or money was
affected, and the only casualties were a false failure report and a stale view
(§3 A-10, §5 N-20).

### P2 — pilot hardening
**Every P2 named in §5 is closed.** Six were in the original batch (V-10, N-8,
N-9, N-11, N-12, N-13); three more were found while working on something else
(N-14 stale canonical schema, N-15 migrations that do not run on MySQL, N-16
search meaning two different things on the two engines); N-18 surfaced while
investigating a "flaky" CI job; N-20 arrived when a vendor reported a failed
order-status update in production; and **N-23** was found by mutation testing in
this final batch. What each one was, and what now pins it:

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
* **N-18 — order-number collision on checkout** *(found while investigating
  a "flaky" CI job, after this batch).* Both checkout paths minted
  `orders.orderNumber` (UNIQUE) from `Date.now()`, so two orders inserted in
  the same millisecond asked for the same key: the loser got `ER_DUP_ENTRY`
  and answered **500 with the basket lost** — the coupon slot and the stock
  reservation were released correctly, so no money moved and no slot leaked,
  but a legitimate customer was turned away. It reproduced 2/8 local runs and
  twice in CI on code that passed on either side, i.e. it presented as
  infrastructure flakiness, which is exactly why it survived to this pass.
  `utils/orderNumber.js` now mints `PREFIX-<epoch-ms>-<8 hex>`; the
  same-class `paymentReference` check-then-insert race now answers 400 with
  the pre-check's wording instead of 500. Pinned by `orderNumber.test.js`
  (6 tests, 2 mutations, §6) and caught end-to-end by `couponMaxUses` test 3.
* **N-20 — a committed write was reported as a failure.** `updateVendorOrderStatus`
  wrote the new status and then awaited a customer notification **and** an SMTP
  send before `res.json`; nodemailer's stock budgets (2 min connect / 30 s
  greeting / 10 min socket) blew straight through the SPA's 15 s
  `fetchBaseQuery` timeout, RTK returned `TIMEOUT_ERROR` with no body, and the
  `err?.data?.message || 'Failed …'` pattern every call site used had nothing
  to quote. Two independent fixes: the handler now **responds first** and
  notifies in a detached block (logging the notify duration when it exceeds a
  second, so the cost is visible in Render), and `createTransporter()` caps all
  three SMTP stages at 5/5/10 s so the other nine sites that still sequence a
  send before their response — including the customer's *Confirm receipt* and
  the admin's *Mark as paid*, both RTK mutations — can no longer reach the
  client budget either. The SPA side now distinguishes a transport failure from
  a server answer and **re-syncs** when the outcome is unknown, instead of
  asserting a failure it cannot know. Pinned by `emailResponseBudget.test.js`
  (3 tests, 3 mutations) and `mutationError.test.ts` (10 tests, 1 mutation) — §6.
* **N-23 — the partial-refund balance pre-check could not see a prior refund.**
  `validatePartialRefund` computes `remaining = totalAmount - refundedAmount` so
  that an over-refund is refused *before* `ReturnRequest.updateStatus` spends the
  one-way `pending→approved` flip — but `new Order(row)` never copied
  `refundedAmount`, so the expression was always `totalAmount - 0`. The check
  could not tell a first attempt from a replay. Measured: replaying vendor A's
  exact share on a fresh return passes validation, flips the return to approved,
  and only then does the SQL write guard refuse with 409 — **an approved return
  with no money moved and no retry possible**, the exact failure the comment
  above the check promises cannot happen. No funds can move incorrectly (the SQL
  guard `refundedAmount + ? <= totalAmount` was always correct and remains the
  backstop), so this is workflow integrity rather than fund loss. Found because
  the mutation battery reported a survivor; adding the test that kills it
  surfaced the constructor bug. Fixed by copying the column through, pinned by
  `partialRefunds.test.js` test 3 (400 + still-pending + no money moved), and
  counted inside the **14/14** battery in §6.

**On the audit gate (why it is a ratchet, not `npm audit --audit-level=high`).**
A raw gate could not pass when this gate was built: `braces` — reached from
`tailwindcss` 3.x in the frontend and from `nodemon` in the backend — is
advisory-affected in *every* published version, and npm's only offered fix is
`npm audit fix --force`. A gate that is red on day one gets ignored and then
deleted. So `.github/scripts/audit-gate.mjs`
compares `npm audit --json` against `.github/audit-baseline.{frontend,backend}.json`
and fails only on a **new** high/critical advisory, on an accepted one **getting
worse** (baseline "high" must not silently accept "critical"), or on an audit
that **did not run** — while printing a notice when a baseline entry disappears
(fixing something must not turn the build red). Runtime dependencies stay
clean: `npm audit --omit=dev` exits 0 in both workspaces. Two criticals that
appeared mid-pass were fixed rather than baselined: `shell-quote` (command
injection in `quote()`) via an `overrides` entry to `^1.12.0`, and `axios`
above. The ratchet then did what ratchets are for: the Tailwind v4 migration
(this revision) removed the whole `braces / chokidar / fast-glob / micromatch /
tailwindcss` chain, so `audit-baseline.frontend.json` was tightened to **an
empty `accepted`** — the frontend now audits **0 vulnerabilities**, and any
future high/critical frontend advisory fails CI outright. The backend keeps its
three entries (`nodemon → chokidar → braces`, dev-only, still current when last
measured): runtime deps there audit clean, and entries may only shrink.

### P3 — post-launch

**The P3 batch is closed.** Every item the previous revision listed as open has
been fixed, given a functional test, and shown to fail when the fix is reverted —
suites, counts and mutation results are in §6, findings in §5:

| ID | What was open | Now pinned by |
|---|---|---|
| X4a | `/metrics` served a complete map of every route with no auth at all | `metricsAuth` 13 tests, **4/4** |
| N-6 | suspended vendors stayed in public listings, search, categories and trending (purchase was blocked, display was not) — behind a guard that never ran, because `!vendorId` is true for exactly the public call it was written for | `vendorVisibility` 13, **2/2** |
| C5 | a pending applicant held `role='vendor'` seconds after applying, passing the owner branch of `vendorOrStaff` | `vendorApprovalGate` 20, **5/5** |
| A8 | any vendor staff — including one holding an **empty** permission object — could edit the storefront profile and read reviews | `storefrontPermission` 16, **6/6** |
| I3 | absolute stock writes accepted any integer, and **no `CHECK` constraint existed anywhere** | `stockIntegrity` 19, **1/1** |
| C2 | admin coupon uncapped above 100%, and the PUT path wrote an unclamped total — a negative `totalAmount` | `couponBounds` 19, **3/3** |
| R2 / N-23 | `refundedAmount` check-then-act, plus a balance check that could not see prior refunds | `migrationSafety` + `partialRefunds` 25 — **1/1** (the suite's other mutant is N-5, below) |
| N-5 / N-5b | `db:migrate` had no per-row try/catch and no fatal-connection classification, so one dead connection either aborted the 21-script chain or was swallowed | `migrationSafety` 22 — **1/1** |
| M-7 / M-8 | no product price schema; 2 `validate()` mounts across 31+ mutating routes | `productPriceValidation` 18, **2/2** |
| M-1 | every OTP resend reset the attempt counter, so resending forever beat the 5-attempt cap | `otpResend` 13, **6/6** |
| M-6 | four email renderers interpolated raw names, titles and URLs into HTML | `emailHtmlEscaping` 6, **8/8** |
| F2 | the upload extension filter was unanchored, and the *name* rather than the bytes decided the stored extension | `uploadGate` 7, **8/8** |
| F4a | try-on image URL validation was syntactic only — no operator allow-list, no fail-closed default | `tryOnSsrf` 14, **9/9** |
| A5 | login answered in measurably different time depending on whether the account existed | `loginTiming` 14, **12/13** (1 equivalent) |
| X1 | the coupon-existence oracle answered differently for "no such code" and "code exists but is not for you" | `couponOracle` 5, **7/7** |
| N-10 | a fresh rate-limit allowance the moment Redis recovered from degraded mode | `redisRecovery` 14, **6/6** |
| V-07 / V-09 / V-05 | all three had **source assertions only** — greps for strings — which is exactly how V-07 shipped with a dead guard | `refundDoubleSpend` **9/9**, `paystackReferenceGuard` 8 (5 detected + 3 equivalent), `oauthStateGate` 8 (6 detected + 2 equivalent), all over a real socket |

**What is genuinely still open at P3:**

1. **Registration still answers 400 ("address taken") vs 201.** Closing it means redesigning when the OTP token is issued — it is minted inside that same request. It is *bounded*: `accountRegisterLimiter` (5 / 15 min, keyed on the probed email, counting **both** answers) makes a prober pay per address and `X-Forwarded-For` rotation buys nothing. Deliberately out of scope this pass (V-10 residual).
2. **Nine sites still *sequence* an awaited `send*Email` before their response** — `updateOrderToPaid`, `confirmOrderReceived`, five OTP/reset/welcome sends in `userController`, two in `paymentRoutes`. They are now *bounded* by the 5/5/10 s SMTP caps, which hold them inside the SPA's 15 s budget; moving them off the response path is a design cleanup, not a security fix.
3. **Two grantable staff permissions are inert.** `manage_staff` and `reply_reviews` are in `VALID_PERMISSIONS` and labelled in the UI, but no route consumes either: staff CRUD is gated `protect, vendor` (owner only, so a staff account cannot mint more staff), and `GET /api/vendors/reviews` is read-only — there is no reply endpoint to gate. Granting them grants nothing, so it fails closed; what it costs is *delegation* (an owner cannot hand staff management to a trusted employee), not security. Recorded rather than invented: wiring a permission to a route that does not exist would be theatre.
4. ~~**`tailwindcss` 3.x → 4.x.** Mechanically small, but a visual change with no safety net that can see pixels, and the only way to clear the five remaining frontend highs from the audit baseline. Post-launch by decision.~~ **Closed this revision, and closed by taking the "no pixels" objection seriously rather than waving it away.** The migration is backed by a declaration-level diff of the built CSS: every selector present in both builds (1315 of them) compared declaration-by-declaration after normalising variable resolution, `calc()` evaluation, colour formatting and vendor prefixes — **0 unexplained differences**; the known classes of difference are enumerated with their reasoning in §7 (v4 `color-mix` alpha inside 1/255, line-heights re-verified as `ratio × font-size`, shadow zero-layers, `@property` sentinel resolution, …). That diff is what *found* the regressions: 65 of 95 used palette shades had silently drifted (worst Δ69), the font stack had drifted, the v3→v4 `space-y` cascade now zeroed child margins differently, v4 dropped the cursor-pointer preflight, and the rename table (`outline-none`→`outline-hidden`, `shadow-sm`→`shadow-xs`, …) had order-sensitive cases — each fixed in source and re-proved, then probed live in a browser on both builds (fonts, borders, placeholders, line-height, transitions, filters, gradients, dark toggle, synthetic `space-y-4` cascade). The five frontend audit highs it blocked are gone: the frontend baseline is now an empty `accepted`.
5. **V-05's "single use" is enforced only client-side.** The state token stays cryptographically valid until its 10-minute expiry after the first exchange; what stops a replay is that an attacker cannot place the `oauth_state` cookie in the victim's browser. Written down as a residual of the design rather than "fixed", because the fix belongs to whoever next touches the OAuth flow.

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
6. **N-18 (P2)** — ~~stop minting `orders.orderNumber` (UNIQUE) from
   `Date.now()`, so two orders created in the same millisecond stop colliding
   and 500-ing the loser's checkout.~~
   **Done (this pass).** `utils/orderNumber.js` mints
   `PREFIX-<epoch-ms>-<8 hex>` for both checkout paths (`ORD`, `CUS`), so
   uniqueness comes from entropy rather than from the clock; the same-class
   `paymentReference` check-then-insert race now answers 400 with the
   pre-check's wording instead of a generic 500. The coupon slot and stock
   reservation were already released correctly on that path, so no money moved
   — only the basket. 6 tests, 2 mutations, §5/§6.
7. **N-19 (P1)** — ~~make every state-changing raw `fetch` in the SPA echo
   `X-CSRF-Token`, and stop `getOrIssueCsrfToken` from handing back a token
   that no longer verifies.~~
   **Done (this pass).** One shared `csrfJsonHeaders()` helper now builds the
   headers for all four raw state-changing calls (OAuth exchange, Google-signup
   consent, forgot-password, reset-password), and the read channel re-issues
   any cookie that fails HMAC verification instead of echoing it — so a
   `JWT_SECRET` rotation self-heals on the next token read rather than 403-ing
   every state-changing request for 30 days — and the SPA's cached token is
   invalidated on every auth-object change, not only when the signed-in
   boolean flips. 26 tests (15 frontend + 11 backend), 5 mutations, §5/§6. **Deploy note:** the reported login failure is
   fixed by the **frontend** deploy alone (the API's behaviour toward a correct
   echo is unchanged); the API deploy only carries the rotation self-heal.
   Until the frontend is out, a blocked browser recovers by clearing site data
   for the API origin (or by password login).
8. **N-20 (P2)** — ~~answer the request before notifying the customer, and
   stop nodemailer's multi-minute timeouts from reaching a caller that gives
   up at 15 s.~~
   **Done (this pass).** `updateVendorOrderStatus` now sends its `res.json`
   **first** and runs the notification + email in a detached block behind it
   (with a `> 1 s` warning logged so the cost shows up in Render), and
   `createTransporter()` caps `connectionTimeout`/`greetingTimeout`/`socketTimeout`
   at **5/5/10 s** — proven against a black-hole SMTP endpoint (5.0 s instead
   of 30 s). The SPA classifies transport failures through
   `describeMutationError()` and re-syncs when the outcome is unknown, so a
   timeout can never again be reported as a definite failure. 13 tests,
   4 mutations, §5/§6. **Deploy note:** the reported symptom is fixed by the
   **backend** deploy alone; the **frontend** deploy supplies the honest toast
   and the automatic refetch. Either way, confirm afterwards that advancing a
   pipeline button shows the success toast immediately and that Render logs the
   `[vendor-order-status] customer notification completed in …ms` line *after*
   the response.
9. **Rotate the leaked Paystack test key (hygiene, do it anyway).** This pass's
   secret scan found a real-looking `sk_test_…` key committed in
   `backend/.env.example`; the file is fixed and its fingerprint is in
   `.gitleaksignore` (so the scanner cannot be poisoned into ignoring *other*
   findings), but the key itself is still valid until Paystack revokes it.
   Revoke it, then confirm `gitleaks detect --source .` stays at 0 findings.
10. **P3 batch** — ~~`/metrics` auth, `CHECK` constraints for stock, vendor-status
   predicate on public product queries (`productModel.js:187-189` is bypassed
   because every public controller passes `approvalStatus='approved'`),
   escaping in `emailService.js`, price schema, negative functional tests for
   V-05/V-07/V-09.~~ **Done (batches ①–④).** All of it, plus everything the
   batch was extended to cover: `metricsTokenGuard` (X4a, fail-closed 404 when
   `METRICS_TOKEN` is unset), `toNonNegativeInt` at all four absolute stock
   writes *and* a `CHECK` constraint (I3 — the clamp is authoritative, because
   TiDB parses CHECK without enforcing it), the ≥100% cap and the
   negative-`totalAmount` floor (C2), the `refundedAmount` refusal with
   `affectedRows` gating and a `MANUAL RECONCILIATION REQUIRED` log (R2 — a
   refusal must not 500, Paystack has already moved money), fatal-vs-row-level
   error classification in the migration chain (N-5/N-5b), the suspended-vendor
   predicate (N-6/N-6b, whose first fix collapsed to an INNER JOIN and hid
   platform products), the price schema on all four product routes (M-7/M-8),
   `requireApprovedStore` (C5, exactly one exemption: `GET /api/vendors/me`),
   `manage_storefront` enforced on `PUT /api/vendors/profile` (A8),
   `carryLocalCountsForward` before the Redis switch (N-10),
   `otpResendLimiter` (M-1), the canonical HTML escaper (M-6), the anchored
   upload gate (F2), `AI_TRYON_ALLOWED_HOSTS` (F4a), `burnPasswordTime` (A5),
   the unified coupon refusal (X1) — and the three functional-test gaps
   V-07/V-09/V-05, which is where the batch turned up **V-07b (P0)** and
   **V-09b** and, through mutation testing, **N-23**. 18 suites, 245 tests,
   **100 kills of 106 mutants** (6 equivalent); §6.
11. **Deploy — user-owned, not verifiable from here.** **Render** carries the
   backend half (N-20's detached notification, the refund guards, and every
   batch ①–④ fix); **Vercel** carries the frontend half (`csrfJsonHeaders()`,
   `describeMutationError()`, the CSRF cache reset). The per-finding deploy
   notes are in items 7 and 8. Nothing here can be claimed as *live* until
   both are out, which is one reason §12 does not say "production ready".
12. **Backup job — user-owned, never run.** `.github/workflows/backup.yml` has
   never completed: 0 of its first 3 scheduled attempts succeeded, and run 4
   failed **as designed**, at its preflight, which names the **8 secrets that
   must be configured**. Set those 8, trigger the workflow manually, and
   confirm it goes green before trusting it.

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
| "The username enumeration oracle" — carried by *this* report in §2 and §12 | **Disproven and withdrawn.** The product has no username: `branding_house.sql` declares no `username` column, no route reads one, and the three backend hits are `rateLimitMiddleware` keying a limiter bucket on `req.body.username` (which reveals nothing — it only names the bucket), `reviewController`'s echo of a **public** display name, and `url.username` inside a WHATWG `URL` parse. There is nothing to enumerate, so the finding is deleted rather than closed — the same rule §1 states for a disagreement between a prior report and the code: the code wins. |
| "V-07 refund double-spend — fixed, all three entry points CAS-claim and gate on `affectedRows`" (previous revision of this report) | **Retracted.** The gate was dead code: `.affectedRows` was read off the **array** `pool.execute` returns, so the comparison was `undefined === 0`, always false. The assertions that certified it counted strings in the source, and a UNIQUE index that exists but cannot block (the three paths write different marker strings) completed the illusion. Retracted in §3 A-11 and §5 N-21, replaced by a functional test, and now proven by **9 mutations, 9 detected**. |

---

## 11. Verified security strengths

* **Two-layer money invariants — with one honest exception.** `releaseAllocation`
  uses a conditional `held → available` update *and* a DB unique key
  (`uq_wallet_credit_allocation`); only disabling both reproduces the duplicate
  credit, which `redteam-final` test 8 proves. Payment idempotency and stock
  markers have the same shape. **Refunds do not — and this report previously
  claimed they did.** `uq_orders_refundReference` is real but cannot block the
  cross-entry-point double-spend, because the cancel, partial and return paths
  write *different* marker strings (`:cancel:` / `:partial:` / `:return:`); the
  index only stops one path claiming twice with an identical value. The
  application CAS is the layer that matters there, and it was dead code until
  V-07b (§5 N-21). The index is worth keeping. It is not a second layer, and
  calling it one is how a dead guard stayed invisible.
* **Server-authoritative pricing.** Totals are recomputed from stored items and
  a server-validated coupon; Paystack verification demands an exact kobo match
  on both verify and webhook paths — which is exactly why V-01 mattered.
* **Upload handling is solid.** Magic-byte validation, strict filename grammar
  (`\d+-(product|reference)-…`), SVG rejected, path traversal rejected before
  ownership checks.
* **No hardcoded secrets**, `.env` untracked, production boot refuses to start
  without `SESSION_SECRET`, `JWT_SECRET`, `FRONTEND_URL` and
  `PAYSTACK_SECRET_KEY`.
* **CSRF coupling is asserted in code** — and, after N-19, on both ends of the
  wire: `COOKIE_SAME_SITE=none` without `csrfProtection` mounted exits at boot,
  while the SPA now has exactly one `csrfJsonHeaders()` builder plus a
  whole-SPA source guard that fails if any state-changing raw `fetch` stops
  echoing the token. N-19 is the durable lesson underneath it: a server-side
  guard being *correct* says nothing about whether every client path actually
  *reaches* it — every axios caller was protected, the single raw `fetch` was
  not, and the failure showed up as an authentication error rather than as a
  CSRF error.
* **A response is never held open by an external service.** After N-20 the
  fulfilment handler answers as soon as the write is committed and notifies
  behind it, and all three SMTP stages are capped at 5/5/10 s against a client
  that aborts at 15 s — proven against a black-hole mail server rather than
  asserted in a comment. The lesson is the mirror image of N-19's: N-19 failed
  because a client path never *reached* a correct server guard, while N-20
  failed because a correct server path *reached the client too late* and the
  client had no vocabulary for "I don't know" — `data.message` was undefined,
  so the UI asserted a failure it had not observed. Both are now pinned at the
  edges: source guards on the SPA side, a behavioural timeout test on the
  server side.
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
mutation-proven and pinned by tests that fail against the reverted code — and
in this final batch a **fourth** was found among them: V-07b, the refund CAS
that had been reported fixed while it compared `undefined === 0`.

Ten of the twelve prior-round findings I re-derived independently — V-02, V-03,
V-05, V-06, V-07, V-08, V-09, V-11, N-2, N-4 — hold up under adversarial
re-reading, which is better than the earlier reports claimed for themselves.
Two of the round-2 findings do not: **V-01 was still exploitable** (the "fix"
added comments but kept a raw `axios.put`, so the charge used the stale
pre-coupon total — closed in this pass), and **V-04 remained open** — the coupon
cap was enforced on the counter rather than on the money. A third kind of
failure appeared later, and it is the more instructive one: V-07 the *finding*
held up perfectly while V-07's *certification* did not — the guard was there,
the strings were there, and the code path that was supposed to refuse could not
refuse. That is the difference between reading a file and exercising it, and it
is why every fix added in this final batch is pinned by a test that drives the
real router or the real database (§6). **V-04 is now closed
too**: the slot is reserved atomically at booking (before Paystack ever charges
a discounted amount), tied to the order, released on cancel/expiry/failure and
made permanent on settlement; 9 tests and 2 reverted mutations prove it.
**V-10 is closed too**: the counter decays inside a 15-minute window, so one
request per hour can no longer hold a victim's account locked — 21 tests (4 of
them behavioural against a real database) and 3 reverted mutations prove it,
including the exact mutation that made the lock permanent.

**N-18 was caught by re-running CI, and N-19 was caught by production itself.**
Both checkout paths minted `orders.orderNumber` (UNIQUE) from `Date.now()`, so
two orders landing in the same millisecond collided and the loser answered
**500 with its basket lost**. It survived two green reports precisely because
it *looked* like flaky infrastructure — the failing CI runs were byte-identical
to green ones on either side. Uniqueness now comes from entropy, not from the
clock, and the catch path that releases the coupon slot and the stock was
verified rather than assumed. 6 tests, 2 mutations.

N-19 is the one a test suite of that shape could not have found: it arrived
from the live deployment as `oauth/exchange 403 → profile 401 → "Not
authenticated"`, and the cause was a *raw* `fetch` in the OAuth callback that
bypassed the axios interceptor carrying `X-CSRF-Token` — so every other call
in the app was correctly protected while this one was not, and it 403'd any
visitor whose session JWT had expired but whose 30-day CSRF cookie had not.
The probe matrix in §5 shows the Origin check was healthy and the token layer
was the killer. All four raw state-changing calls now build their headers
through `csrfJsonHeaders()`, guarded by a whole-SPA source scan that fails if
any of them stops, and the backend read channel can no longer return a token
that would 403. 26 tests, 5 mutations. Note that this one is **fixed in
`main` but not yet in front of users** — it ships when Vercel rebuilds the
frontend (that alone restores Google login); the API deploy only carries the
secret-rotation self-heal.

**N-20 arrived from a user as well, and it is the mirror image of N-19.** A
vendor clicked a fulfilment pipeline button in production and was told
*"Failed to update order status"* — every time — while the order status
advanced anyway. The handler wrote the row and then waited on a customer
notification and an SMTP send before answering; nodemailer's stock budgets are
2 minutes to connect, the SPA gives up at 15 s, and RTK's timeout returns
`TIMEOUT_ERROR` with **no body**, so the `err?.data?.message || 'Failed …'`
pattern every call site used had nothing to quote and simply asserted failure.
Nothing was lost — no money, no authorization, no data — but the system told
its operator something it could not know, which is its own kind of defect: the
vendor would reasonably repeat work the server had already done. The evidence
is recorded in §5 and §7 (preflight 204, POST `status: 0`, toast at ~15 s, row
already updated, GETs on the same origin at 0.5–1.9 s), including the honest
limit that the mail step was never observed in the log at click time — so the
fix does not depend on which part of that tail was slow: the response now goes
out **first**, the notification runs behind it, and the mail client is capped
at 5/5/10 s so the nine other sites that still sequence a send cannot reach the
budget either. 13 tests, 4 mutations.

**No P0, no P1 and no P2 remains open — and that sentence costs more to write
than it did in the previous revision, because this final batch found two more
of them anyway.** V-07b (P0) was not so much a new defect as a retraction: the
refund CAS the report previously certified as fixed could never refuse anything,
and the assertions that certified it were counting strings rather than behaviour
(§3 A-11, §5 N-21). N-23 (P2) came out of the mutation battery — a survivor,
and the survivor was right: the partial-refund balance check could not see prior
refunds, so a replay consumed the one-way approval and *then* failed (§5 N-23).
Both are fixed, both have tests that fail against the reverted code, and both
are recorded with the run that found them rather than folded quietly into a
green table. What that says about method is worth more than the two findings:
a source assertion can be satisfied by dead code, and a mutation reporting
`fail=0` is either proof the guard is redundant or proof that nothing was
testing it — and those two look identical until you go read the failure.

What is left before a pilot is operational rather than adversarial: **deploy
what is already in `main`** — N-19 needs a Vercel rebuild (that alone restores
Google login), N-20 and every batch ①–④ fix need the **Render** deploy (§9
items 7, 8 and 11), then watch the first runs of the new CI database job (a
green gate on day one is evidence, not a habit), rotate the legacy Paystack test
key this pass found pasted into an old version of `backend/.env.example` (its
fingerprint is in `.gitleaksignore`, so the scanner will not flag it again, but
the key itself should still be revoked), configure the **8 secrets `backup.yml`
names and trigger it once by hand** — that workflow has never run. The P3 batch
that the previous revision left open is closed (§8); four P3s are genuinely
open and each is written down with its bound: the registration 400-vs-201
oracle (bounded by `accountRegisterLimiter`), the nine sites that still
sequence an email send (bounded by the 5/5/10 s SMTP caps), the two grantable
staff permissions nothing enforces (fails closed), and V-05's single-use state,
which is client-side only. The `tailwindcss` v4 migration that used to stand
beside them is closed too, with its equivalence proof recorded in §7 rather
than asserted from a green build.

Confidence statement: every "fixed" verdict above is backed either by a test
that was shown to fail when the fix is reverted, or by a live measurement
recorded in §7. Where no such test existed — X4a, the batch-1 data-integrity
fixes, N-6 — the battery in §6 was run rather than assumed, ending at **14/14
detected**, and the one survivor it produced is reported as a survivor because
that is what led to N-23. The bad runs are in §7 with their causes: a TiDB ping
failure that cost one test at 223 s, a live `REDIS_URL` that held the event loop
and hung a suite at exit 124, CRLF anchors that matched nothing, and three
phantom `fail=0` results from a script that emptied two controllers and never
explained how. No finding is marked closed on the strength of a comment, a
commit message or a previous report.
