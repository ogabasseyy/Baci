#!/bin/bash
set -euo pipefail
check_root="$PWD"
check_dir=$(mktemp -d /tmp/oxygen-failure-guard.XXXXXX)
cleanup() {
  if [ -f "$check_dir/data/postmaster.pid" ]; then pg_ctl -D "$check_dir/data" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf "$check_dir"
}
trap cleanup EXIT
initdb -D "$check_dir/data" -U postgres --auth=trust --no-locale >/dev/null
pg_ctl -D "$check_dir/data" -o "-k $check_dir -p 55497 -c listen_addresses=''" -w start >"$check_dir/server.log"
export PGHOST="$check_dir" PGPORT=55497 PGUSER=postgres PGDATABASE=postgres
cat > "$check_dir/fixture.sql" <<'SQL'
CREATE SCHEMA oxygen_private;
CREATE TABLE oxygen_private.provider_states(workflow_id uuid PRIMARY KEY, state jsonb);
CREATE FUNCTION oxygen_private.runtime(p_operation text, p_id uuid, p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql AS $body$
BEGIN
  IF ((p_payload->'state') - ARRAY['validated','eligible','eligibilityStatus','eligibleAmount']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid provider state' USING ERRCODE='22023';
  END IF;
  INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES(p_id,p_payload->'state');
  RETURN p_payload->'state';
END $body$;
SQL
psql -Xq -v ON_ERROR_STOP=1 -f "$check_dir/fixture.sql" >"$check_dir/setup.log"
cat > "$check_dir/duplicate-needle.sql" <<'SQL'
BEGIN;
DO $test$
DECLARE
  d text := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  n constant text := '''validated'',''eligible'',''eligibilityStatus'',''eligibleAmount''';
BEGIN
  EXECUTE replace(d,n,n || E'\n -- ' || n || E'\n');
END $test$;
SQL
cat > "$check_dir/duplicate-marker.sql" <<'SQL'
BEGIN;
DO $test$
DECLARE
  d text := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  m constant text := '  INSERT INTO oxygen_private.provider_states(workflow_id,state)';
BEGIN
  EXECUTE replace(d,m,E'-- ' || m || E'\n' || m);
END $test$;
SQL
for fixture in duplicate-needle duplicate-marker; do
  if psql -Xq -v ON_ERROR_STOP=1 -f "$check_dir/$fixture.sql" -f "$check_root/supabase/migrations/20261116191630_oxygen_eligibility_failure_reason.sql" >"$check_dir/$fixture.log" 2>&1; then
    echo "$fixture unexpectedly accepted" >&2
    exit 1
  fi
  if ! grep -q 'Unexpected Oxygen runtime definition' "$check_dir/$fixture.log"; then
    cat "$check_dir/$fixture.log" >&2
    exit 1
  fi
  echo "$fixture rejected as expected"
done
psql -Xq -v ON_ERROR_STOP=1 -f "$check_root/supabase/migrations/20261116191630_oxygen_eligibility_failure_reason.sql" >"$check_dir/migration.log"
cat > "$check_dir/assertions.sql" <<'SQL'
DO $test$
DECLARE result jsonb;
BEGIN
  result := oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000001',
    '{"state":{"eligibilityStatus":"failed","eligibilityFailureReason":"financial_details_mismatch"}}');
  IF result->>'eligibilityFailureReason' <> 'financial_details_mismatch' THEN RAISE EXCEPTION 'reason missing'; END IF;
  BEGIN
    PERFORM oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000002',
      '{"state":{"eligibilityStatus":"failed","eligibilityFailureReason":"private data"}}');
    RAISE EXCEPTION 'unsafe reason accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000003',
      '{"state":{"eligibilityStatus":"pending","eligibilityFailureReason":"financial_details_mismatch"}}');
    RAISE EXCEPTION 'pending reason accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000004',
      '{"state":{"eligibilityStatus":"failed","eligible":false,"eligibilityFailureReason":"financial_details_mismatch"}}');
    RAISE EXCEPTION 'conflicting eligibility accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $test$;
SQL
psql -Xq -v ON_ERROR_STOP=1 -f "$check_dir/assertions.sql" >"$check_dir/assertions.log"
echo 'Unique migration and bounded eligibility state passed'
