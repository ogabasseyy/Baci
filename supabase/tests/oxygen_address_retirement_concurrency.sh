#!/usr/bin/env bash
# Disposable synthetic local cluster, never accepts a connection URL.
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/oxygen-address-race-XXXXXX)
first_pid=''
second_pid=''
cleanup() {
 [[ -n "$first_pid" ]] && kill "$first_pid" 2>/dev/null || true
 [[ -n "$second_pid" ]] && kill "$second_pid" 2>/dev/null || true
 pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true
 rm -rf "$fixture_dir"
}
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55479 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55479 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_address_retirement_concurrency_fixture.sql
sed -n '127,143p' supabase/migrations/20261020142857_oxygen_shared_workflow.sql | psql -Xq -v ON_ERROR_STOP=1
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103230000_oxygen_abandon_queued_address.sql
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 IF public.oxygen_abandon_queued_address(NULL,0,'00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008') OR
    public.oxygen_abandon_queued_address('00000000-0000-4000-8000-000000000005',NULL,'00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008') OR
    public.oxygen_abandon_queued_address('00000000-0000-4000-8000-000000000005',0,NULL,'00000000-0000-4000-8000-000000000008') THEN
  RAISE EXCEPTION 'Null parameter retired command';
 END IF;
END $$;
UPDATE oxygen_private.commands SET command='{}';
DO $$ BEGIN
 IF public.oxygen_abandon_queued_address('00000000-0000-4000-8000-000000000005',0,'00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008') THEN
  RAISE EXCEPTION 'Null action retired command';
 END IF;
END $$;
UPDATE oxygen_private.commands SET command='{"action":"submit_address"}';
SQL
for winner in claim retire; do
 psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE oxygen_private.commands SET status='queued',started_at=NULL,completed_at=NULL"
 if [[ "$winner" == claim ]]; then
  first="SELECT oxygen_private.claim_command('00000000-0000-4000-8000-000000000006');"
  second="SELECT public.oxygen_abandon_queued_address('00000000-0000-4000-8000-000000000005',0,'00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008');"
  expected=executing
 else
  first="SELECT public.oxygen_abandon_queued_address('00000000-0000-4000-8000-000000000005',0,'00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008');"
  second="SELECT oxygen_private.claim_command('00000000-0000-4000-8000-000000000006');"
  expected=failed
 fi
 psql -Xq -v ON_ERROR_STOP=1 >"$fixture_dir/first" <<SQL &
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
BEGIN;
SELECT id FROM public.oxygen_workflows WHERE id='00000000-0000-4000-8000-000000000005' FOR UPDATE;
\! touch $fixture_dir/ready
\! for n in \$(seq 1 600); do [ -f $fixture_dir/release ] && exit 0; sleep 0.05; done; exit 1
$first
COMMIT;
SQL
 first_pid=$!
 ready=false
 for _ in {1..500}; do
  if [[ -f "$fixture_dir/ready" ]]; then ready=true; break; fi
  kill -0 "$first_pid"
  sleep 0.02
 done
 [[ "$ready" == true ]] || { echo "Lock holder did not become ready" >&2; exit 1; }
 PGAPPNAME=oxygen_phone_race_waiter psql -Xq -v ON_ERROR_STOP=1 -c "SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false); $second" >"$fixture_dir/second" &
 second_pid=$!
 blocked=false
 for _ in {1..500}; do
  if [[ $(psql -XAtq -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='oxygen_phone_race_waiter' AND wait_event_type='Lock'") == 1 ]]; then blocked=true; break; fi
  kill -0 "$second_pid"
  sleep 0.02
 done
 [[ "$blocked" == true ]] || { echo "Competing transaction did not wait for workflow lock" >&2; exit 1; }
 touch "$fixture_dir/release"
 wait "$first_pid"
 first_pid=''
 wait "$second_pid"
 second_pid=''
 actual=$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT status FROM oxygen_private.commands WHERE id='00000000-0000-4000-8000-000000000006'")
 [[ "$actual" == "$expected" ]] || { echo "Expected $expected; got $actual" >&2; exit 1; }
 rm "$fixture_dir/ready" "$fixture_dir/release"
done
# A concurrent ownership/payment change must be observed before retirement.
for change in owner payment; do
 psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE oxygen_private.commands SET status='queued',started_at=NULL,completed_at=NULL; UPDATE public.customers SET user_id='00000000-0000-4000-8000-000000000003'; UPDATE public.orders SET payment_status='unpaid'"
 if [[ "$change" == owner ]]; then
  update="UPDATE public.customers SET user_id='00000000-0000-4000-8000-000000000009' WHERE id='00000000-0000-4000-8000-000000000001';"
 else
  update="UPDATE public.orders SET payment_status='paid' WHERE id='00000000-0000-4000-8000-000000000004';"
 fi
 psql -Xq -v ON_ERROR_STOP=1 >"$fixture_dir/first" <<SQL &
BEGIN;
$update
\! touch $fixture_dir/ready
\! for n in \$(seq 1 600); do [ -f $fixture_dir/release ] && exit 0; sleep 0.05; done; exit 1
COMMIT;
SQL
 first_pid=$!
 for _ in {1..500}; do [[ -f "$fixture_dir/ready" ]] && break; kill -0 "$first_pid"; sleep 0.02; done
 [[ -f "$fixture_dir/ready" ]] || { echo 'Writer did not become ready' >&2; exit 1; }
 PGAPPNAME=oxygen_address_owner_waiter psql -XAtq -v ON_ERROR_STOP=1 >"$fixture_dir/second" <<'SQL' &
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT public.oxygen_abandon_queued_address('00000000-0000-4000-8000-000000000005',0,'00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008');
SQL
 second_pid=$!
 blocked=false
 for _ in {1..500}; do
  if [[ $(psql -XAtq -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='oxygen_address_owner_waiter' AND wait_event_type='Lock'") == 1 ]]; then blocked=true; break; fi
  kill -0 "$second_pid" 2>/dev/null || break
  sleep 0.02
 done
 [[ "$blocked" == true ]] || { echo "Retirement did not wait for concurrent $change update" >&2; exit 1; }
 touch "$fixture_dir/release"
 wait "$first_pid"; first_pid=''
 wait "$second_pid"; second_pid=''
 [[ $(tail -1 "$fixture_dir/second") == f ]] || { echo "Retirement accepted changed $change" >&2; exit 1; }
 [[ $(psql -XAtq -c "SELECT status FROM oxygen_private.commands WHERE id='00000000-0000-4000-8000-000000000006'") == queued ]] || { echo 'Command was retired' >&2; exit 1; }
 rm "$fixture_dir/ready" "$fixture_dir/release"
done
