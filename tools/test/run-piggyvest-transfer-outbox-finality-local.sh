#!/usr/bin/env bash
set -euo pipefail

while IFS='=' read -r name _; do
  case "$name" in
    PG*) unset "$name" ;;
  esac
done < <(env)

PG_BIN=/opt/homebrew/opt/postgresql@18/bin
TMP_ROOT=/private/tmp
CLUSTER_ROOT=$(mktemp -d "${TMP_ROOT%/}/baci-piggyvest-outflow-finality.XXXXXX")
SOCKET_DIR="$CLUSTER_ROOT/socket"
PORT=55479
DATABASE=piggyvest_outflow_finality_local

psql_as() {
  local role=$1
  shift
  "$PG_BIN/psql" -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U "$role" -d "$DATABASE" "$@"
}

start_server() {
  if ! "$PG_BIN/pg_ctl" -D "$CLUSTER_ROOT/data" -l "$CLUSTER_ROOT/postgres.log" -o "-c listen_addresses='' -k $SOCKET_DIR -p $PORT" -w start >/dev/null; then
    cat "$CLUSTER_ROOT/postgres.log" >&2
    exit 1
  fi
}

cleanup() {
  if [ -f "$CLUSTER_ROOT/data/postmaster.pid" ]; then
    "$PG_BIN/pg_ctl" -D "$CLUSTER_ROOT/data" -m fast -w stop >/dev/null || true
  fi
  case "$CLUSTER_ROOT" in
    "${TMP_ROOT%/}"/baci-piggyvest-outflow-finality.*)
      rm -rf "$CLUSTER_ROOT"
      ;;
    *)
      printf '%s\n' "refusing to clean an unexpected path: $CLUSTER_ROOT" >&2
      ;;
  esac
}

for binary in initdb pg_ctl createdb psql; do
  if [ ! -x "$PG_BIN/$binary" ]; then
    printf '%s\n' "missing PostgreSQL binary: $PG_BIN/$binary" >&2
    exit 1
  fi
done

trap cleanup EXIT HUP INT TERM
mkdir "$SOCKET_DIR"
"$PG_BIN/initdb" -D "$CLUSTER_ROOT/data" -U baci --auth=trust --no-locale >/dev/null
start_server
"$PG_BIN/createdb" -h "$SOCKET_DIR" -p "$PORT" -U baci "$DATABASE"

psql_as baci -c "CREATE ROLE piggyvest_staging_ledger_worker LOGIN NOINHERIT NOSUPERUSER; CREATE ROLE piggyvest_staging_submission_writer LOGIN NOINHERIT NOSUPERUSER; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role LOGIN BYPASSRLS;" >/dev/null
psql_as baci -f supabase/migrations/20260918150000_piggyvest_transfer_outbox.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110000_piggyvest_transfer_outbox_finality.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110100_piggyvest_transfer_outbox_finality_grants.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110200_piggyvest_transfer_outbox_finality_scope_guard.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110300_piggyvest_transfer_outbox_submission.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110400_piggyvest_transfer_outbox_submission_functions.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110500_piggyvest_transfer_outbox_submission_recovery.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110600_piggyvest_transfer_outbox_scoped_lookup.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110700_piggyvest_transfer_outbox_submission_writer_guard.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110800_piggyvest_transfer_submission_claim_correction.sql >/dev/null
psql_as baci -f supabase/migrations/20260926110900_piggyvest_transfer_submission_claimed_recovery.sql >/dev/null
psql_as baci -c "GRANT USAGE ON SCHEMA public TO piggyvest_staging_ledger_worker, piggyvest_staging_submission_writer, service_role; GRANT SELECT, INSERT, UPDATE ON public.piggyvest_transfer_outbox TO service_role;" >/dev/null
psql_as baci -f supabase/migrations/tests/piggyvest_transfer_outbox_finality.sql
psql_as service_role -f supabase/migrations/tests/piggyvest_transfer_outbox_finality_service_role.sql
psql_as baci -f supabase/migrations/tests/piggyvest_transfer_outbox_submission.sql
psql_as baci -f supabase/migrations/tests/piggyvest_transfer_outbox_submission_claimed_recovery.sql
psql_as baci -f supabase/migrations/tests/piggyvest_transfer_outbox_scoped_lookup.sql

SYSTEM_ID=$(psql_as baci -Atq -c "SELECT system_identifier::text FROM pg_catalog.pg_control_system()")
psql_as baci -c "INSERT INTO public.piggyvest_transfer_submission_authorizations (id, reference, customer_id, merchant_id, wallet_id, amount_kobo, currency, source_wallet_id, destination_ref, direction, provider_customer_id, business_id, integration_id, expires_at) VALUES ('a0065070-dc32-45d2-9c01-871a27abfd11', 'submission-harness-race-001', 'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82', 'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank', 'provider-customer-001', 'business-001', 'integration-001', now() + interval '1 day');" >/dev/null
(psql_as piggyvest_staging_submission_writer -Atq -c "BEGIN; SELECT public.claim_piggyvest_transfer_outbox_submission('$SYSTEM_ID', 'a0065070-dc32-45d2-9c01-871a27abfd11', 'submission-harness-race-001', 'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82', 'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank', 'provider-customer-001', 'business-001', 'integration-001'); SELECT pg_sleep(1); COMMIT;" >"$CLUSTER_ROOT/submission-race-first") &
SUBMISSION_FIRST_PID=$!
sleep 0.2
psql_as piggyvest_staging_submission_writer -Atq -c "BEGIN; SELECT public.claim_piggyvest_transfer_outbox_submission('$SYSTEM_ID', 'a0065070-dc32-45d2-9c01-871a27abfd11', 'submission-harness-race-001', 'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82', 'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank', 'provider-customer-001', 'business-001', 'integration-001'); COMMIT;" >"$CLUSTER_ROOT/submission-race-second"
wait "$SUBMISSION_FIRST_PID"

if [ "$(tr -d '\n' < "$CLUSTER_ROOT/submission-race-first")" != 'claimed' ] || [ "$(tr -d '\n' < "$CLUSTER_ROOT/submission-race-second")" != 'already-claimed' ]; then
  printf '%s\n' 'submission claim race did not preserve the first claim' >&2
  exit 1
fi

psql_as baci -c "INSERT INTO public.piggyvest_transfer_outbox (reference, customer_id, merchant_id, wallet_id, amount_kobo, direction, destination_ref, currency, source_wallet_id, provider_customer_id, business_id, integration_id) VALUES ('finality-harness-race-001', 'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82', 'legacy-source-wallet', 500000, 'bank', '058:6789', 'NGN', 'source-wallet-001', 'provider-customer-001', 'business-001', 'integration-001');" >/dev/null
(psql_as piggyvest_staging_ledger_worker -Atq -c "BEGIN; SELECT public.apply_piggyvest_transfer_outbox_finality('$SYSTEM_ID', 'finality-harness-race-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank', 'provider-customer-001', 'business-001', 'integration-001', 'provider-transaction-001', 'succeeded'); SELECT pg_sleep(1); COMMIT;" >"$CLUSTER_ROOT/race-first") &
FIRST_PID=$!
sleep 0.2
psql_as piggyvest_staging_ledger_worker -Atq -c "BEGIN; SELECT public.apply_piggyvest_transfer_outbox_finality('$SYSTEM_ID', 'finality-harness-race-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank', 'provider-customer-001', 'business-001', 'integration-001', 'provider-transaction-002', 'failed'); COMMIT;" >"$CLUSTER_ROOT/race-second"
wait "$FIRST_PID"

if [ "$(tr -d '\n' < "$CLUSTER_ROOT/race-first")" != 'applied' ]; then
  printf '%s\n' 'first concurrent finality did not apply' >&2
  exit 1
fi
if [ "$(tr -d '\n' < "$CLUSTER_ROOT/race-second")" != 'terminal-conflict' ]; then
  printf '%s\n' 'second concurrent finality did not conflict' >&2
  exit 1
fi

EXPECTED_FINAL=succeeded:provider-transaction-001
FINAL_BEFORE_RESTART=$(psql_as baci -Atq -c "SELECT status || ':' || provider_transaction_id FROM public.piggyvest_transfer_outbox WHERE reference = 'finality-harness-race-001'")
if [ "$FINAL_BEFORE_RESTART" != "$EXPECTED_FINAL" ]; then
  printf '%s\n' "unexpected finality before restart: $FINAL_BEFORE_RESTART" >&2
  exit 1
fi

SUBMISSION_BEFORE_RESTART=$(psql_as baci -Atq -c "SELECT state FROM public.piggyvest_transfer_outbox_submission_claims WHERE reference = 'submission-harness-race-001'")
if [ "$SUBMISSION_BEFORE_RESTART" != 'claimed' ]; then
  printf '%s\n' "unexpected submission claim before restart: $SUBMISSION_BEFORE_RESTART" >&2
  exit 1
fi

"$PG_BIN/pg_ctl" -D "$CLUSTER_ROOT/data" -m fast -w stop >/dev/null
start_server
FINAL_AFTER_RESTART=$(psql_as baci -Atq -c "SELECT status || ':' || provider_transaction_id FROM public.piggyvest_transfer_outbox WHERE reference = 'finality-harness-race-001'")
if [ "$FINAL_AFTER_RESTART" != "$EXPECTED_FINAL" ]; then
  printf '%s\n' "unexpected finality after restart: $FINAL_AFTER_RESTART" >&2
  exit 1
fi

SUBMISSION_AFTER_RESTART=$(psql_as baci -Atq -c "SELECT state FROM public.piggyvest_transfer_outbox_submission_claims WHERE reference = 'submission-harness-race-001'")
if [ "$SUBMISSION_AFTER_RESTART" != 'claimed' ]; then
  printf '%s\n' "unexpected submission claim after restart: $SUBMISSION_AFTER_RESTART" >&2
  exit 1
fi

printf '%s\n' 'PiggyVest transfer outbox finality local harness passed'
