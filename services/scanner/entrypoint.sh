#!/bin/sh
# Container entrypoint for the Affilova scanner service.
#
# 1. make sure the data directories exist and belong to the right users
# 2. download the signatures if the database is missing or older than a day
# 3. start clamd in the background and wait until it answers PING
# 4. start freshclam in daemon mode so signatures stay current
# 5. run the HTTP server as the unprivileged node user
#
# Every line written here is a JSON object so the platform log stays parseable.

set -eu

CONF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DB_DIR=/data/clamav
WORK_DIR="${WORK_DIR:-/data/tmp}"
SOCKET_DIR=/run/clamav
export WORK_DIR

log() {
  printf '{"level":"%s","event":"%s"}\n' "$1" "$2"
}

# Resolve the ClamAV binaries explicitly. Debian installs clamd in /usr/sbin,
# which is not on every PATH, and "command not found" inside the wait loop below
# would otherwise cost three silent minutes before failing.
for candidate in clamd clamdscan freshclam; do
  if ! command -v "$candidate" >/dev/null 2>&1; then
    log fatal "entrypoint.missing_tool.$candidate"
    exit 1
  fi
done

mkdir -p "$DB_DIR" "$WORK_DIR" "$SOCKET_DIR"

if id clamav >/dev/null 2>&1; then
  chown -R clamav:clamav "$DB_DIR" "$SOCKET_DIR"
fi

if id node >/dev/null 2>&1; then
  chown -R node:node "$WORK_DIR"
fi

# 2. signatures --------------------------------------------------------------
NEEDS_SIGNATURES=0

if [ ! -e "$DB_DIR/daily.cvd" ] && [ ! -e "$DB_DIR/daily.cld" ]; then
  NEEDS_SIGNATURES=1
elif [ -n "$(find "$DB_DIR" -maxdepth 1 -name 'daily.c*' -mtime +1 -print -quit 2>/dev/null)" ]; then
  NEEDS_SIGNATURES=1
fi

if [ "$NEEDS_SIGNATURES" = "1" ]; then
  log info entrypoint.freshclam.initial
  freshclam --config-file="$CONF_DIR/freshclam.conf" --stdout || log warn entrypoint.freshclam.initial_failed
fi

# 3. clamd ------------------------------------------------------------------
# A socket left behind by an interrupted run would stop clamd from binding.
rm -f "$SOCKET_DIR/clamd.sock"

log info entrypoint.clamd.start
clamd --config-file="$CONF_DIR/clamd.conf" &

ATTEMPT=0

until clamdscan --config-file="$CONF_DIR/clamd.conf" --ping 1 >/dev/null 2>&1; do
  ATTEMPT=$((ATTEMPT + 1))

  if [ "$ATTEMPT" -ge 90 ]; then
    log error entrypoint.clamd.unreachable
    exit 1
  fi

  sleep 2
done

log info entrypoint.clamd.ready

# 4. keep the signatures current --------------------------------------------
freshclam --daemon --config-file="$CONF_DIR/freshclam.conf" || log warn entrypoint.freshclam.daemon_failed

# 5. the service ------------------------------------------------------------
if command -v gosu >/dev/null 2>&1; then
  exec gosu node:node node "$CONF_DIR/src/server.ts"
fi

exec node "$CONF_DIR/src/server.ts"
