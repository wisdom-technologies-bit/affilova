#!/bin/sh
# Container entrypoint for the Affilova scanner service.
#
# 1. make sure the data directories exist and belong to the right users
# 2. start the HTTP server as the unprivileged node user, immediately
# 3. in the background: download the signatures if the database is missing or
#    older than a day, start clamd, wait until it answers PING, then keep
#    freshclam running in daemon mode
#
# The server binds before provisioning starts on purpose. A platform health check
# gives a cold container a few minutes and then kills it; if the port is still
# closed while the database downloads, the download restarts from scratch and the
# deploy can never succeed. Binding first turns that into a 503 that explains
# itself, and the download runs to completion.
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

# 2. provisioning runs in the background, 3. the server starts immediately
provision() {
  # 3. signatures --------------------------------------------------------------
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

  # 4. clamd ------------------------------------------------------------------
  # A socket left behind by an interrupted run would stop clamd from binding.
  rm -f "$SOCKET_DIR/clamd.sock"

  log info entrypoint.clamd.start
  clamd --config-file="$CONF_DIR/clamd.conf" &

  ATTEMPT=0

  until clamdscan --config-file="$CONF_DIR/clamd.conf" --ping 1 >/dev/null 2>&1; do
    ATTEMPT=$((ATTEMPT + 1))

    if [ "$ATTEMPT" -ge 90 ]; then
      # Never exit here. A dead clamd must still leave a reachable service: the
      # server answers /healthz with 503 and a reason, which a platform health
      # check can report, instead of a restart loop that reports nothing.
      log error entrypoint.clamd.unreachable
      break
    fi

    if [ $((ATTEMPT % 15)) -eq 0 ]; then
      log info entrypoint.clamd.waiting
    fi

    sleep 2
  done

  if [ "$ATTEMPT" -lt 90 ]; then
    log info entrypoint.clamd.ready
  fi

  # 5. keep the signatures current --------------------------------------------
  freshclam --daemon --config-file="$CONF_DIR/freshclam.conf" || log warn entrypoint.freshclam.daemon_failed
}

provision &

# 4. the service ------------------------------------------------------------
if command -v gosu >/dev/null 2>&1; then
  exec gosu node:node node "$CONF_DIR/src/server.ts"
fi

exec node "$CONF_DIR/src/server.ts"
