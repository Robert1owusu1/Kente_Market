#!/usr/bin/env bash
# FILE LOCATION: .deploy/backup-offsite.sh
# DESCRIPTION: Mirror the NEWEST backup artifacts to separate object storage —
#              encryption is pointless if the ciphertext sits on the same disk
#              that gets erased. Called automatically from backup.service's
#              env-gated ExecStartPost, or from cron right after backup-db.sh
#              (see .deploy/cron.example). Manual run works too.
#
#              Copies: the newest kente-*.sql.gz.aes|.gpg, its .sha256 sidecar,
#              and the matching uploads archive (if any). Local copies are the
#              retention set — this only mirrors; nothing is deleted off-site.
#
#   Env:
#     BACKUP_OFFSITE_RSYNC_TARGET  rsync destination (required), e.g.
#                                  backup@object-store:/kente-backups/
#     BACKUP_DIR                   source directory (default ~/.kente-backups)
#     BACKUP_ALERT_WEBHOOK         optional JSON POST URL pinged on failure
#                                  (same contract as backup-db.sh)
set -euo pipefail

on_failure() {
  local rc=$?
  if [ "$rc" -eq 0 ] || [ -z "${BACKUP_ALERT_WEBHOOK:-}" ]; then return 0; fi
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"🔴 Kente off-site mirror FAILED — host $(hostname) at $(date -u +%FT%TZ), exit ${rc}.\",\"exit_code\":${rc}}" \
      "$BACKUP_ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
  echo "✗ Off-site mirror FAILED (exit ${rc}); alert attempted via BACKUP_ALERT_WEBHOOK." >&2
}
trap on_failure EXIT

: "${BACKUP_DIR:=$HOME/.kente-backups}"
if [ -z "${BACKUP_OFFSITE_RSYNC_TARGET:-}" ]; then
  echo "→ BACKUP_OFFSITE_RSYNC_TARGET unset — nothing to mirror."
  exit 0
fi
command -v rsync >/dev/null 2>&1 || { echo "✗ rsync is not installed." >&2; exit 1; }

shopt -s nullglob
newest="$(ls -1t "$BACKUP_DIR"/kente-*.sql.gz.aes "$BACKUP_DIR"/kente-*.sql.gz.gpg 2>/dev/null | head -n1 || true)"
if [ -z "$newest" ]; then
  echo "✗ No DB backup found in $BACKUP_DIR — run .deploy/backup-db.sh first." >&2
  exit 1
fi
base="${newest%%.sql.gz.*}"            # strip .aes/.gpg + .sql.gz → kente-DB-STAMP
files=( "$newest" "${base}.sha256" )
up=( "$base".uploads.tar.gz.* )         # .aes or .gpg, whichever the run used
files+=( ${up[@]+"${up[@]}"} )
shopt -u nullglob

echo "→ Mirroring ${#files[@]} file(s) of newest backup ($(basename "$newest")) → $BACKUP_OFFSITE_RSYNC_TARGET"
rsync -a -- "${files[@]}" "$BACKUP_OFFSITE_RSYNC_TARGET"
echo "✅ Off-site mirror complete."
