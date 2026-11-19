#!/bin/sh
# Lightweight entrypoint. No local malware engine or signature database.

set -eu

CONF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORK_DIR="${WORK_DIR:-/data/tmp}"

export WORK_DIR

mkdir -p "$WORK_DIR"
chown -R node:node "$WORK_DIR"

exec gosu node:node node "$CONF_DIR/src/server.ts"
