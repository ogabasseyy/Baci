#!/usr/bin/env bash
set -euo pipefail
while read -r variable; do unset "$variable"; done < <(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p')
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
bundle="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_root="$(mktemp -d /private/tmp/prefunded-authorization-test.XXXXXX)"
cleanup() {
  if [[ -f "$test_root/data/postmaster.pid" ]]; then
    if ! "$postgres_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1; then
      printf 'Could not stop disposable cluster; retained %s\n' "$test_root" >&2
      return
    fi
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 "$test_root/socket"
"$postgres_bin/initdb" -D "$test_root/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55457" -l "$test_root/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=terse -h "$test_root/socket" -p 55457 -U harness_admin -d postgres)
"${psql[@]}" -f "$bundle/authorization-fixture.sql" >/dev/null
"${psql[@]}" -f "$bundle/authorization-integration-fixture.sql" >/dev/null
for source in authorization-storage.sql authorization-candidate.sql authorization-functions.sql; do
  if [[ -f "$bundle/$source" ]]; then "${psql[@]}" -f "$bundle/$source" >/dev/null; fi
done
"${psql[@]}" -f "$bundle/authorization-regressions.test.sql" >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -m fast restart -o "-k '$test_root/socket' -h '' -p 55457" >/dev/null
"${psql[@]}" -c "SET SESSION AUTHORIZATION authorization_worker; SELECT authorization_test.assert(authorization_test.read_method()->>'domain'='test','historical identity survives restart');" >/dev/null
printf 'PASS authorization SQL role, ownership, proof, revocation and restart regressions\n'
