# AI Virtual Try-On — Test Report

Date: 2026-10-14. Branch `main`, uncommitted working tree.
No paid AI requests were made. No shared, staging or production database was
contacted: DB-backed runs used a throwaway MySQL 8.4.11 on `127.0.0.1:33717`
(datadir in the session scratchpad), with every `backend/.env` key shadowed
by a placeholder (dotenv reported `injected env (0)`).

## 1. Results

| Gate | Result |
|---|---|
| Backend full suite, local MySQL, fresh `db:setup` (all migrations incl. `migrateTryOnJobs.js`) | **995 / 995 pass, 0 fail, 0 skipped** (`--test-concurrency=2`) |
| Backend try-on suites, local MySQL (after the backoff fix in §5) | **129 / 129 pass** |
| Backend try-on suites, no database | **119 pass, 0 fail; 10 DB tests SKIPPED** (`tryOnJobRepository.test.js` reports `# SKIP: no database`; node:test still prints `# skipped 0` for a skipped `describe`, so the 10 are counted here by hand: 129 − 119) |
| `migrateTryOnJobs.js` re-run on a migrated DB | exit 0 (idempotent) |
| Frontend vitest (all) | **135 / 135 pass** (18 files) |
| Frontend typecheck (`tsc --noEmit`) | 0 errors |
| Backend typecheck (`tsc --noEmit -p backend/tsconfig.json`) | 0 errors |
| Lint (`eslint .`) | 0 errors; 13 warnings, all pre-existing, none in try-on files |
| Production build (`vite build`, to a scratch dir) | OK |
| Bundle scan for `AI_TRYON_API_KEY`, `REPLICATE_API_TOKEN`, `api.replicate.com`, `whsec_`, `r8_…` | none found |

## 2. Try-on test files

| File | Tests | Covers |
|---|---|---|
| `backend/tests/tryOnGenerateFlow.test.js` | 36 | full job lifecycle through real handlers + service: product A/B image binding, ignored client garment/vendor/price, no spend on refusals (bad/corrupt photo, URL photo, hidden/suspended/unapproved/unsupported product, missing consent, caps, daily limit, kill switch), idempotency, no auto-retry on submit timeout, provider error mapping without provider text, polling + single poller, owner-only status/result, result re-encoding, webhook verify/idempotent/late-event, deadline + cancel once, interrupted submit, restart reconciliation, result expiry + lost file, orphan cleanup, photo never in records/logs, eligibility endpoint |
| `backend/tests/tryOnProviderAdapter.test.js` | 22 | Replicate request shape (Bearer, `Cancel-After`, webhook filter, overrides), every documented status incl. `aborted`, output parsing, output-host allow-list (key never sent elsewhere, no redirects), webhook HMAC (valid, multi-sig, tampered, wrong secret, replay, wrong version, missing headers), paid-call-aware error classification, readiness gates (kill switch, provider, key, legacy token, invalid config without echoing secrets, webhook pairing, production licence gate, mock refused in prod, non-try-on provider refused) |
| `backend/tests/tryOnHttp.test.js` | 8 | real HTTP: 401 for unauthenticated/forged cookie on all job routes; `/status` exposes only a boolean; raw webhook body reaches the verifier unmodified, >1 MB accepted, forged refused; frontend source has no provider key names or provider API host |
| `backend/tests/tryOnJobRepository.test.js` (DB) | 10 | real SQL: poll backoff schedule, product visibility (suspended vendor, pending, platform product, non-wearable), unique idempotency key, CAS transitions, exactly one concurrent poll winner, deadline/stale/expiry queries, delete-only-unsubmitted, purge, owner-scoped lookup, daily credit, no column can hold image data |
| `backend/tests/tryOnSsrf.test.js` | 15 | (existing, retargeted) remote-image allow-list, private hosts, ports, data: URIs; ordering inside `createTryOnJob`; literal kill switch incl. explicit provider |
| `backend/tests/tryOnUploadSecurity.test.js` | 38 | (existing, extended) photo decoding/sniffing/pixel caps/EXIF stripping, catalog path containment, config clamps, private result store (0600, atomic, outside uploads, UUID-only names, sweep), route wiring incl. webhook-before-JSON |
| `src/ai-tryon/__tests__/AiTryOn.test.tsx`, `tryOnService.test.ts`, `src/Pages/AllProducts/__tests__/productDetailsTryOn.test.tsx` | 46 | product-bound page, no gallery, consent gating, only photo + product id sent, per-attempt key, real-status progress copy, double-submit, failed/expired/retry with new key, result expired, Add to Cart / View Product / Choose Options / sold out reference the same product, Try Again keeps product and re-asks consent, ineligible/hidden/offline states, service product-mismatch refusal, error mapping, no photo in logs, blob result URL, product page checking/eligible/disabled/hidden states |

## 3. Mutation checks (tests fail when the guarantee is removed)

| Mutation | Caught by |
|---|---|
| Poll claim ignored (every reader polls the provider) | 2 tests in `tryOnGenerateFlow` |
| Poll backoff assignments in the old order (10, 20, 30 s instead of 5, 10, 20, 30 s) | `tryOnJobRepository` backoff test |
| Vendor-visibility guard neutralised in the product SQL | `tryOnJobRepository` (DB). The mocked suites alone did **not** catch it — they check the SQL text, not its effect — which is why the DB suite exists. |

## 4. Not tested / limitations

- **No real provider call.** The Replicate adapter is tested against its
  documented API with mocked HTTP. The IDM-VTON input schema and categories are
  unverified; garment fidelity on real Kente is unknown. See
  `AI_TRYON_PROVIDER_SETUP.md` §7 for the manual staging tests.
- Multi-instance behaviour (shared result storage) is out of scope; see
  `AI_TRYON_OPERATIONS.md` §9.
- TiDB was not used for this run (MySQL 8.4 only); the SQL uses no TiDB-
  incompatible features (no triggers, FULLTEXT or CHECK).

## 5. Browser walkthrough (2026-10-14)

Real stack: Vite dev server → local API (`node server.js`, `AI_TRYON_PROVIDER=mock`,
outbound HTTP blocked) → throwaway MySQL with a seeded customer, a second
account, an approved vendor and three products. Headless Chrome 153 driven by
Playwright 1.60. A synthetic gradient image was used as the "photo".

| Step | Observed |
|---|---|
| Product page, wearable product | "Try It On" enabled, explanation shown; picking 4 yards → `/ai-tryon?product=1&yards=4` |
| Product page, "Kente Table Runner" | button disabled, reason "not a wearable item" shown; opening `/ai-tryon?product=3` directly offers no upload |
| Try-on page | only the selected product shown; button disabled until photo AND consent; photo preview with "Photo ready" |
| Processing | form disabled, "Sending your photo securely…" then "The AI is creating your try-on…"; no percentages |
| Network | each `POST /api/tryon/jobs` body had exactly `consent, idempotencyKey, modelImage, productId` |
| Result | `blob:` image, real product image beside it, name, price, "4 yards", AI-visualization label and disclaimer, View Product → `/product/1` |
| Result access | owner 200 `image/jpeg`, `Cache-Control: private, no-store`; signed-out 401; another account 404 |
| Add to Cart → cart | cart holds Adinkra Royal Stole, GH₵450, 4 yards selected |
| Try Again (product 2) | same product kept, consent checkbox cleared |
| `/ai-tryon` with no product | "Start from a product you love" + Browse link |
| Mobile 390 px | single column, 0 px horizontal overflow |
| Browser console | no errors |
| Timing (mock) | click → result 19.7 s before the backoff fix, **13.6 s** after |

Found and fixed: the provider-poll backoff in SQL started at 10 s, not 5 s (SET
evaluation order), delaying every result by up to ~15 s. Now 5, 10, 20, 30 s
on both MySQL and standard-SQL evaluation, with a DB test.

Found, NOT fixed (pre-existing, outside try-on scope): the server cart sync
(`backend/routes/cartRoutes.js`) stores `item.image`, but cart items carry
`img`, so a cart reloaded from the server (new device/session) shows no
product thumbnail. Affects Add to Cart from the product page equally.
