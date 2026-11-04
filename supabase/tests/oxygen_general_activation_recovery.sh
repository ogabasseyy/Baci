#!/usr/bin/env bash
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/oxygen-activation-recovery-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55485 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55485 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_general_activation_recovery_fixture.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261101190410_oxygen_general_activation.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103141735_oxygen_general_activation_safe_amount.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103193000_oxygen_general_activation_reconcile_recovery.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_general_activation_recovery.sql
