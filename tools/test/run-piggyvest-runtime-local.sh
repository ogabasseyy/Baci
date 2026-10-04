#!/usr/bin/env bash
set -euo pipefail
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d /tmp/baci-piggyvest-runtime.XXXXXX)"
socket_dir="$temp_dir/socket"
cleanup() {
  if [[ -f "$temp_dir/data/postmaster.pid" ]]; then
    if ! "$postgres_bin/pg_ctl" -D "$temp_dir/data" -m immediate stop >/dev/null 2>&1; then
      printf 'Local test database could not stop; temporary directory retained.\n' >&2
      return
    fi
  fi
  find "$temp_dir" -depth -delete
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 "$socket_dir"
"$postgres_bin/initdb" -D "$temp_dir/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$temp_dir/data" -o "-k '$socket_dir' -h '' -p 55443" -l "$temp_dir/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=terse -h "$socket_dir" -p 55443 -U harness_admin)
"${psql[@]}" -d postgres -c 'CREATE DATABASE piggyvest_local' >/dev/null
psql+=(-d piggyvest_local)
"${psql[@]}" <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE ROLE piggyvest_staging_intake LOGIN NOINHERIT;
CREATE ROLE piggyvest_staging_worker LOGIN NOINHERIT;
CREATE ROLE piggyvest_staging_provisioner LOGIN NOINHERIT;
CREATE ROLE piggyvest_staging_ledger_worker LOGIN NOINHERIT;
CREATE TABLE public.merchants (id uuid PRIMARY KEY);
CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id));
CREATE TABLE public.customer_savings_goals (id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id), customer_id uuid NOT NULL REFERENCES public.customers(id));
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
  20260912100600_piggyvest_staging_provisioning_account_guards.sql \
  20260912110000_piggyvest_provisioning_recovery_read.sql \
  20260912110100_piggyvest_provisioning_recovery_observations.sql \
  20260912110200_piggyvest_provisioning_recovery_verification.sql \
  20260912110300_piggyvest_provisioning_recovery_confirmation.sql \
  20260912110400_piggyvest_created_customer_provenance.sql \
  20260912110500_piggyvest_provenance_verification.sql \
  20260912110600_piggyvest_provenance_confirmation.sql \
  20260926120000_piggyvest_staging_customer_mapping_read.sql \
  20260912120000_piggyvest_savings_ledger_tables.sql \
  20260912120100_piggyvest_savings_ledger_guards.sql \
  20260912120200_piggyvest_savings_ledger_apply.sql \
  20260912120300_piggyvest_savings_ledger_snapshot.sql \
  20260912120400_piggyvest_savings_ledger_registry_gate.sql \
  20260912120500_piggyvest_savings_ledger_numeric_reference_casts.sql
do
  "${psql[@]}" -f "$worktree/supabase/migrations/$migration" >/dev/null
done
"${psql[@]}" -f "$worktree/tools/test/piggyvest-runtime-fixture.sql" >/dev/null
cd "$worktree"
PIGGYVEST_RUN_LOCAL_POSTGRES=1 PIGGYVEST_LOCAL_TEST_SOCKET="$socket_dir" \
  pnpm --filter @baci/web exec vitest run src/lib/piggyvest/postgres-executor.integration.test.ts src/lib/piggyvest/provisioning-runtime.integration.test.ts src/lib/piggyvest/provisioning-naming.integration.test.ts src/lib/piggyvest/savings-ledger-runtime.integration.test.ts --maxWorkers=1
