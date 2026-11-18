-- Shared fixture for the goal cancel behaviour suites (migration
-- 20261103085004_piggyvest_goal_cancel_refund). Included with \ir by each
-- piggyvest_goal_cancel_*.sql suite, never run on its own: it opens the
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
  ('f3860000-0000-4000-8000-000000000001', 'piggyvest-goalcancel@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3860000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000001',
   'piggyvest-goalcancel@example.test', 'PiggyVest Goal Cancel Fixture', 'piggyvest-goalcancel-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000002',
   'f3860000-0000-4000-8000-000000000001', 'piggyvest-goalcancel-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3860000-0000-4000-8000-000000000004', 'f3860000-0000-4000-8000-000000000002',
   'Synthetic goal cancel product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES (
  'f3860000-0000-4000-8000-000000000005', 'f3860000-0000-4000-8000-000000000002',
  'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000004',
  'Synthetic goal cancel goal', 10000, 2500, 1000, 'daily', current_date, current_date + 30,
  'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3860000-0000-4000-8000-000000000006', 'f3860000-0000-4000-8000-000000000002',
  'synthetic-goalcancel-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f3860000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f3860000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES (
  'f3860000-0000-4000-8000-000000000007', 'f3860000-0000-4000-8000-000000000006',
  'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
  'f3860000-0000-4000-8000-000000000001', repeat('d', 64), 'accepted',
  'synthetic-goalcancel-customer', 'synthetic-goalcancel-main');
INSERT INTO piggyvest_primary.savings_destinations (integration_id, goal_id, intent_id, provider_wallet_id, enabled)
VALUES ('f3860000-0000-4000-8000-000000000006', 'f3860000-0000-4000-8000-000000000005',
  'f3860000-0000-4000-8000-000000000007', 'synthetic-goalcancel-goal-wallet', true);
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  ('f3860000-0000-4000-8000-000000000008', 'f3860000-0000-4000-8000-000000000003',
   'f3860000-0000-4000-8000-000000000002', 1000);
INSERT INTO public.customer_wallet_transactions (
  id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status
) VALUES (
  'f3860000-0000-4000-8000-000000000009', 'f3860000-0000-4000-8000-000000000008',
  'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000002',
  'adjustment', 1000, 1000, 'completed');
INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
VALUES ('f3860000-0000-4000-8000-000000000002', true);
INSERT INTO wallet_pin_private.customer_pins (
  customer_id, user_id, merchant_id, kdf_version, pepper_id, salt, pin_hash)
VALUES (
  'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000001',
  'f3860000-0000-4000-8000-000000000002', 1,
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalcancel-pepper', 'UTF8')), 1, 8),
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalcancel-salt', 'UTF8')), 1, 16),
  pg_catalog.sha256(pg_catalog.convert_to('goalcancel-hash', 'UTF8')));
SELECT set_config('test.gc_scope', jsonb_build_object(
  'merchantId', 'f3860000-0000-4000-8000-000000000002',
  'customerId', 'f3860000-0000-4000-8000-000000000003',
  'userId', 'f3860000-0000-4000-8000-000000000001',
  'integrationId', 'f3860000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-goalcancel-business', 'environment', 'staging')::text, true);

-- Orders the redemption rows below point at (the redemption foreign key is real).
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'storefront_order_context', 'route',
  'storefront_order_merchant_id', 'f3860000-0000-4000-8000-000000000002')::text, true);
INSERT INTO public.orders (id, merchant_id, customer_id, order_number, total) VALUES
  ('f3860000-0000-4000-8000-0000000000f3', 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003', 'GC-SYNTH-F3', 10),
  ('f3860000-0000-4000-8000-0000000000f4', 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003', 'GC-SYNTH-F4', 10),
  ('f3860000-0000-4000-8000-0000000000f5', 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003', 'GC-SYNTH-F5', 10);
INSERT INTO public.order_items (order_id, product_id, name, price, quantity)
SELECT o.id, 'f3860000-0000-4000-8000-000000000004', 'Synthetic goal cancel product', 10, 1
  FROM public.orders AS o WHERE o.merchant_id = 'f3860000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claims', '{}', true);

-- Legacy rows that PREDATE the primary-goal guards can not be written while the
-- goal is bound (that is the point of the guards), and the test role may not
-- switch off triggers, so the binding is lifted around such a write and put
-- back unchanged.
CREATE FUNCTION pg_temp.gc_unbind() RETURNS void LANGUAGE sql AS $$
  DELETE FROM piggyvest_primary.savings_destinations
   WHERE goal_id = 'f3860000-0000-4000-8000-000000000005';
$$;
CREATE FUNCTION pg_temp.gc_bind() RETURNS void LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.savings_destinations (integration_id, goal_id, intent_id, provider_wallet_id, enabled)
  VALUES ('f3860000-0000-4000-8000-000000000006', 'f3860000-0000-4000-8000-000000000005',
    'f3860000-0000-4000-8000-000000000007', 'synthetic-goalcancel-goal-wallet', true);
$$;

CREATE FUNCTION pg_temp.gc_token(p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_label, 'UTF8')), 'hex');
$$;
CREATE FUNCTION pg_temp.gc_issue(
  p_label text, p_purpose text, p_amount bigint, p_key_text text, p_age_seconds integer DEFAULT 0)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_issued timestamptz := pg_catalog.clock_timestamp() - (p_age_seconds || ' seconds')::interval;
BEGIN
  INSERT INTO wallet_pin_private.proofs (
    token_sha256, customer_id, merchant_id, purpose, amount_kobo,
    idempotency_key_sha256, issued_at, expires_at)
  VALUES (
    pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token(p_label), 'hex')),
    'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000002',
    p_purpose, p_amount,
    pg_catalog.sha256(pg_catalog.convert_to(p_key_text, 'UTF8')),
    v_issued, v_issued + interval '120 seconds');
  RETURN pg_temp.gc_token(p_label);
END;
$$;
CREATE FUNCTION pg_temp.gc_scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.current_setting('test.gc_scope')::jsonb;
$$;
CREATE FUNCTION pg_temp.gc_issue_op() RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.issue_goal_cancel(pg_temp.gc_scope(), 'f3860000-0000-4000-8000-000000000005'::uuid);
$$;
CREATE FUNCTION pg_temp.gc_reserve(p_op text, p_proof text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.reserve_goal_cancel_with_pin(pg_temp.gc_scope(),
    pg_catalog.jsonb_build_object('goalId', 'f3860000-0000-4000-8000-000000000005', 'operationId', p_op), p_proof);
$$;
CREATE FUNCTION pg_temp.gc_proof(p_op text, p_status text DEFAULT 'success') RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'operationId', p_op, 'providerTransactionId', 'synthetic-gc-txn-' || p_status || '-' || p_op,
    'reference', (SELECT reference FROM piggyvest_primary.goal_cancel_operations WHERE id = p_op::uuid),
    'amountKobo', 250000, 'sourceWalletId', 'synthetic-goalcancel-goal-wallet',
    'destinationWalletId', 'synthetic-goalcancel-main', 'businessId', 'synthetic-goalcancel-business');
$$;
CREATE FUNCTION pg_temp.gc_assert(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'goal cancel behaviour: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.gc_state(p_op text) RETURNS text LANGUAGE sql AS $$
  SELECT state FROM piggyvest_primary.goal_cancel_operations WHERE id = p_op::uuid;
$$;
CREATE FUNCTION pg_temp.gc_spent(p_label text) RETURNS boolean LANGUAGE sql AS $$
  SELECT consumed_at IS NOT NULL FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token(p_label), 'hex'));
$$;
CREATE FUNCTION pg_temp.gc_key(p_op text) RETURNS text LANGUAGE sql AS $$
  SELECT 'f3860000-0000-4000-8000-000000000005:cancel:' || p_op;
$$;


-- Walks a fresh attempt to 'reserved' (issue, proof, reserve): its operation id.
CREATE FUNCTION pg_temp.gc_reserved(p_label text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_op text := pg_temp.gc_issue_op() ->> 'operationId';
  v_result jsonb;
BEGIN
  PERFORM pg_temp.gc_issue(p_label, 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token(p_label));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed',
    'fixture reserve ' || p_label || ': ' || v_result::text);
  RETURN v_op;
END;
$$;
-- ... and on to 'dispatched' with the provider balance of 250000 kobo (the
-- recorded principal, so no interest is forfeited).
CREATE FUNCTION pg_temp.gc_dispatched(p_label text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_op text := pg_temp.gc_reserved(p_label);
BEGIN
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.dispatch_goal_cancel_split(pg_temp.gc_scope(), v_op::uuid, 250000) ->> 'status' = 'dispatched',
    'fixture dispatch ' || p_label);
  RETURN v_op;
END;
$$;
-- Confirmed funding of the goal wallet, as the books record it.
CREATE FUNCTION pg_temp.gc_fund(p_suffix text, p_kobo bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id)
  VALUES (('f3860000-0000-4000-8000-0000000000' || p_suffix)::uuid, 'f3860000-0000-4000-8000-000000000006',
    'f3860000-0000-4000-8000-000000000007', 'f3860000-0000-4000-8000-000000000005', p_kobo,
    'synthetic-goalcancel-main', 'synthetic-goalcancel-goal-wallet',
    'pvb-save-f3860000-0000-4000-8000-0000000000' || p_suffix, 'confirmed',
    'f3860000-0000-4000-8000-000000000009');
$$;
CREATE FUNCTION pg_temp.gc_settle(p_proof jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging', p_proof);
$$;
CREATE FUNCTION pg_temp.gc_wallet() RETURNS numeric LANGUAGE sql AS $$
  SELECT available_balance FROM public.customer_wallets WHERE id = 'f3860000-0000-4000-8000-000000000008';
$$;
CREATE FUNCTION pg_temp.gc_goal(p_column text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_catalog.to_jsonb(goal) ->> p_column FROM public.customer_savings_goals AS goal
   WHERE goal.id = 'f3860000-0000-4000-8000-000000000005';
$$;
