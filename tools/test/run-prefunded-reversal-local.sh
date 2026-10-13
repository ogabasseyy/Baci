#!/usr/bin/env bash
set -euo pipefail
while read -r variable; do unset "$variable"; done < <(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p')
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d /private/tmp/baci-prefunded-reversal.XXXXXX)"
cleanup() {
  if [[ -f "$test_root/data/postmaster.pid" ]] && ! "$postgres_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1; then
    printf 'Could not stop scratch cluster: %s\n' "$test_root" >&2
    return
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 "$test_root/socket"
"$postgres_bin/initdb" -D "$test_root/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55467" -l "$test_root/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$test_root/socket" -p 55467 -U harness_admin -d postgres)
"${psql[@]}" -f "$worktree/tools/staging/piggyvest-goal-funding/projection.scratch-setup.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/reversal-setup.test.sql" >/dev/null
for migration in "$worktree"/supabase/migrations/20260912120[0-5]00_*.sql; do
  "${psql[@]}" -f "$migration" >/dev/null
done
for source in storage storage-functions treasury-storage treasury-functions projection-storage projection-functions projection-admission; do
  "${psql[@]}" -f "$worktree/tools/staging/prefunded-card/$source.sql" >/dev/null
done
if [[ "${1:-}" != "--baseline" ]]; then
  for source in reversal-storage reversal-functions reversal-guard; do
    "${psql[@]}" -f "$worktree/tools/staging/prefunded-card/$source.sql" >/dev/null
  done
fi
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/reversal-fixture.test.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/reversal-regression.test.sql"
if [[ "${1:-}" == "--baseline" ]]; then exit 0; fi
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/reversal-functions.test.sql"
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/reversal-boundaries.test.sql"
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/reversal-ordering.test.sql"
"$postgres_bin/pg_ctl" -D "$test_root/data" -m fast restart -o "-k '$test_root/socket' -h '' -p 55467" >/dev/null
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/reversal-restart.test.sql"
"${psql[@]}" -qc "SET SESSION AUTHORIZATION treasury_verifier; SELECT prefunded_card.record_treasury_snapshot('50000000-0000-4000-8000-000000000001','race-snapshot',3,clock_timestamp(),80000)" >/dev/null
system_id="$("${psql[@]}" -Atc 'SELECT system_identifier FROM pg_control_system()')"
for sequence in 4 5; do
  if [[ "$sequence" == 4 ]]; then
    first="SELECT prefunded_card.record_collection_reversal('$system_id',reversal_test.event(4))"
    second="SELECT reversal_test.assert(prefunded_card.claim_transfer(reversal_test.operation(4),0)->>'outcome'='stale_or_reconciliation_required','reversal winning binding lock blocks competing dispatch')"
  else
    first="SELECT prefunded_card.claim_transfer(reversal_test.operation(5),0)"
    second="SELECT reversal_test.assert(prefunded_card.record_collection_reversal('$system_id',reversal_test.event(5))->>'exposure'='transfer_in_flight','claim winning binding lock preserves in-flight obligation')"
  fi
  "${psql[@]}" >"$test_root/first-$sequence.log" 2>&1 <<SQL &
SET SESSION AUTHORIZATION reversal_worker;
SET statement_timeout='8s';
BEGIN;
$first;
\! touch '$test_root/first-$sequence-locked'
\! while test ! -f '$test_root/release-$sequence'; do sleep 0.02; done
COMMIT;
SQL
  first_pid=$!
  for attempt in {1..100}; do [[ -f "$test_root/first-$sequence-locked" ]] && break; sleep 0.02; done
  [[ -f "$test_root/first-$sequence-locked" ]]
  "${psql[@]}" -c "SET SESSION AUTHORIZATION reversal_worker; SET application_name='reversal-race-$sequence'; SET statement_timeout='8s'; $second" >"$test_root/second-$sequence.log" 2>&1 &
  second_pid=$!
  lock_observed=false
  for attempt in {1..100}; do
    if [[ "$("${psql[@]}" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name='reversal-race-$sequence' AND wait_event_type='Lock'")" == 1 ]]; then
      lock_observed=true
      break
    fi
    sleep 0.02
  done
  [[ "$lock_observed" == true ]]
  touch "$test_root/release-$sequence"
  wait "$first_pid"
  wait "$second_pid"
done
duplicate_pids=()
for attempt in {1..6}; do
  "${psql[@]}" -qc "SET SESSION AUTHORIZATION reversal_worker; SELECT reversal_test.assert(prefunded_card.record_collection_reversal('$system_id',reversal_test.event(4))->>'outcome'='duplicate','simultaneous replay is idempotent')" >"$test_root/replay-$attempt.log" 2>&1 &
  duplicate_pids+=("$!")
done
for process in "${duplicate_pids[@]}"; do wait "$process"; done
"${psql[@]}" -qc "SELECT reversal_test.assert((SELECT count(*)=1 FROM prefunded_card.collection_reversal_obligations WHERE operation_id=reversal_test.operation(4)),'one concurrent reversal obligation')"
printf 'export {};\n' > "$test_root/server-only.ts"
pnpm --dir "$worktree/apps/web" exec esbuild "$worktree/tools/test/prefunded-card-reversal.driver.ts" --bundle --platform=node --format=cjs --external:pg-native --tsconfig="$worktree/apps/web/tsconfig.json" --alias:server-only="$test_root/server-only.ts" --outfile="$test_root/driver.cjs" >/dev/null
node "$test_root/driver.cjs" "$test_root/socket" "$system_id"
printf 'PASS disposable prefunded reversal tests\n'
