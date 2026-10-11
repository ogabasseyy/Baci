#!/usr/bin/env bash
# REGRESSION TEST: claim-vs-manual serialization (Codex finding 2).
#
# Phase 1 (mechanism): a session holding the orders row FOR UPDATE —
# exactly what the manager holds for its whole manual transaction —
# must block a concurrent cancellation-claim until it releases; the
# statement timeout proves the wait. The claim-side lock makes this
# serialization explicit at claim start (the side-effect FK's KEY
# SHARE would serialize the late upsert anyway, but an incidental
# lock is not a contract). Either way, a manual that read a missing
# side-effect row can never commit between the worker's ledger read
# and its provider POST, which would double-pay the customer.
#
# Phase 2 (end-to-end): after a full manual commits, the claim must see
# full coverage and finalize instead of claiming the worker branch.
#
# The full run is local-only: it needs the full replayed schema in the
# baci-refund-pg scratch container. It refreshes the functions under
# test from the working tree first, so the proof tracks current code
# rather than scratch age. MINIMAL_PHASE1=1 instead self-provisions a
# throwaway postgres with a minimal fixture (roles, jwt-reading
# auth.role stub, bare orders table) plus the working-tree claim, and
# runs Phase 1 only: the blocking proof needs nothing past the lock
# point, since unreached PL/pgSQL statements never compile. That is
# the mode CI runs — the lock cannot be removed unnoticed — while
# Phase 2's finalize-after-manual stays covered replay-natively by the
# main suite's claim-finalize assertions.
#
# USAGE:
#   bash supabase/tests/run-order-refund-claim-manual-concurrency-test.sh
#   MINIMAL_PHASE1=1 bash supabase/tests/run-order-refund-claim-manual-concurrency-test.sh

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Connection overrides keep CI (supabase start defaults) and local
# scratch on the same runner: only the port usually differs.
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55433}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}" PGDATABASE="${PGDATABASE:-postgres}"

OWNER_ID=9ef40000-0000-4000-8000-000000000001
MANAGER_ID=9ef40000-0000-4000-8000-000000000002
MERCHANT_ID=9ef40100-0000-4000-8000-000000000001
ORDER_ID=9ef41000-0000-4000-8000-000000000001
PAYMENT_ID=9ef42000-0000-4000-8000-000000000001
HOLD_MARKER=/tmp/order-refund-claim-race-holding

minimal_container="baci-refund-race-ci-$$"

cleanup() {
  if [ "${MINIMAL_PHASE1:-0}" = '1' ]; then
    docker rm -f "$minimal_container" >/dev/null 2>&1 || true
  fi
  psql -X -q -v ON_ERROR_STOP=0 <<'SQL' >/dev/null 2>&1 || true
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
DELETE FROM public.order_refund_events WHERE order_id = '9ef41000-0000-4000-8000-000000000001';
DELETE FROM public.paystack_cancellation_refund_notifications WHERE order_id = '9ef41000-0000-4000-8000-000000000001';
DELETE FROM public.transactions WHERE order_id = '9ef41000-0000-4000-8000-000000000001';
DELETE FROM public.order_cancellation_side_effects WHERE order_id = '9ef41000-0000-4000-8000-000000000001';
DELETE FROM public.orders WHERE id = '9ef41000-0000-4000-8000-000000000001';
DELETE FROM public.staff_members WHERE merchant_id = '9ef40100-0000-4000-8000-000000000001';
DELETE FROM public.merchants WHERE id = '9ef40100-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '9ef40000-0000-4000-8000-000000000001',
  '9ef40000-0000-4000-8000-000000000002');
SQL
  rm -f "$HOLD_MARKER"
}
trap cleanup EXIT

if [ "${MINIMAL_PHASE1:-0}" = '1' ]; then
  # Self-provisioned throwaway postgres (CI mode): the Phase-1
  # blocking proof only reaches the claim's role gate and its
  # orders-row lock, so a bare orders table plus the working-tree
  # claim file is the whole closure. The auth.role stub reads the
  # JWT claim like the platform function (current_user would see
  # the definer, not the caller, inside SECURITY DEFINER).
  docker run --name "$minimal_container" -e POSTGRES_PASSWORD=postgres \
    -d -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
  PGPORT="$(docker port "$minimal_container" 5432 | head -n 1 | cut -d: -f2)"
  export PGPORT
  for _ in $(seq 1 60); do
    if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
    echo 'minimal postgres did not become ready' >&2
    docker logs "$minimal_container" >&2 || true
    exit 1
  fi
  psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT current_setting('request.jwt.claim.role', true) $$;
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  shipping_status text,
  cancelled_at timestamptz
);
SQL
  psql -X -q -v ON_ERROR_STOP=1 \
    -f "$repo_root/supabase/migrations/20261010180000_count_manual_refund_coverage_in_claim.sql"
  psql -X -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.orders (id, merchant_id, shipping_status, cancelled_at)
VALUES ('$ORDER_ID', '$MERCHANT_ID', 'cancelled', now());
SQL
else
  if ! pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
    echo "target postgres is not reachable on $PGHOST:$PGPORT" >&2
    exit 1
  fi
fi

# Full mode only below: the minimal fixture is already current (the
# claim file applied fresh above) and seeded with its single row.
if [ "${MINIMAL_PHASE1:-0}" != '1' ]; then
# Functions under test, refreshed from the working tree (all files are
# CREATE OR REPLACE plus grants, safe to re-apply onto scratch).
# SKIP_REFRESH=1 keeps scratch as-is (negative-control runs).
if [ "${SKIP_REFRESH:-0}" != '1' ]; then
  psql -X -q -v ON_ERROR_STOP=1 \
    -f "$repo_root/supabase/migrations/20261002090100_order_refund_coverage.sql" \
    -f "$repo_root/supabase/migrations/20261002090200_order_refund_record_helpers.sql" \
    -f "$repo_root/supabase/migrations/20261002090250_order_refund_response.sql" \
    -f "$repo_root/supabase/migrations/20261002090300_order_refund_manage.sql" \
    -f "$repo_root/supabase/migrations/20261010180000_count_manual_refund_coverage_in_claim.sql"
fi

cleanup

# Seed: one paid cancelled order with a single Paystack leg and NO
# side-effect row — the race case, where the manual guard reads NULL
# and holds no row lock. Service-role JWT context first, mirroring the
# main suite's fixture setup (the merchants audit trigger needs it).
psql -X -q -v ON_ERROR_STOP=1 <<SQL
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('$OWNER_ID', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'race-owner@example.test', 'test',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('$MANAGER_ID', '00000000-0000-0000-8000-000000000000',
    'authenticated', 'authenticated', 'race-manager@example.test', 'test',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES ('$MERCHANT_ID', '$OWNER_ID', 'race-owner@example.test',
  'Race Fixture', 'race-fixture');
INSERT INTO public.staff_members (
  merchant_id, user_id, email, name, role, permissions, status
) VALUES ('$MERCHANT_ID', '$MANAGER_ID', 'race-manager@example.test',
  'Race Manager', 'accountant', '{"orders":{"refund":true}}'::jsonb, 'active');
INSERT INTO public.orders (
  id, merchant_id, order_number, total, amount_paid,
  payment_status, shipping_status, cancelled_at
) VALUES ('$ORDER_ID', '$MERCHANT_ID', 'RACE-001',
  100, 100, 'paid', 'cancelled', now());
INSERT INTO public.transactions (
  id, merchant_id, order_id, transaction_type, amount, currency,
  status, gateway, gateway_reference, metadata
) VALUES ('$PAYMENT_ID', '$MERCHANT_ID', '$ORDER_ID', 'payment', 100, 'NGN',
  'completed', 'paystack', 'race-1', '{}'::jsonb);
SQL
fi # MINIMAL_PHASE1 full-seed skip

rm -f "$HOLD_MARKER"

# Phase 1: hold the orders row FOR UPDATE (the manager's whole-manual
# lock) while the claim attempts to run.
psql -X -q -v ON_ERROR_STOP=1 <<SQL >/tmp/order-refund-claim-race-a.log 2>&1 &
BEGIN;
SELECT merchant_id FROM public.orders WHERE id = '$ORDER_ID' FOR UPDATE;
\! touch $HOLD_MARKER
SELECT pg_sleep(12);
ROLLBACK;
SQL
session_a=$!

# Wait until the lock is held (generous bound; the SELECT is ms-scale).
for _ in $(seq 1 30); do
  if [ -f "$HOLD_MARKER" ]; then break; fi
  sleep 0.5
done
if [ ! -f "$HOLD_MARKER" ]; then
  echo 'lock-holding session never reached its hold point' >&2
  wait "$session_a" || true
  tail -5 /tmp/order-refund-claim-race-a.log >&2 || true
  exit 1
fi

# The claim must BLOCK on the held orders lock (statement timeout
# proves it waited); slipping through means the double-pay race is
# open (no shared lock between the claim and the manual path).
if psql -X -q -v ON_ERROR_STOP=1 \
  -c "SET statement_timeout = '4s'" \
  -c "SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', false)" \
  -c "SET ROLE service_role" \
  -c "SELECT * FROM public.claim_order_cancellation_side_effect('$ORDER_ID', 'refund', gen_random_uuid())" \
  >/tmp/order-refund-claim-race-b.log 2>&1; then
  echo 'claim slipped through a held orders lock (double-pay race open)' >&2
  cat /tmp/order-refund-claim-race-b.log >&2
  wait "$session_a" || true
  exit 1
fi
# Match the timeout precisely: Postgres reports 'canceling statement
# due to statement timeout'. A bare 'cancel' would also match the
# function's own name in CONTEXT lines
# (claim_order_cancellation_side_effect), misclassifying every error
# — including a lock regression that errors past the lock point in
# the minimal fixture — as a successful block.
if ! grep -qi 'statement timeout' /tmp/order-refund-claim-race-b.log; then
  echo 'claim failed without blocking (unexpected error):' >&2
  cat /tmp/order-refund-claim-race-b.log >&2
  wait "$session_a" || true
  exit 1
fi

wait "$session_a"

if [ "${MINIMAL_PHASE1:-0}" = '1' ]; then
  echo 'Order-refund claim/manual Phase-1 serialization PostgreSQL test passed'
  exit 0
fi

# Phase 2: record a full manual for real, then the claim must see full
# coverage and finalize — never claim the worker branch under money.
psql -X -q -v ON_ERROR_STOP=1 <<SQL >/dev/null
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', false);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '$MANAGER_ID', false);
SET ROLE authenticated;
SELECT public.manage_order_refund('$ORDER_ID', 'manual', 100,
  '2026-09-28T12:00:00Z', 'bank_transfer', 'race-1', NULL, true);
SQL

# Finalization reports we_won=false (no worker claim won), matching
# the main suite's status-only assertion on finalized claims.
claim_out=$(psql -X -t -A -v ON_ERROR_STOP=1 \
  -c "SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', false)" \
  -c "SET ROLE service_role" \
  -c "SELECT we_won, current_status FROM public.claim_order_cancellation_side_effect('$ORDER_ID', 'refund', gen_random_uuid())" | tail -n 1)
if [ "$claim_out" != 'f|completed' ]; then
  echo "post-manual claim finalized as '$claim_out', want 'f|completed'" >&2
  exit 1
fi

echo 'Order-refund claim/manual concurrency PostgreSQL test passed'
