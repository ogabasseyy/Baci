#!/usr/bin/env bash
set -euo pipefail
while IFS='=' read -r variable ignored; do case "$variable" in PG*) unset "$variable";; esac; done < <(env)
postgres_bin=/opt/homebrew/opt/postgresql@18/bin
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d /private/tmp/baci-savings-exit-accounting.XXXXXX)"
cleanup() {
  touch "$test_root/release"
  "$postgres_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1 || true
  [[ -z "${first_pid:-}" ]] || wait "$first_pid" 2>/dev/null || true
  [[ -z "${second_pid:-}" ]] || wait "$second_pid" 2>/dev/null || true
  rm -rf "$test_root"
}
trap cleanup EXIT INT TERM
mkdir -m 700 "$test_root/socket"
"$postgres_bin/initdb" -D "$test_root/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55454" -l "$test_root/postgres.log" start >/dev/null
"$postgres_bin/createdb" -h "$test_root/socket" -p 55454 -U harness_admin piggyvest_local
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$test_root/socket" -p 55454 -d piggyvest_local -U harness_admin)
"${psql[@]}" -f "$worktree/tools/test/goal-policy-setup.sql" >/dev/null
"${psql[@]}" -c 'CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;' >/dev/null
awk '/^CREATE TABLE IF NOT EXISTS "public"\."(orders|order_items|transactions)" / { capture=1 }
  capture { print } capture && /;$/ { capture=0 }' "$worktree/supabase/migrations/20260418000000_baseline.sql" > "$test_root/accounting-tables.sql"
"${psql[@]}" -f "$test_root/accounting-tables.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/test/savings-exit-accounting-tables.sql" >/dev/null
for migration in "$worktree"/supabase/migrations/20260912120[0-5]00_*.sql "$worktree"/supabase/migrations/20260912140[0-3]00_*.sql; do
  "${psql[@]}" -f "$migration" >/dev/null
done
"${psql[@]}" -f "$worktree/tools/test/goal-policy-fixture.sql" >/dev/null
for migration in \
  20260912150000_goal_lifecycle_activation.sql \
  20260912150100_goal_lifecycle_duration_consent.sql \
  20260912150200_goal_lifecycle_policy_ceremony.sql \
  20260912160000_cancel_plan_preparation.sql \
  20260912162000_purchase_preparation_tables.sql \
  20260912162100_purchase_preparation_commands.sql \
  20260912090200_piggyvest_staging_wallet_goal_mappings.sql \
  20260926171000_piggyvest_savings_exit_execution.sql \
  20260926171100_piggyvest_savings_exit_authority_storage_guards.sql \
  20260926171101_piggyvest_savings_exit_commands.sql \
  20260926171102_piggyvest_savings_exit_evidence_hardening.sql; do
  "${psql[@]}" -f "$worktree/supabase/migrations/$migration" >/dev/null
done
"${psql[@]}" -f "$worktree/tools/test/purchase-preparation-fixture.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/test/savings-exit-execution-fixture.sql" >/dev/null
for migration in "$worktree"/supabase/migrations/20260926192[0-2]00_savings_exit_*.sql; do
  "${psql[@]}" -f "$migration" >/dev/null
done
"${psql[@]}" -f "$worktree/tools/test/savings-exit-accounting-fixture.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/test/savings-exit-accounting-evidence-setup.sql" >/dev/null
(cd "$worktree/apps/web" && SAVINGS_EXIT_SQL_SOCKET="$test_root/socket" pnpm exec vitest run --environment node src/lib/piggyvest/savings-exit-evidence.sql.test.ts)
"${psql[@]}" -f "$worktree/tools/test/savings-exit-accounting-cases.sql" >/dev/null
"${psql[@]}" >"$test_root/first.log" 2>&1 <<SQL &
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
BEGIN;
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(212,'purchase')->>'state'='accounted','positive accounting');
\! touch '$test_root/locked'
\! for attempt in \$(seq 1 200); do test -f '$test_root/release' && exit 0; sleep 0.05; done; exit 1
COMMIT;
SQL
first_pid=$!
for attempt in {1..100}; do [[ -f "$test_root/locked" ]] && break; sleep 0.05; done
[[ -f "$test_root/locked" ]] || { cat "$test_root/first.log"; exit 1; }
"${psql[@]}" -c "SET SESSION AUTHORIZATION piggyvest_staging_policy_writer; SET application_name='exit_accounting_waiter'; SET statement_timeout='10s'; SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(212,'purchase')->>'state'='accounted','race replay');" >"$test_root/second.log" 2>&1 &
second_pid=$!
for attempt in {1..100}; do
  [[ "$("${psql[@]}" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name='exit_accounting_waiter' AND wait_event_type='Lock'")" = 1 ]] && break
  sleep 0.05
done
[[ "$("${psql[@]}" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name='exit_accounting_waiter' AND wait_event_type='Lock'")" = 1 ]]
touch "$test_root/release"
wait "$first_pid" || { cat "$test_root/first.log"; exit 1; }
wait "$second_pid" || { cat "$test_root/second.log"; exit 1; }
"$postgres_bin/pg_ctl" -D "$test_root/data" -m fast restart >/dev/null
"${psql[@]}" -f "$worktree/tools/test/savings-exit-accounting-restart.sql" >/dev/null
printf 'PASS exit accounting: independent committed evidence, actual order/transaction DDL, ledger/preparation, mismatch, rollback, race, restart, duplicate no-op\n'
