#!/usr/bin/env bash
set -euo pipefail
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD

postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d /tmp/baci-piggyvest-mapping.XXXXXX)"
socket_dir="$temp_dir/socket"
port=55441

cleanup() {
  touch "$temp_dir/release"
  if [[ -f "$temp_dir/data/postmaster.pid" ]]; then
    "$postgres_bin/pg_ctl" -D "$temp_dir/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [[ -n "${first_pid:-}" ]]; then
    wait "$first_pid" 2>/dev/null || true
  fi
  find "$temp_dir" -depth -delete
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -m 700 "$socket_dir"
"$postgres_bin/initdb" -D "$temp_dir/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$temp_dir/data" \
  -o "-k '$socket_dir' -h '' -p $port" -l "$temp_dir/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=terse \
  -h "$socket_dir" -p "$port" -U harness_admin -d postgres)

"${psql[@]}" <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE ROLE mapping_test_reader;
CREATE ROLE mapping_test_untrusted;
CREATE ROLE piggyvest_staging_provisioner LOGIN NOINHERIT;
CREATE ROLE piggyvest_staging_worker LOGIN NOINHERIT;
CREATE TABLE public.merchants (id uuid PRIMARY KEY);
CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id));
CREATE TABLE public.customer_savings_goals (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  status text NOT NULL DEFAULT 'active'
);
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_savings_goals ENABLE ROW LEVEL SECURITY;
SQL

for migration in \
  20260912080000_piggyvest_staging_webhook_inbox.sql \
  20260912080100_restrict_piggyvest_inbox_to_staging_registry.sql
do
  "${psql[@]}" -f "$worktree/supabase/migrations/$migration" >/dev/null
done
if [[ "${1:-}" != "--without-mapping" ]]; then
  "${psql[@]}" -f "$worktree/supabase/migrations/20260912080200_piggyvest_staging_wallet_goal_mappings.sql" >/dev/null
  "${psql[@]}" -f "$worktree/supabase/migrations/20260912080300_piggyvest_staging_wallet_customer_consistency.sql" >/dev/null
  "${psql[@]}" -f "$worktree/supabase/migrations/20260925140000_piggyvest_staging_scoped_wallet_mapping_read.sql" >/dev/null
fi
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_wallet_goal_mappings.sql"
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_wallet_goal_mapping_access.sql"
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_wallet_customer_consistency.sql"
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_scoped_wallet_mapping_read.sql"
"${psql[@]}" <<'SQL'
INSERT INTO public.customers (id, merchant_id) VALUES
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals (id, merchant_id, customer_id) VALUES
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006');
INSERT INTO piggyvest_staging.integrations (id, expected_provider_account_id, enabled)
VALUES ('40000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000004', true);
SQL
"${psql[@]}" >"$temp_dir/first.log" 2>&1 <<SQL &
BEGIN;
INSERT INTO piggyvest_staging.wallet_goal_mappings
  (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
VALUES ('40000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000005',
  '70000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005');
\! touch '$temp_dir/locked'
\! for attempt in \$(seq 1 200); do test -f '$temp_dir/release' && exit 0; sleep 0.05; done; exit 1
\if :SHELL_ERROR
\quit 1
\endif
COMMIT;
SQL
first_pid=$!
for attempt in {1..100}; do
  [[ -f "$temp_dir/locked" ]] && break
  kill -0 "$first_pid" 2>/dev/null || { cat "$temp_dir/first.log"; exit 1; }
  sleep 0.05
done
[[ -f "$temp_dir/locked" ]] || { cat "$temp_dir/first.log"; exit 1; }
"${psql[@]}" -v expect_lock=true -f "$worktree/supabase/migrations/tests/piggyvest_staging_wallet_customer_concurrency.sql"
touch "$temp_dir/release"
wait "$first_pid"
"${psql[@]}" -v expect_lock=false -f "$worktree/supabase/migrations/tests/piggyvest_staging_wallet_customer_concurrency.sql"
printf 'Synthetic private-socket wallet mapping SQL tests passed (including serialized provisioning).\n'
