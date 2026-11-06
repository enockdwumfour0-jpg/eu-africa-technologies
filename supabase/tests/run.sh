#!/usr/bin/env bash
# Usage: supabase/tests/run.sh <socket-dir> <port>
# Rebuilds a scratch database, applies every migration, then runs the RLS tests.
set -euo pipefail
HOST=${1:?socket dir}; PORT=${2:?port}
HERE="$(cd "$(dirname "$0")" && pwd)"
PSQL="psql -h $HOST -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists portal_test" -c "create database portal_test"
export PGDATABASE=portal_test
$PSQL -f "$HERE/00_supabase_stub.sql"
for f in "$HERE"/../migrations/*.sql; do echo "-> $(basename "$f")"; $PSQL -f "$f"; done
for f in "$HERE"/[1-9]*.sql; do [ -e "$f" ] && { echo "== $(basename "$f")"; $PSQL -f "$f"; }; done
echo "ALL OK"
