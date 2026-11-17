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
pg_ctl -D "$test_dir/data" -o "-k $test_dir -p 55495 -c listen_addresses='' -c allow_system_table_mods=on" -w start >"$test_dir/server.log"
export PGHOST="$test_dir" PGPORT=55495 PGUSER=postgres PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/tests/oxygen_follow_up_fixture.sql"
# Simulate a concurrent index build that was interrupted before it became valid.
psql -Xq -v ON_ERROR_STOP=1 -c "CREATE INDEX idx_orders_oxygen_follow_up_merchant_created ON public.orders (merchant_id, created_at DESC) WHERE payment_method = 'oxygen'"
psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE pg_catalog.pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_orders_oxygen_follow_up_merchant_created'::regclass"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117185800_oxygen_follow_up_index_retry.sql"
index_oid=$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT 'public.idx_orders_oxygen_follow_up_merchant_created'::regclass::oid")
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117185800_oxygen_follow_up_index_retry.sql"
test "$index_oid" = "$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT 'public.idx_orders_oxygen_follow_up_merchant_created'::regclass::oid")"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117185900_oxygen_follow_up_order_index.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117190000_oxygen_follow_up.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117190100_oxygen_follow_up_recovery_guards.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117190200_oxygen_follow_up_fair_queue.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117190300_oxygen_follow_up_activation_state.sql"
psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/tests/oxygen_follow_up_assertions.sql"
# A conflicting invalid index with the same name must never be dropped blindly.
psql -Xq -v ON_ERROR_STOP=1 -c "DROP INDEX public.idx_orders_oxygen_follow_up_merchant_created; CREATE INDEX idx_orders_oxygen_follow_up_merchant_created ON public.orders (created_at)"
psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE pg_catalog.pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_orders_oxygen_follow_up_merchant_created'::regclass"
index_oid=$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT 'public.idx_orders_oxygen_follow_up_merchant_created'::regclass::oid")
if psql -Xq -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261117185800_oxygen_follow_up_index_retry.sql" >"$test_dir/mismatch.log" 2>&1; then
  echo 'Mismatched invalid index was not rejected' >&2
  exit 1
fi
grep -q 'does not match expected definition' "$test_dir/mismatch.log"
test "$index_oid" = "$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT 'public.idx_orders_oxygen_follow_up_merchant_created'::regclass::oid")"
echo 'Oxygen follow-up status, privacy, and merchant scope checks passed'
