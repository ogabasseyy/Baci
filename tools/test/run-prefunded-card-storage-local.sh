#!/usr/bin/env bash
set -euo pipefail
while read -r variable; do unset "$variable"; done < <(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p')

postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d /tmp/baci-prefunded-card.XXXXXX)"
cleanup() {
  if [[ -f "$test_root/data/postmaster.pid" ]] && ! "$postgres_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1; then
    printf 'Could not stop test cluster; retaining %s\n' "$test_root" >&2
    return
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 "$test_root/socket"
"$postgres_bin/initdb" -D "$test_root/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55453" -l "$test_root/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$test_root/socket" -p 55453 -U harness_admin -d postgres)
"${psql[@]}" <<'SQL'
CREATE EXTENSION pgcrypto;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE prefunded_worker;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES public.merchants(id));
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES public.merchants(id),customer_id uuid NOT NULL REFERENCES public.customers(id),target_amount numeric NOT NULL,current_amount numeric NOT NULL,status text NOT NULL,completed_at timestamptz,cancelled_at timestamptz,spent_at timestamptz);
CREATE TABLE public.customer_saved_payment_methods(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,customer_id uuid NOT NULL,provider text NOT NULL,reusable boolean NOT NULL,is_active boolean NOT NULL,disabled_at timestamptz);
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,expected_provider_account_id text NOT NULL,enabled boolean NOT NULL);
CREATE TABLE piggyvest_staging.wallet_goal_mappings(integration_id uuid NOT NULL,provider_wallet_id text NOT NULL,provider_customer_id text NOT NULL,merchant_id uuid NOT NULL,customer_id uuid NOT NULL,goal_id uuid NOT NULL);
CREATE SCHEMA piggyvest_savings_ledger;
CREATE TABLE piggyvest_savings_ledger.bindings(goal_id uuid PRIMARY KEY,integration_id uuid NOT NULL,merchant_id uuid NOT NULL,customer_id uuid NOT NULL,authorized_login name NOT NULL,enabled boolean NOT NULL,UNIQUE(integration_id,merchant_id,customer_id,goal_id));
INSERT INTO public.merchants VALUES('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_saved_payment_methods VALUES('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paystack',true,true,NULL);
INSERT INTO public.customer_savings_goals VALUES
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1000,0,'active',NULL,NULL,NULL),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1000,0,'active',NULL,NULL,NULL);
INSERT INTO piggyvest_staging.integrations VALUES('40000000-0000-4000-8000-000000000001','expected-business',true);
INSERT INTO piggyvest_savings_ledger.bindings VALUES
('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','harness_admin',true),
('30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','harness_admin',true);
INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES
('40000000-0000-4000-8000-000000000001','destination-wallet','destination-customer','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),
('40000000-0000-4000-8000-000000000001','destination-wallet-2','destination-customer-2','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
SQL
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/storage.sql" >/dev/null
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/storage-functions.sql" >/dev/null
"${psql[@]}" -c "INSERT INTO prefunded_card.treasury_bindings VALUES ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','expected-business','source-wallet','NGN',50000,0,0,clock_timestamp(),'harness_admin',true)" >/dev/null
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/storage.test.sql"
"${psql[@]}" >"$test_root/locker.log" 2>&1 <<SQL &
BEGIN;
SELECT id FROM prefunded_card.treasury_bindings WHERE id='50000000-0000-4000-8000-000000000001' FOR UPDATE;
\\! touch '$test_root/locked'
\\! while test ! -f '$test_root/release'; do sleep 0.02; done
COMMIT;
SQL
locker_pid=$!
for _ in {1..100}; do [[ -f "$test_root/locked" ]] && break; sleep 0.02; done
[[ -f "$test_root/locked" ]]
if "${psql[@]}" -v ON_ERROR_STOP=1 -c "SET statement_timeout='100ms'; SELECT prefunded_card.reserve(prefunded_card_test.command3());" >/dev/null 2>&1; then
  echo 'expected treasury serialization lock' >&2; exit 1
fi
touch "$test_root/release"
wait "$locker_pid"
"${psql[@]}" -c "SELECT prefunded_card.reserve(prefunded_card_test.command3())" >/dev/null
"${psql[@]}" -c "SELECT prefunded_card_test.assert((SELECT reserved_kobo=30000 FROM prefunded_card.treasury_bindings),'concurrent reservations serialize on treasury binding')"
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/storage-adversarial.test.sql"
for prerequisite in ledger registry method goal; do
  case "$prerequisite" in
    ledger) mutation='UPDATE piggyvest_savings_ledger.bindings SET enabled=false';;
    registry) mutation='UPDATE piggyvest_staging.integrations SET enabled=false';;
    method) mutation='UPDATE public.customer_saved_payment_methods SET is_active=false';;
    goal) mutation="UPDATE public.customer_savings_goals SET status='cancelled'";;
  esac
  "${psql[@]}" >"$test_root/$prerequisite-lock.log" 2>&1 <<SQL &
BEGIN;
$mutation;
\\! touch '$test_root/$prerequisite-locked'
\\! while test ! -f '$test_root/$prerequisite-release'; do sleep 0.02; done
ROLLBACK;
SQL
  locker_pid=$!
  for attempt in {1..100}; do [[ -f "$test_root/$prerequisite-locked" ]] && break; sleep 0.02; done
  [[ -f "$test_root/$prerequisite-locked" ]]
  if "${psql[@]}" -c "SET statement_timeout='100ms'; SELECT prefunded_card.claim_collection('70000000-0000-4000-8000-000000000003',0)" >"$test_root/$prerequisite-claim.log" 2>&1; then
    echo "claim raced past locked $prerequisite revocation" >&2; exit 1
  fi
  grep -q 'statement timeout' "$test_root/$prerequisite-claim.log"
  touch "$test_root/$prerequisite-release"
  wait "$locker_pid"
done
race_pids=()
for attempt in {1..8}; do
  "${psql[@]}" -Atc "SET statement_timeout='5s'; SELECT prefunded_card.reserve(prefunded_card_test.command_for(4))->>'outcome'" > "$test_root/race-$attempt.log" 2>&1 &
  race_pids+=("$!")
done
for process in "${race_pids[@]}"; do wait "$process"; done
for attempt in {1..8}; do grep -qx reserved "$test_root/race-$attempt.log"; done
"${psql[@]}" -c "SELECT prefunded_card_test.assert((SELECT count(*)=4 FROM prefunded_card.operations),'same-key race makes one operation'); SELECT prefunded_card_test.assert((SELECT reserved_kobo=31000 FROM prefunded_card.treasury_bindings),'same-key race reserves once')"
"$postgres_bin/pg_ctl" -D "$test_root/data" -m fast restart -o "-k '$test_root/socket' -h '' -p 55453" >/dev/null
"${psql[@]}" -c "SELECT prefunded_card_test.assert((SELECT count(*)=4 FROM prefunded_card.operations),'durable across restart')"
printf 'PASS disposable prefunded card reservation, fencing, scope and restart tests\n'
