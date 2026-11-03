-- Shared fixture for the goal complete behaviour suites (migration
-- 20261103181737_piggyvest_goal_complete_purchase_request). Included with \ir by each
-- piggyvest_goal_complete_*.sql suite, never run on its own: it opens the
-- transaction the including suite rolls back.
--
-- Synthetic, transaction-local data. Proofs are written directly as owner rows
-- with label-derived test tokens (no PIN is typed, so no pepper or attestation
-- is involved); the spend point under test reads them like real ones.
BEGIN;

UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.savings_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;

INSERT INTO auth.users (id, email) VALUES
  ('f3870000-0000-4000-8000-000000000001', 'piggyvest-goalcomplete@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3870000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000001',
   'piggyvest-goalcomplete@example.test', 'PiggyVest Goal Complete Fixture', 'piggyvest-goalcomplete-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3870000-0000-4000-8000-000000000003', 'f3870000-0000-4000-8000-000000000002',
   'f3870000-0000-4000-8000-000000000001', 'piggyvest-goalcomplete-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3870000-0000-4000-8000-000000000004', 'f3870000-0000-4000-8000-000000000002',
   'Synthetic goal complete product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES (
  'f3870000-0000-4000-8000-000000000005', 'f3870000-0000-4000-8000-000000000002',
  'f3870000-0000-4000-8000-000000000003', 'f3870000-0000-4000-8000-000000000004',
  'Synthetic goal complete goal', 10000, 2500, 1000, 'daily', (now() AT TIME ZONE 'UTC')::date - 30, (now() AT TIME ZONE 'UTC')::date,
  'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3870000-0000-4000-8000-000000000006', 'f3870000-0000-4000-8000-000000000002',
  'synthetic-goalcomplete-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f3870000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f3870000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES (
  'f3870000-0000-4000-8000-000000000007', 'f3870000-0000-4000-8000-000000000006',
  'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000003',
  'f3870000-0000-4000-8000-000000000001', repeat('d', 64), 'accepted',
  'synthetic-goalcomplete-customer', 'synthetic-goalcomplete-main');
INSERT INTO piggyvest_primary.savings_destinations (integration_id, goal_id, intent_id, provider_wallet_id, enabled)
VALUES ('f3870000-0000-4000-8000-000000000006', 'f3870000-0000-4000-8000-000000000005',
  'f3870000-0000-4000-8000-000000000007', 'synthetic-goalcomplete-goal-wallet', true);
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  ('f3870000-0000-4000-8000-000000000008', 'f3870000-0000-4000-8000-000000000003',
   'f3870000-0000-4000-8000-000000000002', 1000);
INSERT INTO public.customer_wallet_transactions (
  id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status
) VALUES (
  'f3870000-0000-4000-8000-000000000009', 'f3870000-0000-4000-8000-000000000008',
  'f3870000-0000-4000-8000-000000000003', 'f3870000-0000-4000-8000-000000000002',
  'adjustment', 1000, 1000, 'completed');
INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
VALUES ('f3870000-0000-4000-8000-000000000002', true);
INSERT INTO wallet_pin_private.customer_pins (
  customer_id, user_id, merchant_id, kdf_version, pepper_id, salt, pin_hash)
VALUES (
  'f3870000-0000-4000-8000-000000000003', 'f3870000-0000-4000-8000-000000000001',
  'f3870000-0000-4000-8000-000000000002', 1,
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalcomplete-pepper', 'UTF8')), 1, 8),
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalcomplete-salt', 'UTF8')), 1, 16),
  pg_catalog.sha256(pg_catalog.convert_to('goalcomplete-hash', 'UTF8')));
SELECT set_config('test.gx_scope', jsonb_build_object(
  'merchantId', 'f3870000-0000-4000-8000-000000000002',
  'customerId', 'f3870000-0000-4000-8000-000000000003',
  'userId', 'f3870000-0000-4000-8000-000000000001',
  'integrationId', 'f3870000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-goalcomplete-business', 'environment', 'staging')::text, true);

-- Orders the redemption rows below point at (the redemption foreign key is real).
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'storefront_order_context', 'route',
  'storefront_order_merchant_id', 'f3870000-0000-4000-8000-000000000002')::text, true);
INSERT INTO public.orders (id, merchant_id, customer_id, order_number, total) VALUES
  ('f3870000-0000-4000-8000-0000000000f3', 'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000003', 'GX-SYNTH-F3', 10),
  ('f3870000-0000-4000-8000-0000000000f4', 'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000003', 'GX-SYNTH-F4', 10),
  ('f3870000-0000-4000-8000-0000000000f5', 'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000003', 'GX-SYNTH-F5', 10);
INSERT INTO public.order_items (order_id, product_id, name, price, quantity)
SELECT o.id, 'f3870000-0000-4000-8000-000000000004', 'Synthetic goal complete product', 10, 1
  FROM public.orders AS o WHERE o.merchant_id = 'f3870000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claims', '{}', true);

-- Legacy rows that PREDATE the primary-goal guards can not be written while the
-- goal is bound (that is the point of the guards), and the test role may not
-- switch off triggers, so the binding is lifted around such a write and put
-- back unchanged.
CREATE FUNCTION pg_temp.gx_unbind() RETURNS void LANGUAGE sql AS $$
  DELETE FROM piggyvest_primary.savings_destinations
   WHERE goal_id = 'f3870000-0000-4000-8000-000000000005';
$$;
CREATE FUNCTION pg_temp.gx_bind() RETURNS void LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.savings_destinations (integration_id, goal_id, intent_id, provider_wallet_id, enabled)
  VALUES ('f3870000-0000-4000-8000-000000000006', 'f3870000-0000-4000-8000-000000000005',
    'f3870000-0000-4000-8000-000000000007', 'synthetic-goalcomplete-goal-wallet', true);
$$;

-- The fixture goal is complete-eligible by maturity (maturity date is today).
-- These flip it for the eligibility cases; every change rolls back with the suite.
CREATE FUNCTION pg_temp.gx_set_maturity(p_days integer) RETURNS void LANGUAGE sql AS $$
  UPDATE public.customer_savings_goals SET maturity_date = (now() AT TIME ZONE 'UTC')::date + p_days
   WHERE id = 'f3870000-0000-4000-8000-000000000005';
$$;
CREATE FUNCTION pg_temp.gx_set_current(p_amount numeric) RETURNS void LANGUAGE sql AS $$
  UPDATE public.customer_savings_goals SET current_amount = p_amount
   WHERE id = 'f3870000-0000-4000-8000-000000000005';
$$;

CREATE FUNCTION pg_temp.gx_token(p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_label, 'UTF8')), 'hex');
$$;
CREATE FUNCTION pg_temp.gx_issue(
  p_label text, p_purpose text, p_amount bigint, p_key_text text, p_age_seconds integer DEFAULT 0)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_issued timestamptz := pg_catalog.clock_timestamp() - (p_age_seconds || ' seconds')::interval;
BEGIN
  INSERT INTO wallet_pin_private.proofs (
    token_sha256, customer_id, merchant_id, purpose, amount_kobo,
    idempotency_key_sha256, issued_at, expires_at)
  VALUES (
    pg_catalog.sha256(pg_catalog.decode(pg_temp.gx_token(p_label), 'hex')),
    'f3870000-0000-4000-8000-000000000003', 'f3870000-0000-4000-8000-000000000002',
    p_purpose, p_amount,
    pg_catalog.sha256(pg_catalog.convert_to(p_key_text, 'UTF8')),
    v_issued, v_issued + interval '120 seconds');
  RETURN pg_temp.gx_token(p_label);
END;
$$;
CREATE FUNCTION pg_temp.gx_scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.current_setting('test.gx_scope')::jsonb;
$$;
CREATE FUNCTION pg_temp.gx_issue_op() RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.issue_goal_complete(pg_temp.gx_scope(), 'f3870000-0000-4000-8000-000000000005'::uuid);
$$;
CREATE FUNCTION pg_temp.gx_reserve(p_op text, p_proof text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.reserve_goal_complete_with_pin(pg_temp.gx_scope(),
    pg_catalog.jsonb_build_object('goalId', 'f3870000-0000-4000-8000-000000000005', 'operationId', p_op), p_proof);
$$;
CREATE FUNCTION pg_temp.gx_proof(p_op text, p_status text DEFAULT 'success') RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'operationId', p_op, 'providerTransactionId', 'synthetic-gx-txn-' || p_status || '-' || p_op,
    'reference', (SELECT reference FROM piggyvest_primary.goal_complete_operations WHERE id = p_op::uuid),
    'amountKobo', 250000, 'sourceWalletId', 'synthetic-goalcomplete-goal-wallet',
    'destinationWalletId', 'synthetic-goalcomplete-main', 'businessId', 'synthetic-goalcomplete-business');
$$;
CREATE FUNCTION pg_temp.gx_assert(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'goal complete behaviour: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.gx_state(p_op text) RETURNS text LANGUAGE sql AS $$
  SELECT state FROM piggyvest_primary.goal_complete_operations WHERE id = p_op::uuid;
$$;
CREATE FUNCTION pg_temp.gx_spent(p_label text) RETURNS boolean LANGUAGE sql AS $$
  SELECT consumed_at IS NOT NULL FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gx_token(p_label), 'hex'));
$$;
CREATE FUNCTION pg_temp.gx_key(p_op text) RETURNS text LANGUAGE sql AS $$
  SELECT 'f3870000-0000-4000-8000-000000000005:complete:' || p_op;
$$;


-- Walks a fresh attempt to 'reserved' (issue, proof, reserve): its operation id.
CREATE FUNCTION pg_temp.gx_reserved(p_label text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_op text := pg_temp.gx_issue_op() ->> 'operationId';
  v_result jsonb;
BEGIN
  PERFORM pg_temp.gx_issue(p_label, 'goal_complete', 1, pg_temp.gx_key(v_op));
  v_result := pg_temp.gx_reserve(v_op, pg_temp.gx_token(p_label));
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'claimed',
    'fixture reserve ' || p_label || ': ' || v_result::text);
  RETURN v_op;
END;
$$;
-- ... and on to 'dispatched' with the provider balance of 250000 kobo.
CREATE FUNCTION pg_temp.gx_dispatched(p_label text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_op text := pg_temp.gx_reserved(p_label);
BEGIN
  PERFORM pg_temp.gx_assert(
    piggyvest_primary.manage_goal_complete(pg_temp.gx_scope(), v_op::uuid, 'dispatch', 250000),
    'fixture dispatch ' || p_label);
  RETURN v_op;
END;
$$;
-- Confirmed funding of the goal wallet, as the books record it.
CREATE FUNCTION pg_temp.gx_fund(p_suffix text, p_kobo bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id)
  VALUES (('f3870000-0000-4000-8000-0000000000' || p_suffix)::uuid, 'f3870000-0000-4000-8000-000000000006',
    'f3870000-0000-4000-8000-000000000007', 'f3870000-0000-4000-8000-000000000005', p_kobo,
    'synthetic-goalcomplete-main', 'synthetic-goalcomplete-goal-wallet',
    'pvb-save-f3870000-0000-4000-8000-0000000000' || p_suffix, 'confirmed',
    'f3870000-0000-4000-8000-000000000009');
$$;
CREATE FUNCTION pg_temp.gx_settle(p_proof jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.settle_goal_complete('f3870000-0000-4000-8000-000000000006'::uuid, 'staging', p_proof);
$$;
CREATE FUNCTION pg_temp.gx_release(p_proof jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.release_failed_goal_complete('f3870000-0000-4000-8000-000000000006'::uuid, 'staging', p_proof);
$$;
CREATE FUNCTION pg_temp.gx_wallet() RETURNS numeric LANGUAGE sql AS $$
  SELECT available_balance FROM public.customer_wallets WHERE id = 'f3870000-0000-4000-8000-000000000008';
$$;
CREATE FUNCTION pg_temp.gx_goal(p_column text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_catalog.to_jsonb(goal) ->> p_column FROM public.customer_savings_goals AS goal
   WHERE goal.id = 'f3870000-0000-4000-8000-000000000005';
$$;
