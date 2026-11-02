-- REGRESSION TEST: two concurrent apply_requested_b_effects passes apply a
-- requested B effect exactly once (two live dblink sessions).
--
-- Backend A applies the request and holds its row lock uncommitted while
-- backend B runs the same pass. B must not apply it a second time, whether it
-- skips the locked row or waits for A; after A commits, further passes apply
-- nothing and B (the customer_wallets balance) moved once.
--
-- The fixtures must be committed for the second backend to see them; they
-- use their own ids and are removed at the end (the append-only guards are
-- disabled for that cleanup only, by the table owner running this suite).
--
-- Auth: pass -v dblink_password=... for a non-default local DB (the default
-- is the supabase-local scratch password). dblink is dropped at the end only
-- if this file created it.

\set ON_ERROR_STOP on

\if :{?dblink_password}
\else
\set dblink_password postgres
\endif

SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'dblink') AS engine_had_dblink \gset

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT dblink_connect('engine_race_a', format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  inet_server_addr(), inet_server_port(), current_database(), current_user, :'dblink_password'));
SELECT dblink_connect('engine_race_b', format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  inet_server_addr(), inet_server_port(), current_database(), current_user, :'dblink_password'));

BEGIN;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES ('e5e10000-0000-4000-8000-000000000001');
INSERT INTO public.merchants(id, email) VALUES ('e5e10000-0000-4000-8000-000000000002', 'engine-race@example.com');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('e5e10000-0000-4000-8000-000000000003', 'e5e10000-0000-4000-8000-000000000002', 'e5e10000-0000-4000-8000-000000000001');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('e5e10000-0000-4000-8000-000000000005', 'e5e10000-0000-4000-8000-000000000002',
    'engine-race-business', 'staging', 'engine_race_fixture_executor', true);
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES ('e5e10000-0000-4000-8000-000000000006', 'e5e10000-0000-4000-8000-000000000005',
    'e5e10000-0000-4000-8000-000000000002', 'e5e10000-0000-4000-8000-000000000003',
    'e5e10000-0000-4000-8000-000000000001', repeat('f', 64), 'verified', 'pv-race-customer', 'pv-race-main');
INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency, enabled,
  verified_at)
  VALUES ('e5e10000-0000-4000-8000-000000000005', 'collection', 'pv-race-collection', 'engine-race-business', 'NGN',
    true, TIMESTAMPTZ '2026-10-31 00:00:00+00');
INSERT INTO piggyvest_primary.transfer_authorities(integration_id, capability, executor_login, enabled)
  VALUES ('e5e10000-0000-4000-8000-000000000005', 'worker', current_user, true);
INSERT INTO public.customer_wallets(id, customer_id, merchant_id, available_balance)
  VALUES ('e5e10000-0000-4000-8000-000000000030', 'e5e10000-0000-4000-8000-000000000003',
    'e5e10000-0000-4000-8000-000000000002', 500.00);
INSERT INTO piggyvest_primary.wallet_transfers(id, integration_id, kind, source_role, destination_role, purpose,
  delivery_mode, source_ref, customer_id, amount_kobo, state)
  VALUES ('e5e10000-0000-4000-8000-000000000040', 'e5e10000-0000-4000-8000-000000000005', 'disbursement',
    'collection', 'main', 'obligation', 'credit_main', 'race-obligation', 'e5e10000-0000-4000-8000-000000000003',
    2500, 'ready');
INSERT INTO piggyvest_primary.wallet_transfer_attempts(id, transfer_id, attempt, reference, amount_kobo)
  VALUES ('e5e10000-0000-4000-8000-000000000041', 'e5e10000-0000-4000-8000-000000000040', 1,
    'pvb-wt-e5e10000-0000-4000-8000-000000000040-1', 2500);
UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'dispatching'
  WHERE id = 'e5e10000-0000-4000-8000-000000000041';
UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'confirmed', proof = '{"status":"successful"}',
  provider_transaction_id = 'pv-race-txn', fee_kobo = 0 WHERE id = 'e5e10000-0000-4000-8000-000000000041';
UPDATE piggyvest_primary.wallet_transfers SET state = 'confirmed' WHERE id = 'e5e10000-0000-4000-8000-000000000040';
SELECT piggyvest_primary.request_b_effect('e5e10000-0000-4000-8000-000000000040', 'confirm_credit', 2500)
  AS race_request \gset
COMMIT;

CREATE FUNCTION pg_temp.race_check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'engine race: %', p_message; END IF;
END $$;

SELECT pg_temp.race_check(:'race_request' = 'requested', 'the API-less setup session must only request the credit');

-- Backend A applies and keeps its transaction open.
SELECT dblink_exec('engine_race_a', 'BEGIN');
SELECT dblink_exec('engine_race_a', 'SET LOCAL ROLE piggyvest_primary_transfer_worker');
DO $race$
DECLARE
  v_applied integer;
  v_spins integer := 0;
BEGIN
  SELECT applied INTO v_applied
    FROM dblink('engine_race_a', 'SELECT piggyvest_primary.apply_requested_b_effects(10)') AS a(applied integer);
  IF v_applied IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'backend A must apply the request, got %', v_applied; END IF;
  PERFORM dblink_exec('engine_race_b', 'SET ROLE piggyvest_primary_transfer_worker');
  PERFORM dblink_send_query('engine_race_b', 'SELECT piggyvest_primary.apply_requested_b_effects(10)');
  PERFORM pg_sleep(0.3);
  PERFORM dblink_exec('engine_race_a', 'COMMIT');
  WHILE dblink_is_busy('engine_race_b') = 1 AND v_spins < 200 LOOP
    PERFORM pg_sleep(0.05);
    v_spins := v_spins + 1;
  END LOOP;
  IF dblink_is_busy('engine_race_b') = 1 THEN RAISE EXCEPTION 'backend B never finished its pass'; END IF;
  SELECT applied INTO v_applied FROM dblink_get_result('engine_race_b') AS b(applied integer);
  IF v_applied IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'backend B must not apply it again, got %', v_applied; END IF;
  PERFORM * FROM dblink_get_result('engine_race_b') AS done(applied integer);
  SELECT applied INTO v_applied
    FROM dblink('engine_race_b', 'SELECT piggyvest_primary.apply_requested_b_effects(10)') AS c(applied integer);
  IF v_applied IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a later pass must apply nothing, got %', v_applied; END IF;
  IF (SELECT available_balance FROM public.customer_wallets
      WHERE customer_id = 'e5e10000-0000-4000-8000-000000000003') IS DISTINCT FROM 525.00
    OR (SELECT count(*) FROM public.customer_wallet_transactions
      WHERE customer_id = 'e5e10000-0000-4000-8000-000000000003') <> 1
    OR (SELECT state FROM piggyvest_primary.transfer_b_effects
      WHERE transfer_id = 'e5e10000-0000-4000-8000-000000000040') <> 'applied' THEN
    RAISE EXCEPTION 'the requested credit must be written exactly once';
  END IF;
END
$race$;

SELECT dblink_disconnect('engine_race_a');
SELECT dblink_disconnect('engine_race_b');

BEGIN;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
ALTER TABLE piggyvest_primary.transfer_b_effects DISABLE TRIGGER transfer_b_effects_guard;
ALTER TABLE piggyvest_primary.wallet_transfers DISABLE TRIGGER wallet_transfers_guard;
ALTER TABLE piggyvest_primary.house_wallets DISABLE TRIGGER house_wallets_guard;
ALTER TABLE piggyvest_primary.wallet_transfer_attempts DISABLE TRIGGER wallet_transfer_attempts_guard;
DELETE FROM piggyvest_primary.transfer_b_effects WHERE transfer_id = 'e5e10000-0000-4000-8000-000000000040';
DELETE FROM piggyvest_primary.wallet_transfer_attempts WHERE transfer_id = 'e5e10000-0000-4000-8000-000000000040';
DELETE FROM piggyvest_primary.wallet_transfers WHERE id = 'e5e10000-0000-4000-8000-000000000040';
DELETE FROM piggyvest_primary.house_wallets WHERE integration_id = 'e5e10000-0000-4000-8000-000000000005';
ALTER TABLE piggyvest_primary.transfer_b_effects ENABLE TRIGGER transfer_b_effects_guard;
ALTER TABLE piggyvest_primary.wallet_transfers ENABLE TRIGGER wallet_transfers_guard;
ALTER TABLE piggyvest_primary.house_wallets ENABLE TRIGGER house_wallets_guard;
ALTER TABLE piggyvest_primary.wallet_transfer_attempts ENABLE TRIGGER wallet_transfer_attempts_guard;
DELETE FROM piggyvest_primary.transfer_authorities WHERE integration_id = 'e5e10000-0000-4000-8000-000000000005';
DELETE FROM public.customer_wallets WHERE customer_id = 'e5e10000-0000-4000-8000-000000000003';
DELETE FROM piggyvest_primary.onboarding_intents WHERE id = 'e5e10000-0000-4000-8000-000000000006';
DELETE FROM piggyvest_primary.integrations WHERE id = 'e5e10000-0000-4000-8000-000000000005';
DELETE FROM public.customers WHERE id = 'e5e10000-0000-4000-8000-000000000003';
DELETE FROM public.merchants WHERE id = 'e5e10000-0000-4000-8000-000000000002';
DELETE FROM auth.users WHERE id = 'e5e10000-0000-4000-8000-000000000001';
COMMIT;

\if :engine_had_dblink
\else
DROP EXTENSION dblink;
\endif
