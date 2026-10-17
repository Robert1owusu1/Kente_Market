# AI Virtual Try-On — Operations

## 1. Kill switch

`AI_TRYON_ENABLED=false` (or unset) stops **new** jobs immediately (HTTP 503,
nothing spent, product pages hide the button). Jobs already running still
finish, and finished results stay viewable until they expire. A config change
needs a restart on Render (env vars are read per request, but the host
restarts on env edits anyway).

## 2. Job lifecycle

```
queued ──submit ok──▶ processing ──provider succeeded + result stored──▶ succeeded ──TTL──▶ expired(result_expired)
  │                      │ provider failed/canceled ──▶ failed / canceled
  │                      │ deadline passed ──▶ expired(job_timeout) + provider cancel (best effort)
  │ submit error ──▶ failed(<code>)          (never resubmitted)
  │ process died before submit returned ──▶ failed(interrupted)   (after 2 min, by the sweeper)
```

All transitions are compare-and-set, so the customer's polling, the scheduler
and provider webhooks can race safely: the first legal transition wins, the
rest are no-ops.

## 3. Scheduler: `sweepTryOnJobs` (every 2 minutes, one replica via the existing lock)

Per run (bounded at 25 jobs per step):

1. reconcile `processing` jobs whose poll is due (covers missing webhooks and server restarts);
2. expire jobs past `deadlineAt` and ask the provider to cancel them;
3. fail `queued` jobs with no provider id older than 2 minutes (`interrupted`);
4. delete result files past `expiresAt`, mark the job `expired`;
5. delete orphaned result files (no live job) older than 2 minutes, and `.tmp` files older than 10 minutes;
6. purge ended job rows older than `AI_TRYON_JOB_RETENTION_DAYS`.

Status and failures are visible like every other job: `/api/admin/ops/scheduler-jobs`
(`scheduler_job_status`), with the existing daily admin failure email.

## 4. Error codes (stored in `ai_tryon_jobs.errorCode`, shown as fixed messages)

| Code | HTTP | Meaning | Operator action |
|---|---|---|---|
| `not_enabled` | 503 | kill switch off | — |
| `provider_not_configured` | 503 | missing/invalid config | read startup log line |
| `provider_auth` | 503 | key rejected (401/403) | rotate/check `AI_TRYON_API_KEY` |
| `provider_quota` | 429 | out of credit (402, if ever returned) | top up / raise spending limit |
| `provider_rate_limited` | 429 | provider 429 | lower caps or ask provider for higher limits |
| `provider_unavailable` | 503 | provider 5xx / unreachable | provider status page |
| `provider_rejected_input` | 422 | provider refused the input | check photo/garment format; schema drift? |
| `submit_outcome_unknown` | 502 | timeout/reset during submit — a paid run may exist | check provider dashboard; never auto-retried |
| `generation_failed` | 502 | model run failed | — |
| `canceled` | 502 | cancelled at provider | — |
| `job_timeout` | 504 | exceeded `AI_TRYON_JOB_TIMEOUT_MINUTES` | provider slow? |
| `interrupted` | 502 | API restarted mid-submit | — |
| `result_unavailable` | 502 | output missing / not an image / download refused | provider output host changed? |
| `result_expired` | 410 | retention passed or result file lost | expected; persistent disk if frequent |

Customers see the fixed message only; provider text is never stored, logged or shown.

## 5. Cost controls

| Control | Where |
|---|---|
| Authentication required for every job route | `protect` |
| Per-user request rate limit (10 / 15 min) + general API limiter | `tryOnGenerateLimiter`, `apiLimiter` |
| Per-user daily try-ons (`AI_TRYON_DAILY_LIMIT`, default 10) | `ai_tryon_usage` |
| Simultaneous jobs per user / global (2 / 8) | `ai_tryon_jobs` count |
| Duplicate submissions → same job | idempotency key, unique index |
| Everything validated before any reservation or spend | `createTryOnJob` ordering (tested) |
| Max photo size: 1 MB request body; decoded pixel cap 40 MP; re-encoded ≤ 2048 px, shrunk to the provider's inline limit | body parser, `tryOnImage.js`, `fitInline` |
| Max job duration (`AI_TRYON_JOB_TIMEOUT_MINUTES`) + provider-side `Cancel-After` | job service, adapter |
| Submit is called once and **never retried** | job service (tested) |
| Status polling throttled (one claimed poll per 5–30 s) | `claimPoll` |
| Provider spending limit | **set in the provider account** (operator) |

Credits are not refunded on failure: a failed or timed-out request may still
have been billed by the provider. Rate-limiting and capacity refusals happen
before the credit is taken.

## 6. Data retention and temporary files

| Data | Where | Retention |
|---|---|---|
| Customer photo | request memory only; sent to provider | not stored by Kente Market; Replicate API deletes inputs after 1 hour (their docs) |
| Garment image | read from catalog storage per request | not copied |
| Result image | `AI_TRYON_RESULT_DIR/<jobId>.jpg`, mode 0600, not web-served | `AI_TRYON_RESULT_TTL_HOURS` (24 h), then deleted by the sweeper |
| Result temp file | `<jobId>.jpg.<pid>.<ts>.tmp` during the atomic write | removed on write failure; stale ones removed after 10 min |
| Provider copy of the result | `replicate.delivery` URL (server-side only) | 1 hour (provider) |
| Job metadata (no images, no URLs) | `ai_tryon_jobs` | `AI_TRYON_JOB_RETENTION_DAYS` (30 d) after the job ends |
| Daily usage counter | `ai_tryon_usage` | unchanged (pre-existing) |
| Logs | stdout JSON events `scope: "ai-tryon"` | ids, product id, codes, HTTP status only — never images, URLs, keys or provider text |

No temporary files exist for customer photos.

## 7. Monitoring

Log events (JSON, `scope: "ai-tryon"`): `submitted`, `succeeded`, `failed`,
`submit_failed`, `status_failed`, `result_failed`, `timed_out`, `cancel_failed`,
`interrupted`, `webhook_rejected`. Suggested alerts:

- rate of `submit_failed` with `provider_auth` / `provider_quota` > 0;
- `submit_outcome_unknown` > 0 (possible unbilled-to-us charge, check the dashboard);
- `webhook_rejected` spikes (wrong secret, or someone probing the endpoint);
- `sweepTryOnJobs` failing in `scheduler_job_status`.

Useful SQL:

```sql
SELECT status, errorCode, COUNT(*) FROM ai_tryon_jobs
 WHERE createdAt > NOW() - INTERVAL 1 DAY GROUP BY status, errorCode;
SELECT COUNT(*) FROM ai_tryon_jobs WHERE status IN ('queued','processing');
```

## 8. Runbook

- **Provider down / quota exhausted**: customers get a clear 429/503; set
  `AI_TRYON_ENABLED=false` if it persists to hide the button.
- **Key leaked**: rotate at the provider, update `AI_TRYON_API_KEY`, restart.
  Running jobs fail with `provider_auth` and time out cleanly.
- **Jobs stuck in processing**: they stop at `deadlineAt` automatically; check
  that `sweepTryOnJobs` is running.
- **Results reported expired early**: the instance's disk was replaced
  (redeploy/scale). Attach a persistent disk for `AI_TRYON_RESULT_DIR`.
- **Webhook rejected**: re-fetch the secret (`GET /v1/webhooks/default/secret`)
  and check server clock skew (5-minute tolerance).

## 9. Known operational limits

- Result images live on one instance's local disk (see setup §6.4).
- Rate limits are per instance unless `REDIS_URL` is set (platform-wide note).
- The daily limit is per user; there is no platform-wide daily spend cap in
  code — set the provider account's spending limit.
