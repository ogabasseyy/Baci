#!/usr/bin/env bash
set -euo pipefail
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD

postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d /tmp/baci-piggyvest-inbox.XXXXXX)"
socket_dir="$temp_dir/socket"
port=55440

cleanup() {
  touch "$temp_dir/release"
  if [[ -f "$temp_dir/data/postmaster.pid" ]]; then
    "$postgres_bin/pg_ctl" -D "$temp_dir/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [[ -n "${first_pid:-}" ]]; then
    wait "$first_pid" 2>/dev/null || true
  fi
  find "$temp_dir" -depth -delete
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -m 700 "$socket_dir"
"$postgres_bin/initdb" -D "$temp_dir/data" -A trust -U harness_admin --no-locale >/dev/null
"$postgres_bin/pg_ctl" -D "$temp_dir/data" \
  -o "-k '$socket_dir' -h '' -p $port" -l "$temp_dir/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$socket_dir" -p "$port" -U harness_admin -d postgres)

"${psql[@]}" <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE ROLE inbox_test_worker;
CREATE ROLE inbox_test_untrusted;
SQL

if [[ "${1:-}" != "--without-migration" ]]; then
  "${psql[@]}" -f "$worktree/supabase/migrations/20260912090000_piggyvest_staging_webhook_inbox.sql" >/dev/null
  "${psql[@]}" -f "$worktree/supabase/migrations/20260912090100_restrict_piggyvest_inbox_to_staging_registry.sql" >/dev/null
fi
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_integration_registry.sql"
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_webhook_inbox.sql"
"${psql[@]}" -f "$worktree/supabase/migrations/tests/piggyvest_staging_webhook_inbox_leases.sql"

"${psql[@]}" <<'SQL'
SET ROLE inbox_test_worker;
DO $$
BEGIN
  PERFORM piggyvest_staging.enqueue_inbox('22222222-2222-4222-8222-222222222222', 'restart', '\x00ff01');
END $$;
SQL
"$postgres_bin/pg_ctl" -D "$temp_dir/data" -m fast stop >/dev/null
"$postgres_bin/pg_ctl" -D "$temp_dir/data" \
  -o "-k '$socket_dir' -h '' -p $port" -l "$temp_dir/postgres.log" start >/dev/null
"${psql[@]}" <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM piggyvest_staging.inbox
    WHERE integration_id = '22222222-2222-4222-8222-222222222222'
      AND provider_event_id = 'restart' AND raw_body = '\x00ff01'::bytea
      AND fingerprint = pg_catalog.sha256('\x00ff01'::bytea) AND status = 'pending' AND attempts = 0) <> 1 THEN
    RAISE EXCEPTION 'committed inbox event did not survive restart';
  END IF;
END $$;
SET ROLE inbox_test_worker;
DO $$
DECLARE
  replay record;
  claim record;
BEGIN
  SELECT inbox_id, outcome INTO STRICT replay FROM piggyvest_staging.enqueue_inbox(
    '22222222-2222-4222-8222-222222222222', 'restart', '\x00ff01');
  IF replay.outcome <> 'duplicate' THEN RAISE EXCEPTION 'restart lost replay deduplication'; END IF;
  SELECT inbox_id, claim_token INTO STRICT claim FROM piggyvest_staging.claim_inbox(
    '22222222-2222-4222-8222-222222222222', 1, 30);
  IF claim.inbox_id <> replay.inbox_id THEN RAISE EXCEPTION 'restart duplicate changed event identity'; END IF;
  IF piggyvest_staging.finish_inbox('22222222-2222-4222-8222-222222222222',
    claim.inbox_id, claim.claim_token, 'unsupported', 0) <> 'quarantined' THEN
    RAISE EXCEPTION 'persisted event could not quarantine';
  END IF;
END $$;
SQL

"${psql[@]}" <<'SQL'
SET ROLE inbox_test_worker;
DO $$
BEGIN
  PERFORM piggyvest_staging.enqueue_inbox('33333333-3333-4333-8333-333333333333', 'concurrent', '\x00');
END $$;
SQL

"${psql[@]}" >"$temp_dir/first.log" 2>&1 <<SQL &
BEGIN;
SET ROLE inbox_test_worker;
DO \$\$
BEGIN
  PERFORM inbox_id FROM piggyvest_staging.claim_inbox('33333333-3333-4333-8333-333333333333', 1, 30);
END \$\$;
\! touch '$temp_dir/claimed'
\! for attempt in \$(seq 1 200); do test -f '$temp_dir/release' && exit 0; sleep 0.05; done; exit 1
\if :SHELL_ERROR
\quit 1
\endif
COMMIT;
SQL
first_pid=$!
for attempt in {1..100}; do
  [[ -f "$temp_dir/claimed" ]] && break
  kill -0 "$first_pid" 2>/dev/null || { cat "$temp_dir/first.log"; exit 1; }
  sleep 0.05
done
[[ -f "$temp_dir/claimed" ]] || { cat "$temp_dir/first.log"; exit 1; }
"${psql[@]}" <<'SQL'
SET statement_timeout = '2s';
SET ROLE inbox_test_worker;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_staging.claim_inbox('33333333-3333-4333-8333-333333333333', 1, 30)) THEN
    RAISE EXCEPTION 'concurrent worker claimed locked event';
  END IF;
END $$;
SQL
touch "$temp_dir/release"
wait "$first_pid"
"${psql[@]}" <<'SQL'
DO $$
BEGIN
  IF (SELECT attempts FROM piggyvest_staging.inbox WHERE provider_event_id = 'concurrent') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'concurrent claim must increment attempts exactly once';
  END IF;
END $$;
SQL
printf 'Synthetic private-socket inbox SQL tests passed (restart, replay, two-session claim).\n'
