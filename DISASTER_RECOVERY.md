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
BACKUP_ALERT_WEBHOOK="https://..." \  # any JSON POST endpoint — paged on failure
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
- Prunes to `BACKUP_RETENTION` copies (default 35) — DB dumps and uploads
  archives are counted separately; `.sha256` sidecars follow their dump.
- Any non-zero exit pings `BACKUP_ALERT_WEBHOOK` (a plain JSON POST endpoint),
  so a dead nightly surfaces the next morning — not at restore time. A strict
  parse of `backend/.env` runs first, so a botched edit fails loudly with the
  offending line instead of backing up half a config.

Credentials come from `backend/.env` (`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`).

## Off-site rule

Encryption key is meaningless if the ciphertext lives on the same erased disk.
`.deploy/backup-offsite.sh` mirrors the newest `kente-*.sql.gz.aes|.gpg` (plus
its `.sha256` and the matching uploads archive) to `BACKUP_OFFSITE_RSYNC_TARGET`
(e.g. `backup@object-store:/kente-backups/`). Run it right after each backup:

- **systemd:** set `BACKUP_OFFSITE_RSYNC_TARGET` in `/etc/kente/backup.env` —
  `backup.service` runs it from `ExecStartPost` automatically.
- **cron:** chain `.deploy/backup-offsite.sh` after `backup-db.sh`
  (see `.deploy/cron.example`).

It exits non-zero (and pings `BACKUP_ALERT_WEBHOOK`) if the mirror fails, so a
quietly-mirroring-free month is not a discovery you make during an incident.
Local Render `/tmp` and the repo's `backend/uploads` directory are
**ephemeral and not a backup** — uploads live only in these archives.

## Quarterly RESTORE_DRILL

Never restore into the live database. Procedure (automated end-to-end by
`restore-db.sh --drill`; originally proven 2026-09-16 against the live cluster):

1. **Verify + isolated restore:** `.deploy/restore-db.sh --drill
   [<backup-file>] [<drill_dbname>]` verifies the backup, derives the dump's
   real database name from its own `USE` statement (not the filename), refuses
   anything that could collide with the live schema, then restores into
   `<db>_drill` (or `<drill_dbname>`) — non-interactive, live data untouched.
   It prints the drill DB's table count on success.
2. **Schema parity:** `information_schema.TABLES` — drill DB must contain the
   same table set as live.
3. **Data parity:** `count(*)` (or `TABLE_ROWS` for speed) must match live for
   every table. Focus: `orders`, `escrow_allocations`, `wallet_transactions`,
   `financial_events`, `webhook_events`, `payout_attempts`.
4. **Migrations:** run `db:migrate` against the drill DB; must complete idempotently.
5. **Smoke API:** boot the backend pointed at the drill DB; a login + a list
   query must succeed.
6. **Drop** the drill database (`DROP DATABASE \`<drill_dbname>\`;`, or re-run
   the drill with `DRILL_RECREATE=1` to reuse the name next quarter).

Re-run migrations on production after each restore, then repeat steps 1–3 on a
fresh drill DB. The manual sed pipeline this replaced is no longer needed — if
you ever run it by hand, keep the `CREATE DATABASE`/`DROP DATABASE` *and* `USE`
rewrites in sync, or the drill lands on the live schema.

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