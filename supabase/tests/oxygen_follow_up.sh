#!/bin/bash
set -euo pipefail
root="$PWD"
test_dir=$(mktemp -d /tmp/oxygen-follow-up.XXXXXX)
cleanup() {
  if [ -f "$test_dir/data/postmaster.pid" ]; then pg_ctl -D "$test_dir/data" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf "$test_dir"
}
trap cleanup EXIT
initdb -D "$test_dir/data" -U postgres --auth=trust --no-locale >/dev/null
pg_ctl -D "$test_dir/data" -o "-k $test_dir -p 55495 -c listen_addresses=''" -w start >"$test_dir/server.log"
export PGHOST="$test_dir" PGPORT=55495 PGUSER=postgres PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/tests/oxygen_follow_up_fixture.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117185900_oxygen_follow_up_order_index.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117190000_oxygen_follow_up.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117190100_oxygen_follow_up_recovery_guards.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117190200_oxygen_follow_up_fair_queue.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/tests/oxygen_follow_up_assertions.sql"
echo 'Oxygen follow-up status, privacy, and merchant scope checks passed'
