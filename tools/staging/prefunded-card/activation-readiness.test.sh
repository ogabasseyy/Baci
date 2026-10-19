#!/usr/bin/env bash
set -euo pipefail
readonly HERE="$(cd "$(dirname "$0")" && pwd)"
readonly SOURCE="${1:?Provide canonical tools/staging/prefunded-card directory}"
readonly POSTGRES_BIN="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
readonly TEST_ROOT="$(mktemp -d /private/tmp/baci-readiness-rehearsal.XXXXXX)"
while read -r variable; do unset "$variable"; done < <(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p')
cleanup() {
  if [[ -f "$TEST_ROOT/data/postmaster.pid" ]]; then
    "$POSTGRES_BIN/pg_ctl" -D "$TEST_ROOT/data" -m immediate stop >/dev/null
  fi
  printf 'Evidence retained: %s\n' "$TEST_ROOT"
}
trap cleanup EXIT
mkdir -m 700 "$TEST_ROOT/socket"
"$POSTGRES_BIN/initdb" -D "$TEST_ROOT/data" -A trust -U harness_admin --no-locale --encoding=UTF8 > "$TEST_ROOT/initdb.log"
"$POSTGRES_BIN/pg_ctl" -D "$TEST_ROOT/data" -o "-k '$TEST_ROOT/socket' -h '' -p 55463" -l "$TEST_ROOT/postgres.log" start >/dev/null
psql=("$POSTGRES_BIN/psql" -X -w -v ON_ERROR_STOP=1 -h "$TEST_ROOT/socket" -p 55463 -U harness_admin -d postgres)
if "${psql[@]}" -f "$HERE/activation-readiness.sql" > "$TEST_ROOT/identity-refusal.log" 2>&1; then
  exit 1
fi
grep -q staging_identity_refused "$TEST_ROOT/identity-refusal.log"
system_id="$("${psql[@]}" -Atc 'SELECT system_identifier FROM pg_control_system()')"
python3 - "$SOURCE" "$TEST_ROOT" "$system_id" <<'PY'
import importlib.util
from pathlib import Path
import sys
source, target = map(Path, sys.argv[1:3])
spec = importlib.util.spec_from_file_location('foundation', source / 'foundation-install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
(target / 'install.sql').write_text(module.build_install_sql(source).replace(
    module.PHYSICAL_DATABASE_SYSTEM_IDENTIFIER, sys.argv[3]))
PY
"${psql[@]}" -f "$SOURCE/foundation-prerequisites.test.sql" > "$TEST_ROOT/prerequisites.log"
"${psql[@]}" -f "$TEST_ROOT/install.sql" > "$TEST_ROOT/install.log" 2>&1
sed "s/7685292944002592802/$system_id/g" "$HERE/activation-readiness.sql" > "$TEST_ROOT/query.sql"
"${psql[@]}" -qAt -f "$TEST_ROOT/query.sql" > "$TEST_ROOT/result.json"
python3 - "$TEST_ROOT/result.json" "$system_id" <<'PY'
import json
from pathlib import Path
import sys
report = json.loads(Path(sys.argv[1]).read_text())
assert report['systemIdentifier'] == sys.argv[2] and report['readOnly'] is True
assert len(report['roles']) == 3 and all(not role['loginEnabled'] and not role['unsafe'] for role in report['roles'])
assert report['treasuryBindings'] == report['checkoutIntents'] == report['operations'] == 0
assert report['goals'] == [] and report['registry'] == []
PY
printf '%s\n' 'PASS read-only readiness SQL: genuine scratch identity, actual foundation schema, wrong cluster refused.'
