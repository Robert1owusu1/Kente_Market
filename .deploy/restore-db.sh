#!/usr/bin/env bash
# FILE LOCATION: .deploy/restore-db.sh
# DESCRIPTION: Decrypt + restore a .deploy/backup-db.sh backup, or verify one
#              without touching the database (--verify).
#
#   USAGE:
#     List backups:                                 .deploy/restore-db.sh --list
#     Verify a backup (no DB changes):              .deploy/restore-db.sh --verify [file]
#     Restore a backup into the target server:      .deploy/restore-db.sh [file]
#     DRILL: restore into a scratch DB (live data untouched, non-interactive):
#                                                   .deploy/restore-db.sh --drill [file] [drill_dbname]
#         The dump is verified first, then CREATE DATABASE / USE are rewritten
#         to drill_dbname (default <db>_drill) — derived from the dump's own
#         USE statement, never the filename. Refuses if drill_dbname == the
#         dump's database. If it already exists: drop it or DRILL_RECREATE=1.
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
  # Strict-parse first: a bare `source` under `set -e` dies with a cryptic
  # error (or silently skips unparseable lines like UNQUOTED multi-word
  # values), so a restore could run with half a config. See backup-db.sh.
  if ! env_err="$(bash -e -c '. "$1"' _ "$BACKEND_DIR/.env" 2>&1)"; then
    echo "✗ backend/.env failed a strict bash parse — fix it and re-run." >&2
    echo "  Usual cause: an UNQUOTED multi-word value (quote it, e.g." >&2
    echo "  EMAIL_FROM=\"Bonwire Kente <noreply@yourdomain.me>\"). bash reported:" >&2
    printf '%s\n' "$env_err" | sed 's/^/    /' >&2
    exit 1
  fi
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
DRILL=0
if [ "${1:-}" = "--verify" ]; then VERIFY=1; shift || true; fi
if [ "${1:-}" = "--drill" ]; then DRILL=1; shift || true; fi

FILE="$(pick_file "${1:-}")"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "✗ No backup found ('$FILE'). Try --list." >&2; exit 1
fi
DEC="$(DECRYPT_CMD "$FILE")"

# decrypt + gunzip to EOF; $1=file $2=decrypt-cmd.
# Prints ✅ + byte count (return 0) or ✗ FAILED (return 1). Shared by --verify
# and --drill so both use the exact same gate before anything touches a server.
verify_backup() {
  local file="$1" dec="$2" rc bytes
  set +e
  bytes="$(bash -o pipefail -c "$dec | gunzip -c" < "$file" 2>/dev/null | wc -c)"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" -ne 0 ] || [ "${bytes:-0}" -lt 1000 ]; then
    echo "✗ $file FAILED verification (rc=$rc, $bytes bytes). Do NOT restore." >&2
    return 1
  fi
  echo "✅ Verified — $bytes bytes of plaintext, gzip ran to EOF."
  return 0
}

# -------------------------------------------------------------- verify mode
if [ "$VERIFY" -eq 1 ]; then
  echo "→ Verifying $FILE — decrypt + gunzip must run to EOF."
  verify_backup "$FILE" "$DEC" || exit 1
  echo "No DB changes made."
  exit 0
fi

# --------------------------------------------------------------- drill mode
# Quarterly RESTORE_DRILL (DISASTER_RECOVERY.md), automated: verify, then
# restore into a SCRATCH database — live data is never touched. Non-interactive.
if [ "$DRILL" -eq 1 ]; then
  echo "→ Verifying $FILE before drill restore."
  verify_backup "$FILE" "$DEC" || exit 1

  # The dump's own `USE \`name\`;` is authoritative (the filename could lag a
  # DB rename); rewrite by content and refuse anything ambiguous so the drill
  # can never land on the live schema.
  use_line="$(bash -o pipefail -c "$DEC | gunzip -c" < "$FILE" 2>/dev/null | grep -m1 -E '^USE `[^`]+`;' || true)"
  orig="${use_line#USE \`}"; orig="${orig%\`;}"
  if [ -z "$orig" ]; then
    echo "✗ No USE \`...\`; line found in the dump — drill aborted (nothing restored)." >&2
    exit 1
  fi
  DRILL_DB="${2:-${orig}_drill}"
  case "$DRILL_DB" in
    *[!A-Za-z0-9_]*|'')
      echo "✗ Drill DB name must match [A-Za-z0-9_]+ (got '$DRILL_DB')." >&2; exit 1 ;;
  esac
  if [ "$DRILL_DB" = "$orig" ]; then
    echo "✗ Drill DB '${DRILL_DB}' is the dump's own database — refusing (would overwrite live data)." >&2
    exit 1
  fi
  if mysql "${MYSQL_ARGS[@]}" -N -e "SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${DRILL_DB}'" | grep -q 1; then
    if [ "${DRILL_RECREATE:-0}" = "1" ]; then
      echo "→ DRILL_RECREATE=1 — dropping existing \`${DRILL_DB}\`."
      mysql "${MYSQL_ARGS[@]}" -e "DROP DATABASE \`${DRILL_DB}\`"
    else
      echo "✗ Drill database '${DRILL_DB}' already exists." >&2
      echo "  Drop it (\`DROP DATABASE \\\`${DRILL_DB}\\\`;\`) or re-run with DRILL_RECREATE=1." >&2
      exit 1
    fi
  fi

  echo "→ Restoring into scratch \`${DRILL_DB}\` (live \`${orig}\` untouched)."
  # Rewrite CREATE/DROP/USE to the drill name. DRILL_DB is validated above to
  # [A-Za-z0-9_]+, so it is safe to inline into SQL and sed.
  if ! bash -o pipefail -c "$DEC | gunzip -c" < "$FILE" 2>/dev/null \
    | sed -E \
        -e "s/^(CREATE DATABASE (\/\*![0-9]+ IF NOT EXISTS\*\/ |IF NOT EXISTS )?\`)[^\`]+\`/\1${DRILL_DB}\`/" \
        -e "s/^(DROP DATABASE (IF EXISTS )?\`)[^\`]+\`/\1${DRILL_DB}\`/" \
        -e "s/^USE \`[^\`]+\`;/USE \`${DRILL_DB}\`;/" \
    | mysql "${MYSQL_ARGS[@]}"; then
    echo "✗ Drill restore FAILED into \`${DRILL_DB}\` — drop it, fix, and re-run." >&2
    exit 1
  fi
  TABLES="$(mysql "${MYSQL_ARGS[@]}" -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DRILL_DB}'")"
  echo "✅ Drill restore complete: \`${DRILL_DB}\` contains ${TABLES} tables."
  echo "   Next: RESTORE_DRILL steps 2–6 in DISASTER_RECOVERY.md, then:"
  echo "     DROP DATABASE \`${DRILL_DB}\`;"
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