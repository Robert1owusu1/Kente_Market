# Disaster Recovery

This repository does not provision backups. The operator must configure and
test the following before production financial traffic.

- **RPO:** 24 hours maximum; recommended 1 hour for orders/payments.
- **RTO:** 4 hours for API/database restoration.
- Take encrypted MySQL logical backups daily (and before every migration),
  retain 35 daily / 12 monthly copies in separate object storage, and restrict
  restore credentials to operators.
- Back up user uploads independently; local Render filesystem is ephemeral and
  is not a backup.
- Quarterly, restore a backup into an isolated database, run migrations, and
  verify order, escrow, wallet and webhook record counts.
- During a payment incident, disable new payouts, preserve provider webhooks,
  reconcile Paystack references against `webhook_events` and `payout_attempts`,
  then resume only after finance approval.
- Record DNS, hosting, database, object-storage and Paystack webhook settings
  in the organisation password manager, never in this repository.
