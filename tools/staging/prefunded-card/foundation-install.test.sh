#!/usr/bin/env bash
set -euo pipefail

while read -r variable; do unset "$variable"; done < <(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p')
readonly HERE="$(cd "$(dirname "$0")" && pwd)"
readonly POSTGRES_BIN="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
readonly TEST_ROOT="$(mktemp -d /private/tmp/baci-foundation-rehearsal.XXXXXX)"

cleanup() {
  if [[ -f "$TEST_ROOT/data/postmaster.pid" ]]; then
    "$POSTGRES_BIN/pg_ctl" -D "$TEST_ROOT/data" -m immediate stop >/dev/null
  fi
  printf 'Rehearsal evidence retained: %s\n' "$TEST_ROOT"
}
trap cleanup EXIT
mkdir -m 700 "$TEST_ROOT/socket"
"$POSTGRES_BIN/initdb" -D "$TEST_ROOT/data" -A trust -U harness_admin --no-locale --encoding=UTF8 > "$TEST_ROOT/initdb.log"
"$POSTGRES_BIN/pg_ctl" -D "$TEST_ROOT/data" -o "-k '$TEST_ROOT/socket' -h '' -p 55461" -l "$TEST_ROOT/postgres.log" start >/dev/null
psql=("$POSTGRES_BIN/psql" -X -w -v ON_ERROR_STOP=1 -h "$TEST_ROOT/socket" -p 55461 -U harness_admin -d postgres)
system_id="$("${psql[@]}" -Atc 'SELECT system_identifier FROM pg_control_system()')"

python3 - "$HERE" "$TEST_ROOT" "$system_id" <<'PY'
import importlib.util
from pathlib import Path
import sys

source, target = map(Path, sys.argv[1:3])
spec = importlib.util.spec_from_file_location('foundation', source / 'foundation-install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sql = module.build_install_sql(source)
sql = sql.replace(module.PHYSICAL_DATABASE_SYSTEM_IDENTIFIER, sys.argv[3])
(target / 'install-scratch.sql').write_text(sql)
PY

if "${psql[@]}" -f "$TEST_ROOT/install-scratch.sql" > "$TEST_ROOT/negative.log" 2>&1; then
  printf 'Unexpected installation without prerequisites\n' >&2
  exit 1
fi
grep -q foundation_missing: "$TEST_ROOT/negative.log"
[[ "$("${psql[@]}" -Atc "SELECT to_regnamespace('prefunded_card') IS NULL")" == t ]]
"${psql[@]}" -f "$HERE/foundation-prerequisites.test.sql" > "$TEST_ROOT/prerequisites.log"

"${psql[@]}" -c 'CREATE ROLE prefunded_authorizer NOLOGIN' >/dev/null
if "${psql[@]}" -f "$TEST_ROOT/install-scratch.sql" > "$TEST_ROOT/existing-role.log" 2>&1; then
  printf 'Unexpected reuse of an existing executor role\n' >&2
  exit 1
fi
grep -q foundation_conflict:executor_role_state "$TEST_ROOT/existing-role.log"
[[ "$("${psql[@]}" -Atc "SELECT to_regnamespace('prefunded_card') IS NULL")" == t ]]
"${psql[@]}" -c 'DROP ROLE prefunded_authorizer' >/dev/null

"${psql[@]}" -f "$TEST_ROOT/install-scratch.sql" > "$TEST_ROOT/install.log" 2>&1
"${psql[@]}" -At <<'SQL' > "$TEST_ROOT/postflight.log"
SELECT
  to_regprocedure('prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)') IS NOT NULL,
  (SELECT count(*) FROM pg_roles WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence') AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication),
  (SELECT count(*) FROM prefunded_card.operations),
  (SELECT count(*) FROM prefunded_card.treasury_bindings),
  (SELECT count(*) FROM prefunded_card.checkout_intents),
  has_function_privilege('prefunded_authorizer','prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)','EXECUTE'),
  has_function_privilege('authenticated','prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)','EXECUTE');
SQL
[[ "$(cat "$TEST_ROOT/postflight.log")" == 't|3|0|0|0|t|f' ]]
if "${psql[@]}" -f "$TEST_ROOT/install-scratch.sql" > "$TEST_ROOT/repeat.log" 2>&1; then
  printf 'Unexpected overwrite of an existing installation\n' >&2
  exit 1
fi
grep -q foundation_conflict:prefunded_card_schema "$TEST_ROOT/repeat.log"
printf 'PASS inactive foundation DDL with synthetic prerequisites; missing prerequisites, existing roles and repeated install refused. No financial flow or live compatibility claim.\n'
