# AI Virtual Try-On — Provider Setup

Current status: **CODE-COMPLETE, PROVIDER-SETUP-PENDING.**
Not PRODUCTION-READY: see §6 for the blockers.

## 1. Who does what

| | Done in the codebase | Operator must do |
|---|---|---|
| Customer journey, product binding, job tracking, private results, cost controls | ✅ | — |
| Provider-independent adapter layer + a Replicate IDM-VTON adapter | ✅ | — |
| Verify the IDM-VTON input schema against the live model | — | ✅ (§4, step 2) |
| Obtain commercial-use terms for the model, or choose another provider | — | ✅ (§3) |
| Create provider account, API key, (optional) webhook secret | — | ✅ |
| Configure environment variables | — | ✅ (§5) |
| Run the migration on staging, then production | — | ✅ (`npm run db:migrate`) |
| Manual staging tests with a real account | — | ✅ (§7) |
| Privacy policy text covering AI photo processing | — | ✅ (legal) |

## 2. What a provider must support

A provider is usable only if it does **garment-conditioned virtual try-on**:
it takes a person photo AND a reference garment image and renders that
garment on that person. A general text-to-image or image-editing model does
not qualify, whatever its prompt. The registry refuses an adapter whose
`capabilities` lack `personImage` + `referenceGarmentImage`.

Checklist before activating any provider:

- [ ] Person-image input and reference-garment-image input
- [ ] Garment categories that cover Kente wraps/stoles (upper body at minimum)
- [ ] Accepted image formats and size limits (we send JPEG; inline data URI)
- [ ] Async jobs (poll and/or webhook) or documented synchronous behaviour
- [ ] Status vocabulary, error codes, timeouts, cancel
- [ ] How results are retrieved, and who can access result URLs
- [ ] **Commercial use allowed** by the model licence AND the service terms
- [ ] Permitted handling of customer photos; retention and deletion policy
- [ ] Authentication method; exact request and response schema

## 3. The included adapter: `replicate-idm-vton`

IDM-VTON (`cuuupid/idm-vton`) on Replicate — the model the previous
implementation already used.

| Fact | Status | Source |
|---|---|---|
| `POST /v1/predictions`, `GET /v1/predictions/{id}`, `POST /v1/predictions/{id}/cancel` | verified (docs) | replicate.com/docs/reference/http |
| `Authorization: Bearer <token>` | verified (docs) | same |
| Files accepted as data URLs; recommended < 1 MB | verified (docs) | replicate.com/docs/topics/predictions/input-files |
| Statuses `starting, processing, succeeded, failed, canceled, aborted` | verified (docs) | …/predictions/lifecycle |
| `Cancel-After` header; 30-minute provider limit | verified (docs) | reference/http, lifecycle |
| Webhooks: `webhook-id/-timestamp/-signature`, HMAC-SHA256, `whsec_` secret, may be delivered more than once | verified (docs) | …/webhooks/verify-webhook |
| Output files on `replicate.delivery` (+ subdomains), expire after 1 hour | verified (docs) | …/predictions/output-files |
| API prediction inputs, outputs and logs deleted after 1 hour | verified (docs) | …/predictions/data-retention |
| 429 on rate limit | verified (docs) | …/predictions/rate-limits |
| 402 for exhausted credit | **not documented**; handled defensively as quota | — |
| Model inputs `human_img`, `garm_img`, `garment_des`, `category` | **unverified** — carried over from the previous integration | must check (§4) |
| `category` values `upper_body`, `lower_body`, `dresses` | **unverified** (DressCode convention) | must check (§4) |
| Fidelity to Kente weave patterns | **unknown** — needs real tests | §7 |
| Licence | **CC BY-NC-SA 4.0 — non-commercial only** | model page |

Because of the licence, production refuses this adapter unless
`AI_TRYON_PROVIDER_TERMS_ACCEPTED=true`. Set that **only** once you hold terms
that permit commercial use (a commercial licence from the model's authors, or
a different model/provider). Otherwise choose another provider (§8).
No provider switch has been made in code without your approval.

## 4. Activating `replicate-idm-vton` (staging first)

1. Create a Replicate account and an API token (Account → API tokens).
   Set a spending limit on the account.
2. **Verify the model schema** (requires the token; read-only, no charge):
   `GET https://api.replicate.com/v1/models/cuuupid/idm-vton` → read
   `latest_version.openapi_schema.components.schemas.Input`. Confirm the input
   names `human_img`, `garm_img`, `garment_des`, `category` and the `category`
   enum. If they differ, edit only `submitJob` / `capabilities.garmentCategories`
   in `backend/Services/tryOn/providers/replicateIdmVton.js` and its tests.
   Note the version id and set `AI_TRYON_MODEL_VERSION` to pin it.
3. (Optional) Webhooks: `GET https://api.replicate.com/v1/webhooks/default/secret`
   → `{"key":"whsec_..."}`. Set `AI_TRYON_WEBHOOK_SECRET` and
   `AI_TRYON_PUBLIC_API_URL` (the https origin of this API). Without them, jobs
   complete by polling, which is sufficient.
4. Set the variables in §5 on the **backend** host (Render dashboard), never in
   Vercel / `VITE_*`.
5. Run `npm run db:migrate` on that environment's database (adds
   `ai_tryon_jobs`; additive, idempotent).
6. Restart. The log line `AI try-on is enabled but refusing new jobs: …`
   names anything still missing. `GET /api/tryon/status` → `{"enabled":true}`
   when ready.
7. Run the manual tests in §7.

## 5. Environment variables (backend only)

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `AI_TRYON_ENABLED` | yes | `false` | kill switch; only literal `true` enables new jobs |
| `AI_TRYON_PROVIDER` | yes | — | `replicate-idm-vton` (or `mock` for local dev; refused in production) |
| `AI_TRYON_API_KEY` | yes | — | provider key (`REPLICATE_API_TOKEN` still read as fallback) |
| `AI_TRYON_PROVIDER_TERMS_ACCEPTED` | production | `false` | confirms commercial-use terms (§3) |
| `AI_TRYON_MODEL_VERSION` | recommended | adapter's pinned id | model version to run |
| `AI_TRYON_API_BASE_URL` | no | adapter default | https override (e.g. a proxy) |
| `AI_TRYON_WEBHOOK_SECRET` | no | — | provider signing secret |
| `AI_TRYON_PUBLIC_API_URL` | with webhook | — | https origin of this API |
| `AI_TRYON_ALLOWED_HOSTS` | if product images are remote | — | hostnames product images may be fetched from |
| `AI_TRYON_DAILY_LIMIT` | no | `10` | try-ons per user per day |
| `AI_TRYON_MAX_ACTIVE_PER_USER` | no | `2` | simultaneous jobs per user (1–10) |
| `AI_TRYON_MAX_ACTIVE_GLOBAL` | no | `8` | simultaneous jobs in total (1–100) |
| `AI_TRYON_JOB_TIMEOUT_MINUTES` | no | `10` | job deadline (2–30); also sent as `Cancel-After` |
| `AI_TRYON_RESULT_TTL_HOURS` | no | `24` | result image retention (1–168) |
| `AI_TRYON_JOB_RETENTION_DAYS` | no | `30` | photo-free job metadata retention (1–365) |
| `AI_TRYON_RESULT_DIR` | production | `backend/private/tryon-results` | private result directory — use a persistent disk |

Template: `backend/.env.example`. No frontend variable is needed.

## 6. Production blockers (unresolved)

1. **Licence**: IDM-VTON is non-commercial. Commercial terms or another provider are required.
2. **Schema verification**: model input names and categories not yet confirmed against the live schema.
3. **Real-world quality**: whether the model reproduces Kente patterns and colours acceptably is unknown until tested with real products (§7).
4. **Result storage on Render**: the default result directory is the instance's local disk, which is ephemeral and not shared across instances. Attach a persistent disk and point `AI_TRYON_RESULT_DIR` at it, or accept that results are lost on redeploy (customers then see "expired", never a wrong image). Multiple instances would need shared private object storage (not implemented).
5. **Privacy policy**: `/privacy` does not yet describe AI photo processing, the third-party processor, or retention. The consent text links to it.
6. **Staging verification**: §7 has not been run (no account was used; no paid calls were made).

## 7. Manual tests requiring an active provider account (staging)

1. Product with a local image → Try It On → upload → result shows that product's garment; job row has the right `productId`.
2. Repeat with a second, visually different product; confirm no cross-over.
3. Check pattern/colour fidelity on 5+ real Kente products; record results.
4. Double-click Generate → one job, one provider prediction (check Replicate dashboard).
5. Kill switch: set `AI_TRYON_ENABLED=false` mid-job → job still completes; new jobs 503.
6. Restart the API mid-job → job completes via the sweeper.
7. Webhook (if configured): completion arrives; replaying the same delivery changes nothing.
8. Exhaust `AI_TRYON_DAILY_LIMIT` → 429, no prediction created.
9. Second account cannot fetch the first account's `/api/tryon/jobs/:id/result` (404).
10. After `AI_TRYON_RESULT_TTL_HOURS`, the result is gone from disk and reported as expired.
11. Confirm in the Replicate dashboard that API predictions show data removed after ~1 hour.

## 8. Adding another provider

1. Create `backend/Services/tryOn/providers/<id>.js` implementing the contract
   in `AI_TRYON_ARCHITECTURE.md` §3 from the provider's real documentation.
2. Register it in `providers/index.js`.
3. Set `verification` honestly (schema verified? commercial use allowed?).
4. Add mocked tests like `backend/tests/tryOnProviderAdapter.test.js` (request
   shape, status mapping, result host allow-list, webhook verification, error
   classification). No real calls in tests.
5. Nothing else changes: routes, jobs, UI and tests are provider-agnostic.
