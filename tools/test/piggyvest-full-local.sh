#!/usr/bin/env bash
set -euo pipefail
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d /tmp/baci-piggyvest-full.XXXXXX)"
cleanup() {
  if [[ -f "$test_root/data/postmaster.pid" ]]; then
    if ! "$postgres_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1; then
      printf 'Local database could not stop; retaining %s\n' "$test_root" >&2
      return
    fi
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$worktree/tools/test/piggyvest-full-local-plan.mjs" "$test_root/migrations" > "$test_root/manifest"
mkdir -m 700 "$test_root/socket"
"$postgres_bin/initdb" -D "$test_root/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55443" -l "$test_root/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$test_root/socket" -p 55443 -U harness_admin)
"${psql[@]}" -d postgres -c 'CREATE DATABASE piggyvest_local' >/dev/null
psql+=(-d piggyvest_local)
"${psql[@]}" -f "$worktree/tools/test/piggyvest-full-local-fixture.sql" >/dev/null
count=0
while read -r hash migration; do
  "${psql[@]}" -f "$test_root/migrations/$migration" >/dev/null
  printf 'REPLAY %s %s\n' "$hash" "$migration"
  count=$((count + 1))
done < "$test_root/manifest"
"${psql[@]}" -f "$worktree/tools/test/piggyvest-full-local-checks.sql"
for fault in grant rls cancel_grant cancel_rls cancel_routine missing_original; do
  if [[ "$fault" == grant ]]; then
    mutation='GRANT USAGE ON SCHEMA piggyvest_staging TO authenticated'
    expected='unexpected schema privilege: authenticated piggyvest_staging'
  elif [[ "$fault" == rls ]]; then
    mutation='ALTER TABLE piggyvest_staging.integrations DISABLE ROW LEVEL SECURITY'
    expected='missing RLS: integrations'
  elif [[ "$fault" == cancel_grant ]]; then
    mutation='CREATE SCHEMA IF NOT EXISTS piggyvest_cancel_plan; GRANT USAGE ON SCHEMA piggyvest_cancel_plan TO authenticated'
    expected='unexpected schema privilege: authenticated piggyvest_cancel_plan'
  elif [[ "$fault" == cancel_rls ]]; then
    mutation='CREATE SCHEMA IF NOT EXISTS piggyvest_cancel_plan; CREATE TABLE piggyvest_cancel_plan.full_replay_probe(id integer)'
    expected='missing RLS: full_replay_probe'
  elif [[ "$fault" == cancel_routine ]]; then
    mutation="CREATE SCHEMA IF NOT EXISTS piggyvest_cancel_plan; CREATE FUNCTION piggyvest_cancel_plan.full_replay_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1'; GRANT EXECUTE ON FUNCTION piggyvest_cancel_plan.full_replay_probe() TO PUBLIC"
    expected='PUBLIC routine grant: full_replay_probe'
  else
    mutation='ALTER SCHEMA piggyvest_goal_policy RENAME TO piggyvest_hidden_policy'
    expected='incomplete replay'
  fi
  if "${psql[@]}" -c "BEGIN; $mutation" -f "$worktree/tools/test/piggyvest-full-local-checks.sql" > "$test_root/fault.log" 2>&1; then
    printf 'FAIL security checks accepted injected %s\n' "$fault" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$test_root/fault.log"; then
    cat "$test_root/fault.log" >&2
    exit 1
  fi
  printf 'PASS rejected injected %s (transaction rolled back on disconnect).\n' "$fault"
done
expected_schemas="$("${psql[@]}" -Atc "SELECT count(*)+1 FROM pg_namespace WHERE nspname ~ '^piggyvest_'")"
"${psql[@]}" -c 'BEGIN; CREATE SCHEMA piggyvest_full_count_probe' \
  -f "$worktree/tools/test/piggyvest-full-local-checks.sql" > "$test_root/count.log" 2>&1
if ! grep -Fq "PASS private schemas=$expected_schemas tables=" "$test_root/count.log"; then
  cat "$test_root/count.log" >&2
  exit 1
fi
printf 'PASS dynamic schema coverage count=%s (synthetic extra schema rolled back).\n' "$expected_schemas"
"$postgres_bin/pg_ctl" -D "$test_root/data" -m fast stop >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55443" -l "$test_root/postgres.log" start >/dev/null
"${psql[@]}" -f "$worktree/tools/test/piggyvest-full-local-checks.sql"
printf 'PASS %s registered staging drafts; ACL/RLS checks before and after restart; synthetic baseline only.\n' "$count"
