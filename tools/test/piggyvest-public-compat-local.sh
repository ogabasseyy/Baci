#!/usr/bin/env bash
set -euo pipefail
mode="${1:-current}"
[[ "$mode" == current || "$mode" == --regression-before-602 ]] || { printf 'Unsupported mode\n' >&2; exit 2; }
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d /tmp/baci-piggyvest-compat.XXXXXX)"
cleanup() {
  if [[ -f "$test_root/data/postmaster.pid" ]]; then
    if ! "$postgres_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1; then
      printf 'Stop failed; retaining owned cluster %s\n' "$test_root" >&2
      return
    fi
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$worktree/tools/test/piggyvest-public-compat-plan.mjs" "$test_root/sql" > "$test_root/manifest"
mkdir -m 700 "$test_root/socket"
"$postgres_bin/initdb" -D "$test_root/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55443 -c statement_timeout=15000" -l "$test_root/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$test_root/socket" -p 55443 -U harness_admin)
"${psql[@]}" -d postgres -c 'CREATE DATABASE piggyvest_local' >/dev/null
psql+=(-d piggyvest_local)
"${psql[@]}" -f "$worktree/tools/test/piggyvest-public-compat-bootstrap.sql" >/dev/null
count=0
while read -r hash migration; do
  if [[ "$mode" == --regression-before-602 && "$migration" == 20260912160200_cancel_plan_preserve_goal_snapshot.sql ]]; then
    printf 'REGRESSION deliberately omits %s\n' "$migration"
    continue
  fi
  "${psql[@]}" -f "$test_root/sql/$migration" >/dev/null
  printf 'REPLAY %s %s\n' "$hash" "$migration"
  count=$((count+1))
done < "$test_root/manifest"
"${psql[@]}" -f "$worktree/tools/test/piggyvest-full-local-checks.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/test/piggyvest-public-compat-cases.sql"
printf 'PASS %s source-backed migrations; real savings table/trigger/RLS slice, stub dependencies; NOT full production schema.\n' "$count"
