#!/usr/bin/env bash
# Exercises real concurrent PostgreSQL row locks on an isolated synthetic schema.
set -eu
D=$(mktemp -d /tmp/oxygen-lock-proof-XXXXXX)
cleanup(){ pg_ctl -D "$D" -m fast stop >/dev/null 2>&1 || true; rm -rf "$D"; }
trap cleanup EXIT
initdb -D "$D" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$D" -l "$D/server.log" -o "-k $D -p 55477 -c listen_addresses=''" start >/dev/null
export PGHOST="$D" PGPORT=55477 PGDATABASE=postgres
export PGOPTIONS="-c statement_timeout=10000 -c lock_timeout=5000"
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_draft_concurrency_fixture.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103021500_oxygen_minimize_submitted_drafts.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103031000_oxygen_draft_workflow_first_write.sql
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO customers(id,merchant_id,user_id) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
INSERT INTO orders(id,merchant_id,customer_id) VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
INSERT INTO oxygen_workflows(id,order_id,merchant_id,customer_id) VALUES ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES ('00000000-0000-4000-8000-000000000005','{"applicationReference":"synthetic"}');
INSERT INTO oxygen_private.commands(id,workflow_id,command,status) VALUES ('00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000005','{"action":"start_application"}','executing');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT public.oxygen_save_form_draft('00000000-0000-4000-8000-000000000005',0,'00000000-0000-4000-8000-000000000006',repeat('x',40),repeat('y',40),now()+interval '1 day');
SQL
psql -Xq -v ON_ERROR_STOP=1 >"$D/a" 2>&1 <<'SQL' &
BEGIN;
SELECT id FROM oxygen_workflows WHERE id='00000000-0000-4000-8000-000000000005' FOR UPDATE;
SELECT pg_sleep(2);
UPDATE oxygen_workflows SET stage='booked' WHERE id='00000000-0000-4000-8000-000000000005';
UPDATE oxygen_private.commands SET status='succeeded' WHERE id='00000000-0000-4000-8000-000000000008';
COMMIT;
SQL
A=$!
sleep .4
PGAPPNAME=oxygen_draft_autosave psql -Xq -v ON_ERROR_STOP=1 >"$D/b" 2>&1 <<'SQL' &
\set VERBOSITY verbose
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT public.oxygen_save_form_draft('00000000-0000-4000-8000-000000000005',1,'00000000-0000-4000-8000-000000000007',repeat('z',40),repeat('y',40),now()+interval '1 day');
SQL
B=$!
blocked=false
for _ in {1..12}; do
 if [ "$(psql -XqAt -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='oxygen_draft_autosave' AND wait_event_type='Lock'")" = 1 ]; then blocked=true; break; fi
 sleep .1
done
if [ "$blocked" != true ]; then echo 'autosave did not wait for workflow lock'; exit 1; fi
wait "$A" || { cat "$D/a"; exit 1; }
if wait "$B"; then echo 'unexpected save after transition'; exit 1; fi
if ! grep -q '40001: Draft unavailable' "$D/b"; then cat "$D/b"; exit 1; fi
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM oxygen_form_drafts WHERE workflow_id='00000000-0000-4000-8000-000000000005' AND ciphertext IS NULL) THEN
  RAISE EXCEPTION 'draft was not minimized after workflow completion';
 END IF;
END $$;
SQL
echo 'workflow-first concurrent save rejected; draft minimized'
