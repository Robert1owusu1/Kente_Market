# Production Hardening Audit

Audit date: 2026-09-16. Scope: React/Vite frontend, Express/MySQL backend,
schema/migrations, payments, deployment, background jobs and CI. This is a
code audit; it does not assert that production secrets, backups, Paystack
dashboard settings, or database migrations have been applied.

| Finding | Severity | Affected files | Recommended fix | Implemented / test |
|---|---|---|---|---|
| Payout could be initiated concurrently before allocation ownership was persisted | CRITICAL | `escrowService.js`, `vendorController.js` | Persist an atomic claim and provider idempotency reference before provider call; settle only from webhook | Implemented: `payout_attempts` outbox + conditional allocation update. Unit/build checks pass; requires migration and integration test against Paystack test mode. |
| Wallet debit could create a success ledger row after a conditional balance update affected zero rows | CRITICAL | `walletService.js` | Transactional conditional debit; check affected rows before ledger write | Implemented. Needs DB concurrency test fixture. |
| Escrow wallet credits and allocation creation relied on application-level checks | CRITICAL | `walletService.js`, `escrowService.js`, migrations | Database unique keys and transactional ledger gate | Implemented: allocation-type and wallet-credit uniqueness. Requires migration. |
| Webhook receipt previously equalled completion, allowing a delayed order to lose a payment event | CRITICAL | `paymentRoutes.js`, migrations | Durable received/processing/processed/failed state and retry/reconciliation | Implemented for `charge.success`; transfer reconciliation remains a required operational job. |
| Transfer reversal does not yet create a complete immutable reversal ledger event | HIGH | `paymentRoutes.js`, wallet schema | Add explicit financial journal entries and reconcile Paystack transfer status periodically | Not implemented; do not enable unrestricted payouts until addressed. |
| `wallet_transactions` is not a full immutable double-entry financial ledger | HIGH | schema, wallet/escrow/payment services | Add append-only financial_events journal with GHS currency, direction, provider references, order/allocation links and audit access | Not implemented; existing ledger is partial. |
| API accepted any `*.vercel.app` origin with credentials | HIGH | `securityMiddleware.js` | Explicit environment allow-list only | Implemented; configure all production/staging origins in `FRONTEND_URL`. |
| User uploads use ephemeral local disk and client MIME/extension checks | HIGH | upload middleware/routes, Render deployment | Object storage adapter plus magic-byte/dimension validation and migration runbook | Not implemented; local disk is unsuitable for durable production uploads. |
| Critical financial schedulers run inside each API process | HIGH | `cleanupJobs.js` | Run one separately locked worker/cron, alert on failures, and implement payout/webhook reconciliation | Not implemented. |
| No demonstrated automated encrypted off-site backups/restore drill | HIGH | deployment docs | Configure daily DB + object backups, retention, encryption and tested restoration | Documented in `DISASTER_RECOVERY.md`; infrastructure remains operator work. |
| Admin role is a single broad role; no financial action audit log | MEDIUM | auth/admin routes/schema | Introduce least-privilege admin roles and append-only audit log | Not implemented. |
| Backend static typecheck has pre-existing failures; test suite lacks DB concurrency/authorization integration coverage | MEDIUM | backend tests/tsconfig | Add isolated MySQL CI service and authorization/concurrency test cases; resolve type errors | Not implemented. Existing pure unit tests pass. |
| Frontend production bundle has a large initial JS chunk | LOW | Vite frontend | Measure on Ghanaian networks and split only measured hot paths | Not implemented. |

## Release gates

1. Run `npm run db:migrate --prefix backend` in a tested staging database and
   verify the new constraints before deploying the backend.
2. Set explicit `FRONTEND_URL`, `TRUST_PROXY`, production cookie secrets and
   Paystack live webhook endpoint. Do not allow preview domains in production.
3. Keep real-money payouts disabled until the high-severity ledger, reversal,
   reconciliation, object-storage, backup and integration-test items are closed.

