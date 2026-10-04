#!/usr/bin/env bash
set -euo pipefail
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE

postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d /tmp/baci-piggyvest-provisioning.XXXXXX)"
socket_dir="$temp_dir/socket"
port=55442

cleanup() {
  touch "$temp_dir/release"
  if [[ -f "$temp_dir/data/postmaster.pid" ]]; then
    "$postgres_bin/pg_ctl" -D "$temp_dir/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [[ -n "${first_pid:-}" ]]; then wait "$first_pid" 2>/dev/null || true; fi
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
CREATE ROLE provisioning_test_reader;
CREATE TABLE public.merchants (id uuid PRIMARY KEY);
CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id));
CREATE TABLE public.customer_savings_goals (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id)
);
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_savings_goals ENABLE ROW LEVEL SECURITY;
SQL

for migration in \
  20260912090000_piggyvest_staging_webhook_inbox.sql \
  20260912090100_restrict_piggyvest_inbox_to_staging_registry.sql \
  20260912090200_piggyvest_staging_wallet_goal_mappings.sql \
  20260912090300_piggyvest_staging_wallet_customer_consistency.sql \
  20260912100000_piggyvest_staging_provisioning_intents.sql \
  20260912100100_piggyvest_staging_prepare_provisioning_intent.sql \
  20260912100200_piggyvest_staging_claim_provisioning_intent.sql \
  20260912100300_piggyvest_staging_record_provisioning_result.sql \
  20260912100400_piggyvest_staging_provisioning_recovery_references.sql \
  20260912100500_piggyvest_staging_provisioning_dispatch_customer.sql \
  20260912100600_piggyvest_staging_provisioning_account_guards.sql
do
  "${psql[@]}" -f "$worktree/supabase/migrations/$migration" >/dev/null
done
for fixture in setup identity lifecycle bindings results access; do
  "${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_provisioning_$fixture.sql" >/dev/null
  printf 'Provisioning %s fixture passed.\n' "$fixture"
done

"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_provisioning_concurrency_setup.sql" >/dev/null
"${psql[@]}" >"$temp_dir/first.log" 2>&1 <<SQL &
BEGIN;
INSERT INTO provisioning_test.claims (label, intent_id, claim_token)
SELECT 'concurrent', claimed.intent_id, claimed.claim_token FROM piggyvest_staging.claim_provisioning_intent(
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  (SELECT id FROM piggyvest_staging.provisioning_intents WHERE customer_id = '20000000-0000-4000-8000-000000000004'),
  300, 'synthetic-one', NULL) AS claimed;
\! touch '$temp_dir/claimed'
\! for attempt in \$(seq 1 200); do test -f '$temp_dir/release' && exit 0; sleep 0.05; done; exit 1
\if :SHELL_ERROR
\quit 1
\endif
COMMIT;
SQL
first_pid=$!
for attempt in {1..100}; do
  [[ -f "$temp_dir/claimed" ]] && break
  kill -0 "$first_pid" 2>/dev/null || { cat "$temp_dir/first.log"; exit 1; }
  sleep 0.05
done
[[ -f "$temp_dir/claimed" ]] || { cat "$temp_dir/first.log"; exit 1; }
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_provisioning_concurrency.sql" >/dev/null
touch "$temp_dir/release"
wait "$first_pid"
first_pid=''
"$postgres_bin/pg_ctl" -D "$temp_dir/data" -m fast stop >/dev/null
"$postgres_bin/pg_ctl" -D "$temp_dir/data" \
  -o "-k '$socket_dir' -h '' -p $port" -l "$temp_dir/postgres.log" start >/dev/null
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_provisioning_recovery.sql" >/dev/null
printf 'Provisioning two-session first claim and restart recovery fixtures passed.\n'
