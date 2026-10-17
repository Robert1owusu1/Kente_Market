# AI Virtual Try-On — Architecture

Status: **CODE-COMPLETE, PROVIDER-SETUP-PENDING** (see `AI_TRYON_PROVIDER_SETUP.md`).

The customer picks a Kente Market product; the AI shows that exact product on
the customer's photo. The AI never chooses, suggests or substitutes clothing.
The marketplace product row is the single source of truth for the garment.

## 1. End-to-end flow

```
Product page (/product/:id)
  │  GET /api/tryon/product/:id  ── eligibility (public, no image read)
  │      → button hidden (feature off) | disabled + reason | "Try It On"
  ▼
/ai-tryon?product=<id>&yards=<y>      (product fixed for the whole session)
  │  photo: upload or camera → downscaled + re-encoded in the browser
  │  consent checkbox (required)
  │  POST /api/tryon/jobs { productId, modelImage(data: URI), consent, idempotencyKey }
  ▼
Backend: createTryOnJob (Services/tryOn/tryOnJobService.js)
  1. provider ready? (kill switch + adapter config checks)      else 503
  2. consent === true, idempotency key format                   else 400
  3. same key seen before → return that job (no spend)
  4. photo: strict data: URI → magic bytes → pixel caps → decode → re-encode (EXIF/GPS gone)
  5. garment: product row by id (approved, vendor approved, wearable, usable image)
  6. category → adapter.mapGarmentCategory                      else 422
  7. insert job row 'queued' (unique per user+key)
  8. active-job caps (per user, global)                         else 429, row deleted
  9. daily credit (ai_tryon_usage)                              else 429, row deleted
 10. adapter.submitJob — exactly once, never auto-retried
 11. row → 'processing' with the provider's job id
  ▼
Browser polls GET /api/tryon/jobs/:id every 3 s (owner only)
  │  server: if a poll is due, ONE caller wins claimPoll → adapter.getJobStatus
  │  (optional) provider webhook → POST /api/tryon/webhooks/:provider (signed)
  │  scheduler sweepTryOnJobs every 2 min (reconcile, deadlines, cleanup)
  ▼
On provider success: adapter.fetchResult (provider host only)
  → decode + re-encode → private store <jobId>.jpg → row 'succeeded' (CAS)
  ▼
GET /api/tryon/jobs/:id/result (owner only, Cache-Control: private, no-store)
  → browser blob: URL (never a public/provider URL)
  ▼
Result screen: AI image + real product image, name, price, yards,
  View Product, Add to Cart (same product + yards) | Choose Options,
  Try Again (same product), Download, "AI-generated visualization" disclaimer
```

## 2. Components

| Layer | File | Responsibility |
|---|---|---|
| Routes | `backend/routes/tryOnRoutes.js` | `/status`, `/product/:id`, `/jobs`, `/jobs/:id`, `/jobs/:id/result`; auth + limiters |
| Webhook mount | `backend/server.js` (§6b) | raw body (8 MB) before the JSON parser |
| Controller | `backend/controllers/tryOnController.js` | thin HTTP handlers, safe error mapping |
| Job service | `backend/Services/tryOn/tryOnJobService.js` | lifecycle, idempotency, caps, credit, reconcile, webhook, sweep |
| Garment resolver | `backend/Services/tryOn/garment.js` | product eligibility + image source; SSRF allow-list |
| Provider registry | `backend/Services/tryOn/providers/index.js` | adapter contract, readiness/activation gates |
| Replicate adapter | `backend/Services/tryOn/providers/replicateIdmVton.js` | everything Replicate-specific |
| Mock adapter | `backend/Services/tryOn/providers/mockProvider.js` | dev only, labelled "not AI", refused in production |
| Job repository | `backend/Services/tryOn/jobRepository.js` | all SQL; every transition is compare-and-set |
| Result store | `backend/Services/tryOn/resultStore.js` | private local directory, atomic writes, sweep |
| Config | `backend/Services/tryOn/config.js` | env parsing with clamps |
| Errors | `backend/Services/tryOn/errors.js` | normalised codes → HTTP + customer message |
| Image pipeline | `backend/utils/tryOnImage.js` | photo/garment sanitising, wearable check |
| Migration | `backend/migrateTryOnJobs.js` | `ai_tryon_jobs` (in `npm run db:migrate`) |
| Scheduler | `backend/utils/cleanupJobs.js` | `sweepTryOnJobs` every 2 min (distributed lock) |
| Frontend API | `src/ai-tryon/api/tryOnService.ts` | create, poll, private result blob, product check |
| Page | `src/ai-tryon/AiTryOn.tsx` | product-bound journey, consent, real-status progress |
| Result | `src/ai-tryon/TryOnPreview.tsx` | comparison, purchase actions, disclosure |
| Product page | `src/Pages/AllProducts/productDetails.tsx` | eligibility-driven "Try It On" |
| Cart item | `src/utils/cartItem.ts` | one cart shape for product page + result |

The frontend knows nothing about any provider: it sees jobs, statuses and
error codes only.

## 3. Provider adapter contract

Defined in `backend/Services/tryOn/providers/index.js`. An adapter is a module
default-exporting:

| Member | Contract |
|---|---|
| `id` | value of `AI_TRYON_PROVIDER` that selects it |
| `capabilities` | `{ personImage, referenceGarmentImage, garmentCategories[], completion: ('poll'\|'webhook')[], maxInlineImageBytes }` — the registry refuses an adapter without person + reference-garment support |
| `verification` | `{ inputSchemaVerified, commercialUseAllowed, licence }` — production refuses `commercialUseAllowed:false` unless `AI_TRYON_PROVIDER_TERMS_ACCEPTED=true` |
| `validateConfiguration(config)` | `string[]` of operator-facing problems; must never include secret values |
| `mapGarmentCategory(internal)` | provider value or `null` (unsupported → 422, nothing spent) |
| `submitJob(input, config)` | `input = { personImage, garmentImage, garmentDescription, garmentCategory, webhookUrl }` → `NormalisedJob`. Called once per job. |
| `getJobStatus(providerJobId, config)` | → `NormalisedJob` |
| `cancelJob(providerJobId, config)` | best effort |
| `fetchResult(resultRef, config)` | → image `Buffer`; must only contact the provider's own output host |
| `verifyWebhook({ rawBody, headers, secret })` | boolean, constant-time |
| `parseWebhook(body)` | → `NormalisedJob` or `null` |
| `classifyError(err, phase)` | → a code from `errors.js`; a submit whose outcome is unknown must return `submit_outcome_unknown` |

`NormalisedJob = { providerJobId, status: 'queued'|'processing'|'succeeded'|'failed'|'canceled', resultRef, errorCode }`.
`resultRef` is server-side only; it is never sent to the browser or logged.

Inputs are already validated when they reach the adapter: `personImage` is a
re-encoded JPEG data URI (no EXIF), `garmentImage` is either a re-encoded JPEG
data URI of the catalog file or an allow-listed https URL, both shrunk to the
adapter's `maxInlineImageBytes`.

## 4. Data model — `ai_tryon_jobs`

One row per try-on; **no column can hold image bytes, image URLs or provider
text** (enforced by a DB-backed test).

| Column | Meaning |
|---|---|
| `id` | internal UUID v4 (also the result file name) |
| `userId` | owner; every read is `WHERE id = ? AND userId = ?` |
| `productId`, `vendorId` | the product the SERVER resolved; never changes |
| `provider`, `providerJobId` | adapter id + provider reference (unique together) |
| `idempotencyKey` | unique per user; a repeat returns the same job |
| `status` | `queued → processing → succeeded \| failed \| canceled \| expired`; `succeeded → expired` when the result's retention ends |
| `errorCode` | fixed code from `errors.js` |
| `resultKey` | private file name while a result exists |
| `pollAttempts`, `nextPollAt` | provider-poll throttle (5 s → 30 s backoff) |
| `consentAt` | when the customer confirmed processing |
| `deadlineAt` | job stopped + provider-cancelled after this |
| `expiresAt` | result deleted after this |

The pre-existing `ai_tryon_usage` (per-user daily counter) is reused unchanged.

## 5. Security boundaries

- **Garment**: only `productId` is read from the request. Image, title,
  category, vendor and eligibility come from the product row under the same
  visibility rule as `Product.findById` (approved product AND approved vendor or
  platform product). Unknown/unapproved/suspended answer one identical 404.
- **Remote product images**: only hostnames in `AI_TRYON_ALLOWED_HOSTS`
  (whole names, https, default port, no private/metadata hosts). Unset = none.
- **Provider results**: fetched only from the provider's own output host
  (`replicate.delivery` and subdomains), no redirects, size-capped, then
  decoded + re-encoded before storage.
- **Customer photo**: inline only (a URL is refused), sniffed, pixel-capped,
  decoded and re-encoded; held in memory for one request; never written to
  disk, database or logs.
- **Ownership**: job, status and result are owner-only; other users get 404.
- **Credentials**: backend env only; never in responses, logs or problem
  messages; a test scans `src/` for provider key names and provider API hosts.
- **Webhook**: unauthenticated route, authenticated by HMAC signature over the
  raw body with a timestamp tolerance; unknown jobs acknowledged without
  revealing anything; repeated deliveries are no-ops.

## 6. What changed from the previous implementation

| Before | Now |
|---|---|
| Replicate calls inline in the controller | adapter layer; controller is provider-agnostic |
| In-memory prediction map (lost on restart, single instance) | `ai_tryon_jobs` table + scheduled reconciliation |
| Browser received Replicate's public output URL | private stored copy, owner-only endpoint, blob URL |
| No duplicate-submit protection beyond a disabled button | idempotency key, unique per user |
| No consent step | explicit consent, recorded as `consentAt` |
| Provider polled on every client poll | one claimed poll per window, backoff |
| Enabled by `AI_TRYON_ENABLED` + token | + explicit provider, config validation, production licence gate |
