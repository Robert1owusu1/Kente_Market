# Disaster Recovery

Backup/restore tooling now ships in this repo (`.deploy/backup-db.sh` and
`.deploy/restore-db.sh`); the RSYNC of encrypted snapshots off-site, scheduled
execution, and quarterly drills are operator work.

## Targets

- **RPO:** 24 hours maximum; recommended 1 hour for orders/payments.
- **RTO:** 4 hours for API/database restoration.

## Daily backup

Run daily (and before every migration, e.g. `npm run db:backup --prefix
backend`), ideally nightly. Scheduling examples ship in
`.deploy/cron.example` and `.deploy/backup.service|backup.timer` (systemd); the
nightly job should log success and alert on the `✗` / non-zero exit lines. Run
directly on a host that already has `backend/.env` (credentials are read from
there) or provide the DB_* + BACKUP_* values via an environment file.

```sh
BACKUP_UPLOADS=1 \
BACKUP_PASSPHRASE="..." \        # or BACKUP_GPG_KEY_ID="..." for GPG
BACKUP_DIR="/mnt/backups/kente"  # anywhere OUTSIDE the repo/render disk
.deploy/backup-db.sh
```

What it does:

- Server-aware `mysqldump`: plain MySQL uses `--single-transaction` (no global
  lock); TiDB drops it because mysqldump emits a SAVEPOINT TiDB rejects, which
  would abort the dump mid-stream. Flags are chosen from `SELECT VERSION()`.
- gzip → GPG (`BACKUP_GPG_KEY_ID`) or AES-256-CBC/openssl (`BACKUP_PASSPHRASE`).
- Writes a plaintext SHA-256 sidecar and an uploads archive when `BACKUP_UPLOADS=1`.
- **Immediately verifies** the ciphertext (decrypt + gunzip to EOF) — a partial
  dump is deleted and the script exits non-zero, so truncation can never be
  mistaken for a good backup.
- Prunes to `BACKUP_RETENTION` copies (default 35).

Credentials come from `backend/.env` (`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`).

## Off-site rule

Encryption key is meaningless if the ciphertext lives on the same erased disk.
Copy new `kente-*.sql.gz.aes|.gpg` files (and `.sha256`) to separate object
storage immediately after each backup. Local Render `/tmp` and the repo's
`backend/uploads` directory are **ephemeral and not a backup** — uploads live
only in these archives.

## Quarterly RESTORE_DRILL

Never restore into the live database. Procedure (proven 2026-09-16 against the
live cluster):

1. **Verify:** `.deploy/restore-db.sh --verify <backup-file>` must print `Verified`.
2. **Isolated restore:** restore into a scratch database on a scratch server
   (or a scratch DB on the same cluster, rewriting the database name): decrypt
   the plaintext, then feed `/tmp/plain.sql` through
   `sed 's/CREATE DATABASE IF NOT EXISTS \`<name>\`/CREATE DATABASE IF NOT EXISTS \`<name>_drill\`/; s/^USE \`<name>\`;/USE \`<name>_drill\`;/'`
   and pipe into `mysql`.
3. **Schema parity:** `information_schema.TABLES` — drill DB must contain the
   same table set as live.
4. **Data parity:** `count(*)` (or `TABLE_ROWS` for speed) must match live for
   every table. Focus: `orders`, `escrow_allocations`, `wallet_transactions`,
   `financial_events`, `webhook_events`, `payout_attempts`.
5. **Migrations:** run `db:migrate` against the drill DB; must complete idempotently.
6. **Smoke API:** boot the backend pointed at the drill DB; a login + a list
   query must succeed.
7. **Drop** the drill database.

Re-run migrations on production after each restore, then repeat steps 2–4 on a
fresh drill DB.

## Payment incident runbook

- Disable new payouts immediately (admin flag; payout endpoints refuse).
- Preserve provider webhooks; disable autoscaler so the single replica holds the
  scheduler lock.
- Reconcile Paystack references against `webhook_events` and `payout_attempts`.
- Resolve discrepancies through the idempotent settlement services; do not
  hand-edit the ledger.
- Resume payouts only after finance approval.

Record DNS, hosting, database, object-storage and Paystack webhook settings in
the organisation password manager, never in this repository.