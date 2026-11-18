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
DECLARE w record; c record; v_state jsonb;
BEGIN
  SELECT p_id AS id INTO w;
  SELECT jsonb_build_object('action', coalesce(p_payload->>'action', 'refresh_eligibility')) AS command INTO c;
 SELECT state INTO v_state FROM oxygen_private.provider_states WHERE workflow_id=w.id;
 v_state:=coalesce(v_state,'{}');
  IF p_operation IN ('status', 'worker_status', 'claim') THEN
    RETURN v_state;
  END IF;
  IF ((p_payload->'state') - ARRAY['validated','eligible','eligibilityStatus','eligibleAmount']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid provider state' USING ERRCODE='22023';
  END IF;
  INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES(w.id,p_payload->'state')
   ON CONFLICT(workflow_id) DO UPDATE SET state=excluded.state;
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
cat > "$check_dir/duplicate-read-marker.sql" <<'SQL'
BEGIN;
DO $test$
DECLARE
  d text := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  m constant text := ' v_state:=coalesce(v_state,''{}'');';
BEGIN
  EXECUTE replace(d,m,E'-- ' || m || E'\n' || m);
END $test$;
SQL
for fixture in duplicate-needle duplicate-marker duplicate-read-marker; do
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
  result := oxygen_private.runtime('status','60000000-0000-4000-8000-000000000001');
  IF result ? 'eligibilityFailureReason' THEN RAISE EXCEPTION 'legacy status exposed new reason'; END IF;
  result := oxygen_private.runtime('status','60000000-0000-4000-8000-000000000001',
    '{"includeEligibilityFailureReason":true}');
  IF result->>'eligibilityFailureReason' IS DISTINCT FROM 'financial_details_mismatch' THEN RAISE EXCEPTION 'opted-in status lost reason'; END IF;
  result := oxygen_private.runtime('claim','60000000-0000-4000-8000-000000000001');
  IF result ? 'eligibilityFailureReason' THEN RAISE EXCEPTION 'legacy claim exposed new reason'; END IF;
  PERFORM oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000001',
    '{"action":"refresh_kyc","state":{"eligibilityStatus":"failed"}}');
  result := oxygen_private.runtime('status','60000000-0000-4000-8000-000000000001',
    '{"includeEligibilityFailureReason":true}');
  IF result->>'eligibilityFailureReason' IS DISTINCT FROM 'financial_details_mismatch' THEN RAISE EXCEPTION 'unrelated legacy action lost reason'; END IF;
  PERFORM oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000001',
    '{"state":{"eligibilityStatus":"failed"}}');
  result := oxygen_private.runtime('status','60000000-0000-4000-8000-000000000001',
    '{"includeEligibilityFailureReason":true}');
  IF result ? 'eligibilityFailureReason' THEN RAISE EXCEPTION 'legacy eligibility refresh kept stale reason'; END IF;
  PERFORM oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000001',
    '{"state":{"eligibilityStatus":"failed","eligibilityFailureReason":"financial_details_mismatch"}}');
  PERFORM oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000001',
    '{"state":{"eligibilityStatus":"pending"}}');
  result := oxygen_private.runtime('status','60000000-0000-4000-8000-000000000001',
    '{"includeEligibilityFailureReason":true}');
  IF result ? 'eligibilityFailureReason' THEN RAISE EXCEPTION 'pending refresh kept stale reason'; END IF;
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
  BEGIN
    PERFORM oxygen_private.runtime('finish','60000000-0000-4000-8000-000000000005',
      '{"action":"refresh_kyc","state":{"eligibilityStatus":"failed","eligibilityFailureReason":"financial_details_mismatch"}}');
    RAISE EXCEPTION 'unrelated action set a reason';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $test$;
SQL
psql -Xq -v ON_ERROR_STOP=1 -f "$check_dir/assertions.sql" >"$check_dir/assertions.log"
echo 'Unique migration and bounded eligibility state passed'

psql -Xq -v ON_ERROR_STOP=1 -f "$check_root/supabase/migrations/20261118192000_oxygen_eligibility_progress.sql" >"$check_dir/progress-migration.log"
psql -Xq -v ON_ERROR_STOP=1 >"$check_dir/progress.log" <<'SQL'
DO $test$
DECLARE
  id constant uuid := '60000000-0000-4000-8000-000000000006';
  opt_in constant jsonb := '{"includeEligibilityProgress":true}';
BEGIN
  PERFORM oxygen_private.runtime('finish', id,
    '{"state":{"eligibilityStatus":"pending","eligibilityProgress":"bank_statement"}}');
  IF oxygen_private.runtime('status', id) ? 'eligibilityProgress'
     OR oxygen_private.runtime('claim', id, opt_in) ? 'eligibilityProgress' THEN
    RAISE EXCEPTION 'Legacy runtime projection exposed progress';
  END IF;
  IF oxygen_private.runtime('status', id, opt_in)->>'eligibilityProgress' IS DISTINCT FROM 'bank_statement' THEN
    RAISE EXCEPTION 'Opted-in client lost progress';
  END IF;
  PERFORM oxygen_private.runtime('finish', id,
    '{"action":"refresh_kyc","state":{"eligibilityStatus":"pending"}}');
  IF oxygen_private.runtime('status', id, opt_in)->>'eligibilityProgress' IS DISTINCT FROM 'bank_statement' THEN
    RAISE EXCEPTION 'Unrelated check cleared current progress';
  END IF;
  PERFORM oxygen_private.runtime('finish', id,
    '{"state":{"eligibilityStatus":"pending","eligibilityProgress":"credit_score"}}');
  IF oxygen_private.runtime('status', id, opt_in)->>'eligibilityProgress' IS DISTINCT FROM 'credit_score' THEN
    RAISE EXCEPTION 'New eligibility observation failed to replace prior progress';
  END IF;
  PERFORM oxygen_private.runtime('finish', id, '{"state":{"eligibilityStatus":"pending"}}');
  IF oxygen_private.runtime('status', id, opt_in) ? 'eligibilityProgress' THEN
    RAISE EXCEPTION 'Generic pending response kept stale progress';
  END IF;
  BEGIN
    PERFORM oxygen_private.runtime('finish', id,
      '{"state":{"eligibilityStatus":"pending","eligibilityProgress":"private provider text"}}');
    RAISE EXCEPTION 'Unrecognized provider text accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $test$;
SQL
echo 'Bounded progress and legacy projections passed'

# Exercise the actual runtime's owner and worker checks as well as its old
# strict projection. The fixture supplies only the runtime's dependencies.
createdb oxygen_real_runtime
export PGDATABASE=oxygen_real_runtime
for source in \
  supabase/tests/oxygen_eligibility_failure_reason_runtime_fixture.sql \
  supabase/migrations/20261020150556_oxygen_provider_workflow_runtime.sql \
  supabase/migrations/20261023101000_oxygen_eligibility_status.sql \
  supabase/migrations/20261111140000_oxygen_tenure_offers.sql \
  supabase/migrations/20261111141410_oxygen_offer_tenure_consistency.sql \
  supabase/migrations/20261111143604_oxygen_offer_amount_precision.sql \
  supabase/migrations/20261116191630_oxygen_eligibility_failure_reason.sql \
  supabase/migrations/20261118192000_oxygen_eligibility_progress.sql \
  supabase/migrations/20261118203000_oxygen_eligibility_background.sql \
  supabase/tests/oxygen_eligibility_status.sql \
  supabase/tests/oxygen_eligibility_background.sql; do
  psql -Xq -v ON_ERROR_STOP=1 -f "$check_root/$source" >"$check_dir/runtime.log"
done
echo 'Real runtime owner, worker and rollback projections passed'
