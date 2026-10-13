#!/usr/bin/env bash
set -euo pipefail

while read -r variable; do unset "$variable"; done < <(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p')
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d /private/tmp/baci-prefunded-treasury.XXXXXX)"

cleanup() {
  if [[ -f "$test_root/data/postmaster.pid" ]]; then
    "$postgres_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT INT TERM
mkdir -m 700 "$test_root/socket"
"$postgres_bin/initdb" -D "$test_root/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55454" -l "$test_root/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$test_root/socket" -p 55454 -U harness_admin -d postgres)

"${psql[@]}" <<'SQL'
CREATE EXTENSION pgcrypto;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE prefunded_worker;
CREATE ROLE prefunded_treasury_ledger_worker;
CREATE ROLE prefunded_treasury_provisioner;
CREATE ROLE prefunded_treasury_verifier;
GRANT prefunded_treasury_ledger_worker TO prefunded_worker;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id));
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id), customer_id uuid NOT NULL REFERENCES public.customers(id), target_amount numeric NOT NULL, current_amount numeric NOT NULL, status text NOT NULL, completed_at timestamptz, cancelled_at timestamptz, spent_at timestamptz);
CREATE TABLE public.customer_saved_payment_methods(id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, provider text NOT NULL, reusable boolean NOT NULL, is_active boolean NOT NULL, disabled_at timestamptz);
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY, expected_provider_account_id text NOT NULL, enabled boolean NOT NULL);
CREATE TABLE piggyvest_staging.wallet_goal_mappings(integration_id uuid NOT NULL, provider_wallet_id text NOT NULL, provider_customer_id text NOT NULL, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, goal_id uuid NOT NULL);
CREATE SCHEMA piggyvest_savings_ledger;
CREATE TABLE piggyvest_savings_ledger.bindings(goal_id uuid PRIMARY KEY, integration_id uuid NOT NULL, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, authorized_login name NOT NULL, enabled boolean NOT NULL, UNIQUE(integration_id, merchant_id, customer_id, goal_id));
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 2000, 0, 'active', NULL, NULL, NULL);
INSERT INTO public.customer_saved_payment_methods VALUES ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'paystack', true, true, NULL);
INSERT INTO piggyvest_staging.integrations VALUES ('40000000-0000-4000-8000-000000000001', 'expected-business', true);
INSERT INTO piggyvest_savings_ledger.bindings VALUES ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'prefunded_worker', true);
INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES ('40000000-0000-4000-8000-000000000001', 'destination-wallet', 'destination-customer', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
SQL

"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/storage.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/storage-functions.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/treasury-storage.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/treasury-functions.sql" >/dev/null
"${psql[@]}" <<'SQL'
CREATE SCHEMA prefunded_treasury_test;
CREATE FUNCTION prefunded_treasury_test.command(sequence integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'operationId', '70000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'),
    'integrationId', '40000000-0000-4000-8000-000000000001',
    'merchantId', '10000000-0000-4000-8000-000000000001',
    'customerId', '20000000-0000-4000-8000-000000000001',
    'goalId', '30000000-0000-4000-8000-000000000001',
    'treasuryBindingId', '50000000-0000-4000-8000-000000000001',
    'requestFingerprint', 'fingerprint-' || lpad(sequence::text, 16, '0'),
    'idempotencyKey', 'idempotency-' || lpad(sequence::text, 16, '0'),
    'savedMethodId', '60000000-0000-4000-8000-000000000001',
    'amountKobo', 10000, 'feeAllowanceKobo', 0, 'currency', 'NGN',
    'collectionReference', 'collection-' || sequence,
    'transferReference', 'transfer-' || sequence,
    'destinationWalletId', 'destination-wallet',
    'destinationCustomerId', 'destination-customer'
  );
$$;
GRANT USAGE ON SCHEMA prefunded_card, prefunded_treasury_test TO prefunded_worker, prefunded_treasury_provisioner, prefunded_treasury_verifier;
GRANT EXECUTE ON FUNCTION prefunded_card.reserve(jsonb) TO prefunded_worker;
GRANT EXECUTE ON FUNCTION prefunded_card.claim_collection(uuid, bigint), prefunded_card.claim_transfer(uuid, bigint), prefunded_card.record_collection(uuid, bigint, text, jsonb), prefunded_card.record_transfer(uuid, bigint, text, jsonb) TO prefunded_worker;
GRANT EXECUTE ON FUNCTION prefunded_card.provision_treasury_identity(uuid, uuid, uuid, text, text, name, bigint) TO prefunded_treasury_provisioner;
GRANT EXECUTE ON FUNCTION prefunded_card.record_treasury_snapshot(uuid, text, bigint, timestamptz, bigint) TO prefunded_treasury_verifier;
GRANT EXECUTE ON FUNCTION prefunded_card.approve_treasury_replenishment(uuid, uuid, text, text, bigint) TO prefunded_treasury_provisioner;
GRANT EXECUTE ON FUNCTION prefunded_card.treasury_reservation_ready(uuid) TO prefunded_worker, prefunded_treasury_provisioner;
SQL

"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/treasury.test.sql"
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/treasury-hardening.test.sql"
"${psql[@]}" >"$test_root/binding-first.log" 2>&1 <<SQL &
BEGIN;
SELECT id FROM prefunded_card.treasury_bindings
  WHERE id='50000000-0000-4000-8000-000000000001' FOR UPDATE;
\\! touch '$test_root/binding-locked'
\\! while test ! -f '$test_root/identity-attempt'; do sleep 0.02; done
SELECT treasury_binding_id FROM prefunded_card.treasury_identities
  WHERE treasury_binding_id='50000000-0000-4000-8000-000000000001' FOR SHARE;
COMMIT;
SQL
binding_first_pid=$!
for attempt in {1..100}; do [[ -f "$test_root/binding-locked" ]] && break; sleep 0.02; done
[[ -f "$test_root/binding-locked" ]]
"${psql[@]}" -Atc "SET SESSION AUTHORIZATION prefunded_treasury_verifier; SELECT prefunded_card.record_treasury_snapshot('50000000-0000-4000-8000-000000000001','snapshot-0004',4,clock_timestamp(),60000)" >"$test_root/refresh-lock-order.log" 2>&1 &
refresh_lock_pid=$!
lock_observed=false
for attempt in {1..100}; do
  if [[ "$("${psql[@]}" -Atc "SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%record_treasury_snapshot%'")" -ge 1 ]]; then
    lock_observed=true
    break
  fi
  sleep 0.02
done
[[ "$lock_observed" == true ]]
touch "$test_root/identity-attempt"
wait "$binding_first_pid"
wait "$refresh_lock_pid"
grep -qx recorded "$test_root/refresh-lock-order.log"
"${psql[@]}" -Atc "SET SESSION AUTHORIZATION prefunded_worker; SELECT prefunded_card.reserve(prefunded_treasury_test.command(2))->>'outcome'" >"$test_root/reserve-race.log" &
reserve_pid=$!
"${psql[@]}" -Atc "SET SESSION AUTHORIZATION prefunded_treasury_verifier; SELECT prefunded_card.record_treasury_snapshot('50000000-0000-4000-8000-000000000001','snapshot-0005',5,clock_timestamp(),60000)" >"$test_root/refresh-race.log" &
refresh_pid=$!
wait "$reserve_pid"
wait "$refresh_pid"
grep -qx reserved "$test_root/reserve-race.log"
grep -qx recorded "$test_root/refresh-race.log"
"${psql[@]}" -c "SELECT prefunded_treasury_test.assert((SELECT reserved_kobo=20000 FROM prefunded_card.treasury_bindings),'concurrent reserve and refresh serialize on the treasury binding')"
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/treasury-budget.test.sql"
printf 'PASS disposable prefunded treasury provisioning and refresh tests\n'
