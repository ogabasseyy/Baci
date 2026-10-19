#!/usr/bin/env bash
set -euo pipefail
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d /tmp/baci-piggyvest-ledger.XXXXXX)"
socket_dir="$temp_dir/socket"
cleanup() {
  if [[ -f "$temp_dir/data/postmaster.pid" ]]; then
    "$postgres_bin/pg_ctl" -D "$temp_dir/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$temp_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 "$socket_dir"
"$postgres_bin/initdb" -D "$temp_dir/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$temp_dir/data" -o "-k '$socket_dir' -h '' -p 55449" -l "$temp_dir/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$socket_dir" -p 55449 -U harness_admin -d postgres)
"${psql[@]}" -f "$worktree/tools/test/piggyvest-savings-ledger-setup.sql" >/dev/null
for migration in "$worktree"/supabase/migrations/20260912120[0-5]00_*.sql; do
  [[ -f "$migration" ]] || continue
  "${psql[@]}" -f "$migration" >/dev/null
done
"${psql[@]}" -f "$worktree/tools/test/piggyvest-savings-ledger-acceptance.sql"
"$postgres_bin/pg_ctl" -D "$temp_dir/data" -m fast stop >/dev/null
"$postgres_bin/pg_ctl" -D "$temp_dir/data" -o "-k '$socket_dir' -h '' -p 55449" -l "$temp_dir/postgres.log" start >/dev/null
"${psql[@]}" -c "SELECT ledger_test.assert_restart();"
"${psql[@]}" -f "$worktree/tools/test/piggyvest-savings-ledger-guards.sql" >/dev/null
run_race() {
  local label="$1" first_sql="$2" second_sql="$3"
  rm -f "$temp_dir/locked" "$temp_dir/release"
  "${psql[@]}" >"$temp_dir/first.log" 2>&1 <<SQL &
BEGIN;
$first_sql
\! touch '$temp_dir/locked'
\! for attempt in \$(seq 1 200); do test -f '$temp_dir/release' && exit 0; sleep 0.05; done; exit 1
\if :SHELL_ERROR
\quit 1
\endif
COMMIT;
SQL
  local first_pid=$!
  for attempt in {1..100}; do
    [[ -f "$temp_dir/locked" ]] && break
    kill -0 "$first_pid" 2>/dev/null || { cat "$temp_dir/first.log"; return 1; }
    sleep 0.05
  done
  [[ -f "$temp_dir/locked" ]] || return 1
  "${psql[@]}" >"$temp_dir/second.log" 2>&1 <<SQL &
SET application_name = 'ledger_concurrent_waiter';
SET statement_timeout = '10s';
$second_sql
SQL
  local second_pid=$! blocked=''
  for attempt in {1..100}; do
    blocked="$("${psql[@]}" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name='ledger_concurrent_waiter' AND wait_event_type='Lock'")"
    [[ "$blocked" = '1' ]] && break
    kill -0 "$second_pid" 2>/dev/null || { cat "$temp_dir/second.log"; return 1; }
    sleep 0.05
  done
  [[ "$blocked" = '1' ]] || return 1
  touch "$temp_dir/release"
  wait "$first_pid" || { cat "$temp_dir/first.log"; return 1; }
  wait "$second_pid" || { cat "$temp_dir/second.log"; return 1; }
  printf 'Concurrency PASS: %s; observed second session waiting on PostgreSQL lock.\n' "$label"
}
run_race 'purchase versus refund: one reservation' \
  "SELECT ledger_test.apply(ledger_test.command(100,'reserve_purchase',40));" \
  "SELECT ledger_test.reject(ledger_test.command(101,'reserve_refund',20),'ledger reservation conflict');"
"${psql[@]}" -c "SELECT ledger_test.apply(ledger_test.command(102,'release_purchase',0,0,100));" >/dev/null
run_race 'duplicate credit: one journal' \
  "SELECT ledger_test.apply(ledger_test.command(200,'credit_principal',100));" \
  "SELECT ledger_test.apply(ledger_test.command(200,'credit_principal',100));"
run_race 'competing reversals: reference consumed once' \
  "SELECT ledger_test.apply(ledger_test.command(201,'reverse_credit',0,0,200));" \
  "SELECT ledger_test.reject(ledger_test.command(202,'reverse_credit',0,0,200),'ledger reference consumed');"
run_race 'registry disable versus credit: disabled integration rejects waiting writer' \
  "UPDATE piggyvest_staging.integrations SET enabled=false;" \
  "SELECT ledger_test.reject(ledger_test.command(300,'credit_principal',1),'ledger integration disabled');"
"${psql[@]}" -c "UPDATE piggyvest_staging.integrations SET enabled=true;" >/dev/null
"${psql[@]}" -c "SELECT ledger_test.assert_restart();" >/dev/null
printf 'Local ledger SQL acceptance and restart passed.\n'
