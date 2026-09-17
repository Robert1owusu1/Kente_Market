#!/usr/bin/env bash
# FILE LOCATION: .deploy/restore-db.sh
# DESCRIPTION: Decrypt + restore a .deploy/backup-db.sh backup, or verify one
#              without touching the database (--verify).
#
#   USAGE:
#     List backups:                                 .deploy/restore-db.sh --list
#     Verify a backup (no DB changes):              .deploy/restore-db.sh --verify [file]
#     Restore a backup into the target server:      .deploy/restore-db.sh [file]
#
#   The dump was written with mysqldump --databases, so it recreates the schema
#   itself. Restore REFUSES without confirming "RESTORE" (or RESTORE_FORCE=1).
#   Run a quarterly drill per RESTORE_DRILL in DISASTER_RECOVERY.md — never
#   against the live database.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
BACKUP_DIR="${BACKUP_DIR:-$HOME/.kente-backups}"

# -------------------------------------------------------------- load config
DB_HOST="${DB_HOST:-}"; DB_PORT="${DB_PORT:-3306}"; DB_USER="${DB_USER:-}";
DB_PASSWORD="${DB_PASSWORD:-}"
if [ -z "$DB_HOST" ] && [ -f "$BACKEND_DIR/.env" ]; then
  set -a; . "$BACKEND_DIR/.env"; set +a
fi
: "${DB_HOST:?set DB_HOST (or backend/.env)}"
export MYSQL_PWD="${DB_PASSWORD:-}"
MYSQL_ARGS=(-h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER")

# ------------------------------------------------------------- cryptography
DECRYPT_CMD() { # $1 = ciphertext path; extension selects the cipher
  case "$1" in
    *.gpg) echo "gpg --batch --decrypt" ;;
    *.aes) : "${BACKUP_PASSPHRASE:?openssl backup: set BACKUP_PASSPHRASE}"
           echo "openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE" ;;
    *) echo "unknown backup extension ${1##*.}" >&2; exit 1 ;;
  esac
}

pick_file() {
  if [ -n "${1:-}" ]; then echo "$1"; return; fi
  ls -1t "$BACKUP_DIR"/kente-* 2>/dev/null | grep -E '\.sql\.gz\.(aes|gpg)$' | head -n1
}

case "${1:-}" in
  --list)
    echo "=== Backups in $BACKUP_DIR ==="
    ls -1t "$BACKUP_DIR"/kente-* 2>/dev/null | sed 's/^/  /'
    exit 0
    ;;
esac

VERIFY=0
if [ "${1:-}" = "--verify" ]; then VERIFY=1; shift || true; fi

FILE="$(pick_file "${1:-}")"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "✗ No backup found ('$FILE'). Try --list." >&2; exit 1
fi
DEC="$(DECRYPT_CMD "$FILE")"

# -------------------------------------------------------------- verify mode
if [ "$VERIFY" -eq 1 ]; then
  echo "→ Verifying $FILE — decrypt + gunzip must run to EOF."
  set +e
  BYTES="$(bash -o pipefail -c "$DEC | gunzip -c" < "$FILE" 2>/dev/null | wc -c)"
  RC=${PIPESTATUS[0]}
  set -e
  if [ "$RC" -ne 0 ] || [ "${BYTES:-0}" -lt 1000 ]; then
    echo "✗ $FILE FAILED verification (rc=$RC, $BYTES bytes). Do NOT restore." >&2; exit 1
  fi
  echo "✅ Verified — $BYTES bytes of plaintext, gzip ran to EOF. No DB changes made."
  exit 0
fi

# ------------------------------------------------------------ restore mode
echo "WARNING: restoring $FILE into $DB_HOST overwrites that server's schema and data."
if [ -z "${RESTORE_FORCE:-}" ]; then
  read -r -p 'Type RESTORE to continue: ' ANSWER
  [ "$ANSWER" = "RESTORE" ] || { echo "✗ Aborted." >&2; exit 1; }
fi

echo "→ Restoring..."
if ! bash -o pipefail -c "$DEC | gunzip -c" < "$FILE" 2>/dev/null | mysql "${MYSQL_ARGS[@]}"; then
  echo "✗ Restore FAILED. The target DB may be partially restored — treat as unhealthy and re-run from a clean/verified backup." >&2
  exit 1
fi
echo "✅ Restore complete. Run the RESTORE_DRILL checks in DISASTER_RECOVERY.md, then re-run migrations if any post-date this backup."