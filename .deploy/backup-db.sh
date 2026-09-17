#!/usr/bin/env bash
# FILE LOCATION: .deploy/backup-db.sh
# DESCRIPTION: Encrypted logical MySQL/TiDB backup + optional uploads archive.
#
#   - Server-aware: plain MySQL keeps --single-transaction (no global lock).
#     TiDB (SELECT VERSION() contains "TiDB") drops it, because mysqldump's
#     --single-transaction emits a SAVEPOINT that TiDB rejects, aborting the
#     dump mid-stream.
#   - gzip -> GPG (BACKUP_GPG_KEY_ID) or AES-256-CBC via openssl
#     (BACKUP_PASSPHRASE). A plaintext SHA-256 checksum is stored alongside.
#   - Every backup is integrity-checked immediately: decrypt + gunzip must run
#     to EOF. A partial dump is therefore never left undiscovered — a failed
#     check deletes the file and exits non-zero.
#   - Output lives in BACKUP_DIR (default ~/.kente-backups — OUTSIDE this repo).
#   - Retention: BACKUP_RETENTION copies kept (default 35).
#
#   USAGE (from repo root):
#     DB only:                     .deploy/backup-db.sh
#     DB + uploads archive:        BACKUP_UPLOADS=1 .deploy/backup-db.sh
#     List backups:                .deploy/backup-db.sh --list
#
#   Requires mysqldump + gpg or openssl. Restore: .deploy/restore-db.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
BACKUP_DIR="${BACKUP_DIR:-$HOME/.kente-backups}"
RETENTION="${BACKUP_RETENTION:-35}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# -------------------------------------------------------------- load config
DB_HOST="${DB_HOST:-}"; DB_PORT="${DB_PORT:-3306}"; DB_USER="${DB_USER:-}";
DB_PASSWORD="${DB_PASSWORD:-}"; DB_NAME="${DB_NAME:-}"
if [ -z "$DB_HOST" ] && [ -f "$BACKEND_DIR/.env" ]; then
  set -a; . "$BACKEND_DIR/.env"; set +a
fi
: "${DB_HOST:?set DB_HOST (or backend/.env)}"
: "${DB_NAME:?set DB_NAME (or backend/.env)}"
export MYSQL_PWD="${DB_PASSWORD:-}"
MYSQL_ARGS=(-h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER")

# ------------------------------------------------------------- cryptography
ENCRYPT_CMD() {
  if [ -n "${BACKUP_GPG_KEY_ID:-}" ]; then
    echo "gpg --batch --yes --trust-model always -r '${BACKUP_GPG_KEY_ID}' --encrypt"
  else
    : "${BACKUP_PASSPHRASE:?set BACKUP_GPG_KEY_ID or BACKUP_PASSPHRASE}"
    echo "openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE"
  fi
}
DECRYPT_CMD() { # $1 = ciphertext path; extension selects the cipher
  case "$1" in
    *.gpg) echo "gpg --batch --decrypt" ;;
    *.aes) : "${BACKUP_PASSPHRASE:?openssl backup: set BACKUP_PASSPHRASE}"
           echo "openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE" ;;
    *) echo "unknown backup extension ${1##*.}" >&2; exit 1 ;;
  esac
}

# decrypt+gunzip a backup to EOF; prints byte count or exits non-zero.
verify_plaintext() {
  local f="$1" dec rc bytes
  dec="$(DECRYPT_CMD "$f")"
  set +e
  bytes="$(bash -o pipefail -c "$dec | gunzip -c" < "$f" 2>/dev/null | wc -c)"
  rc=${PIPESTATUS[0]}
  set -e
  [ "$rc" -eq 0 ] || { echo "✗ Integrity check FAILED on $f" >&2; return "$rc"; }
  printf '%s' "$bytes"
}

# sha256 of the full decrypted plaintext; prints the hex digest or exits non-zero.
plaintext_sha() {
  local f="$1" dec
  dec="$(DECRYPT_CMD "$f")"
  bash -o pipefail -c "$dec | gunzip -c" < "$f" 2>/dev/null | sha256sum | awk '{print $1}'
}

# ----------------------------------------------------- server-type detection
SERVER_VER="$(mysql "${MYSQL_ARGS[@]}" -N -e 'SELECT VERSION()' 2>/dev/null | head -n1 || true)"
DUMP_ARGS=(--databases "$DB_NAME")
if [[ "$SERVER_VER" == *TiDB* ]]; then
  echo "→ TiDB server detected (${SERVER_VER:0:40}) — non-SAVEPOINT dump."
  DUMP_ARGS+=(--no-tablespaces --skip-add-locks --skip-lock-tables)
else
  echo "→ MySQL server detected (${SERVER_VER:-unknown}) — consistent dump."
  DUMP_ARGS+=(--single-transaction)
fi

# ----------------------------------------------------------------- list mode
if [ "${1:-}" = "--list" ]; then
  echo "=== Backups in $BACKUP_DIR (retention: $RETENTION) ==="
  ls -1t "$BACKUP_DIR"/kente-* 2>/dev/null | sed 's/^/  /'
  exit 0
fi

# ---------------------------------------------------------------- do the dump
mkdir -p "$BACKUP_DIR"
ENC="$(ENCRYPT_CMD)"
BASE="$BACKUP_DIR/kente-${DB_NAME}-${STAMP}"
if [ -n "${BACKUP_GPG_KEY_ID:-}" ]; then ENC_OUT="${BASE}.sql.gz.gpg"
else ENC_OUT="${BASE}.sql.gz.aes"; fi

echo "→ Dumping '$DB_NAME' → $(basename "$ENC_OUT")"
set +e
mysqldump "${MYSQL_ARGS[@]}" "${DUMP_ARGS[@]}" 2>"$BACKUP_DIR/.dump.err.$$" \
  | gzip -9 \
  | bash -o pipefail -c "$ENC" > "$ENC_OUT"
DUMP_RC=${PIPESTATUS[0]}
set -e
if [ "$DUMP_RC" -ne 0 ]; then
  echo "✗ mysqldump failed (rc=$DUMP_RC). stderr tail:" >&2
  tail -n 5 "$BACKUP_DIR/.dump.err.$$" >&2
  rm -f "$ENC_OUT" "$BACKUP_DIR/.dump.err.$$"; exit 1
fi
rm -f "$BACKUP_DIR/.dump.err.$$"

# ------------------------------------------------------ immediate verification
set +e
PLAIN_BYTES="$(verify_plaintext "$ENC_OUT")"
VR=$?
set -e
if [ "$VR" -ne 0 ] || [ "${PLAIN_BYTES:-0}" -lt 1000 ]; then
  echo "✗ Backup failed verification ($( [ "$VR" -ne 0 ] && echo "integrity error" || echo "only $PLAIN_BYTES bytes" )) — deleting." >&2
  rm -f "$ENC_OUT"; exit 1
fi
echo "   Verified: $PLAIN_BYTES bytes of plaintext (gunzip ran to EOF)."
PLAIN_SHA="$(plaintext_sha "$ENC_OUT")"
printf '%s  %s\n' "$PLAIN_SHA" "$(basename "$ENC_OUT")" > "$BASE.sha256"

# ---------------------------------------------------- optional uploads archive
if [ "${BACKUP_UPLOADS:-0}" = "1" ] && [ -d "$BACKEND_DIR/uploads" ] && [ -n "$(ls -A "$BACKEND_DIR/uploads" 2>/dev/null)" ]; then
  echo "→ Archiving uploads"
  UP="${BASE}.uploads.tar.gz.aes"; [ -n "${BACKUP_GPG_KEY_ID:-}" ] && UP="${BASE}.uploads.tar.gz.gpg"
  set +e
  tar -C "$BACKEND_DIR" -czf - uploads | bash -o pipefail -c "$ENC" > "$UP"
  TAR_RC=${PIPESTATUS[0]}
  set -e
  if [ "$TAR_RC" -ne 0 ] || [ -z "$(verify_plaintext "$UP")" ]; then
    echo "✗ Uploads archive failed verification — deleting." >&2; rm -f "$UP"; exit 1
  fi
  echo "   Verified uploads archive."
fi

# ------------------------------------------------------------- retention prune
COUNT="$(ls -1 "$BACKUP_DIR"/kente-* 2>/dev/null | wc -l)"
if [ "$COUNT" -gt "$RETENTION" ]; then
  ls -1t "$BACKUP_DIR"/kente-* 2>/dev/null | tail -n +"$((RETENTION + 1))" \
    | while IFS= read -r f; do rm -f -- "$f"; done
  echo "   Pruned to last $RETENTION copies."
fi

echo "✅ Backup complete: $(wc -c < "$ENC_OUT") bytes encrypted; checksum in $(basename "$BASE.sha256")."
echo "   Restore/verify: .deploy/restore-db.sh --list | --verify <file> | [<file>]"