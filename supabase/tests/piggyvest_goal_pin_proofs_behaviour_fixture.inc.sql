-- Fixture and helpers for piggyvest_goal_pin_proofs_behaviour.sql (psql \ir part;
-- runs inside that suite's transaction, not registered on its own).

UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.savings_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;

INSERT INTO auth.users (id, email) VALUES
  ('f3830000-0000-4000-8000-000000000001', 'piggyvest-goalpin@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3830000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3830000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000001',
   'piggyvest-goalpin@example.test', 'PiggyVest Goal PIN Fixture', 'piggyvest-goalpin-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000002',
   'f3830000-0000-4000-8000-000000000001', 'piggyvest-goalpin-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3830000-0000-4000-8000-000000000004', 'f3830000-0000-4000-8000-000000000002',
   'Synthetic goal PIN product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES (
  'f3830000-0000-4000-8000-000000000005', 'f3830000-0000-4000-8000-000000000002',
  'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000004',
  'Synthetic goal PIN goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
  'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000002',
  'synthetic-goalpin-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES (
  'f3830000-0000-4000-8000-000000000007', 'f3830000-0000-4000-8000-000000000006',
  'f3830000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000003',
  'f3830000-0000-4000-8000-000000000001', repeat('b', 64), 'accepted',
  'synthetic-goalpin-customer', 'synthetic-goalpin-source');
INSERT INTO piggyvest_primary.savings_destinations (integration_id, goal_id, intent_id, provider_wallet_id, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000005',
  'f3830000-0000-4000-8000-000000000007', 'synthetic-goalpin-destination', true);
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance) VALUES
  ('f3830000-0000-4000-8000-000000000008', 'f3830000-0000-4000-8000-000000000003',
   'f3830000-0000-4000-8000-000000000002', 1000);
INSERT INTO public.customer_wallet_transactions (
  id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status
) VALUES (
  'f3830000-0000-4000-8000-000000000009', 'f3830000-0000-4000-8000-000000000008',
  'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000002',
  'adjustment', 1000, 1000, 'completed');
INSERT INTO piggyvest_primary.inflow_receipts (
  integration_id, intent_id, provider_transaction_id, event_id, body_digest,
  financial_identity, wallet_transaction_id
) VALUES (
  'f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000007',
  'synthetic-goalpin-inflow', 'synthetic-goalpin-event', repeat('c', 64),
  '{"amountKobo":100000}', 'f3830000-0000-4000-8000-000000000009');
-- PIN authority and a PIN row bound to this customer and account, so a proof
-- is spendable. The hash values are label-derived and never verified here.
INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
VALUES ('f3830000-0000-4000-8000-000000000002', true);
INSERT INTO wallet_pin_private.customer_pins (
  customer_id, user_id, merchant_id, kdf_version, pepper_id, salt, pin_hash)
VALUES (
  'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000001',
  'f3830000-0000-4000-8000-000000000002', 1,
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalpin-pepper', 'UTF8')), 1, 8),
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('goalpin-salt', 'UTF8')), 1, 16),
  pg_catalog.sha256(pg_catalog.convert_to('goalpin-hash', 'UTF8')));
SELECT set_config('test.goalpin_scope', jsonb_build_object(
  'merchantId', 'f3830000-0000-4000-8000-000000000002',
  'customerId', 'f3830000-0000-4000-8000-000000000003',
  'userId', 'f3830000-0000-4000-8000-000000000001',
  'integrationId', 'f3830000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-goalpin-business', 'environment', 'staging')::text, true);

-- Test helpers. A proof token is the hex SHA-256 of a label.
CREATE FUNCTION pg_temp.gp_token(p_label text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_label, 'UTF8')), 'hex');
$$;
-- Issues a proof row for the given binding; p_age_seconds moves it into the past.
CREATE FUNCTION pg_temp.gp_issue(
  p_label text, p_purpose text, p_amount bigint, p_key_text text, p_age_seconds integer DEFAULT 0)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_issued timestamptz := pg_catalog.clock_timestamp() - (p_age_seconds || ' seconds')::interval;
BEGIN
  INSERT INTO wallet_pin_private.proofs (
    token_sha256, customer_id, merchant_id, purpose, amount_kobo,
    idempotency_key_sha256, issued_at, expires_at)
  VALUES (
    pg_catalog.sha256(pg_catalog.decode(pg_temp.gp_token(p_label), 'hex')),
    'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000002',
    p_purpose, p_amount,
    pg_catalog.sha256(pg_catalog.convert_to(p_key_text, 'UTF8')),
    v_issued, v_issued + interval '120 seconds');
  RETURN pg_temp.gp_token(p_label);
END;
$$;
CREATE FUNCTION pg_temp.gp_request(p_operation text, p_amount bigint)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'goalId', 'f3830000-0000-4000-8000-000000000005',
    'operationId', p_operation, 'amountKobo', p_amount);
$$;
CREATE FUNCTION pg_temp.gp_call(p_operation text, p_amount bigint, p_proof text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.reserve_savings_with_pin(
    pg_catalog.current_setting('test.goalpin_scope')::jsonb,
    pg_temp.gp_request(p_operation, p_amount), p_proof);
$$;
CREATE FUNCTION pg_temp.gp_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'goal pin behaviour: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.gp_operations() RETURNS bigint LANGUAGE sql AS $$
  SELECT pg_catalog.count(*) FROM piggyvest_primary.savings_operations;
$$;
CREATE FUNCTION pg_temp.gp_balance() RETURNS numeric LANGUAGE sql AS $$
  SELECT available_balance FROM public.customer_wallets
   WHERE id = 'f3830000-0000-4000-8000-000000000008';
$$;
CREATE FUNCTION pg_temp.gp_spent(p_label text) RETURNS boolean LANGUAGE sql AS $$
  SELECT consumed_at IS NOT NULL FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gp_token(p_label), 'hex'));
$$;
