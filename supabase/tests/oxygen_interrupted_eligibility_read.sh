#!/usr/bin/env bash
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/oxygen-eligibility-read-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55489 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55489 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_interrupted_eligibility_read.fixture.sql
# Use the real installed completion function, without unrelated callback setup.
python3 - "$fixture_dir/completion.sql" <<'PY'
import sys
source = open('supabase/migrations/20261020210000_oxygen_recoverable_failures.sql').read()
start = source.index('CREATE OR REPLACE FUNCTION oxygen_private.record_command')
end = source.index('CREATE OR REPLACE FUNCTION oxygen_private.callback')
open(sys.argv[1], 'w').write(source[start:end])
PY
psql -Xq -v ON_ERROR_STOP=1 -f "$fixture_dir/completion.sql"
if [[ ${OXYGEN_ELIGIBILITY_TEST_BEFORE_FIX:-0} == 1 ]]; then
 psql -Xq -v ON_ERROR_STOP=1 -c "CREATE FUNCTION oxygen_private.retire_stale_executing_eligibility(uuid) RETURNS void LANGUAGE sql AS 'SELECT';"
else
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261104120000_oxygen_interrupted_eligibility_read.sql
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261111193000_oxygen_recover_booked_offer_read.sql
fi
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_interrupted_eligibility_read.sql
