-- Shared fixture for the wallet pay suites (migration
-- 20261112161500_piggyvest_wallet_pay). Included with \ir, never run on its
-- own: it opens the transaction the including suite rolls back.
--
-- Synthetic, transaction-local data. PIN proofs are written directly as owner
-- rows with label-derived test tokens (no PIN is typed); the spend point under
-- test reads them like real ones. The session user stands in for both the
-- authorizer and the evidence login.
BEGIN;

UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.savings_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;

INSERT INTO auth.users (id, email) VALUES
  ('f9a10000-0000-4000-8000-000000000001', 'piggyvest-walletpay@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f9a10000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f9a10000-0000-4000-8000-000000000002', 'f9a10000-0000-4000-8000-000000000001',
   'piggyvest-walletpay@example.test', 'PiggyVest Wallet Pay Fixture', 'piggyvest-walletpay-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f9a10000-0000-4000-8000-000000000003', 'f9a10000-0000-4000-8000-000000000002',
   'f9a10000-0000-4000-8000-000000000001', 'piggyvest-walletpay-customer@example.test');
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f9a10000-0000-4000-8000-000000000006', 'f9a10000-0000-4000-8000-000000000002',
  'synthetic-walletpay-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f9a10000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f9a10000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES (
  'f9a10000-0000-4000-8000-000000000007', 'f9a10000-0000-4000-8000-000000000006',
  'f9a10000-0000-4000-8000-000000000002', 'f9a10000-0000-4000-8000-000000000003',
  'f9a10000-0000-4000-8000-000000000001', repeat('e', 64), 'accepted',
  'synthetic-walletpay-customer', 'synthetic-walletpay-main');
INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
VALUES ('f9a10000-0000-4000-8000-000000000002', true);
INSERT INTO wallet_pin_private.customer_pins (
  customer_id, user_id, merchant_id, kdf_version, pepper_id, salt, pin_hash)
VALUES (
  'f9a10000-0000-4000-8000-000000000003', 'f9a10000-0000-4000-8000-000000000001',
  'f9a10000-0000-4000-8000-000000000002', 1,
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('walletpay-pepper', 'UTF8')), 1, 8),
  pg_catalog.substr(pg_catalog.sha256(pg_catalog.convert_to('walletpay-salt', 'UTF8')), 1, 16),
  pg_catalog.sha256(pg_catalog.convert_to('walletpay-hash', 'UTF8')));
SELECT set_config('test.wp_scope', jsonb_build_object(
  'merchantId', 'f9a10000-0000-4000-8000-000000000002',
  'customerId', 'f9a10000-0000-4000-8000-000000000003',
  'userId', 'f9a10000-0000-4000-8000-000000000001',
  'integrationId', 'f9a10000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-walletpay-business', 'environment', 'staging')::text, true);

CREATE FUNCTION pg_temp.wp_assert(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'wallet pay behaviour: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.wp_scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.current_setting('test.wp_scope')::jsonb;
$$;
CREATE FUNCTION pg_temp.wp_collection(p_wallet text DEFAULT 'synthetic-walletpay-collection') RETURNS void
LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.collection_wallets (integration_id, provider_wallet_id, enabled)
  VALUES ('f9a10000-0000-4000-8000-000000000006', p_wallet, true)
  ON CONFLICT (integration_id) DO UPDATE SET provider_wallet_id = EXCLUDED.provider_wallet_id, enabled = true;
$$;
CREATE FUNCTION pg_temp.wp_issue(p_ref text, p_amount bigint DEFAULT 100000, p_purpose text DEFAULT 'imei_check')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.issue_wallet_payment(pg_temp.wp_scope(),
    pg_catalog.jsonb_build_object('purpose', p_purpose, 'purchaseRef', p_ref, 'amountKobo', p_amount));
$$;
CREATE FUNCTION pg_temp.wp_token(p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_label, 'UTF8')), 'hex');
$$;
-- Writes a live proof row as verify_wallet_pin would, for any binding.
CREATE FUNCTION pg_temp.wp_proof(p_label text, p_purpose text, p_amount bigint, p_key_text text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_issued timestamptz := pg_catalog.clock_timestamp();
BEGIN
  INSERT INTO wallet_pin_private.proofs (
    token_sha256, customer_id, merchant_id, purpose, amount_kobo,
    idempotency_key_sha256, issued_at, expires_at)
  VALUES (
    pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_token(p_label), 'hex')),
    'f9a10000-0000-4000-8000-000000000003', 'f9a10000-0000-4000-8000-000000000002',
    p_purpose, p_amount, pg_catalog.sha256(pg_catalog.convert_to(p_key_text, 'UTF8')),
    v_issued, v_issued + interval '120 seconds');
  RETURN pg_temp.wp_token(p_label);
END;
$$;
CREATE FUNCTION pg_temp.wp_key(p_op text, p_ref text, p_purpose text DEFAULT 'imei_check') RETURNS text
LANGUAGE sql AS $$ SELECT 'pay:' || p_purpose || ':' || p_ref || ':' || p_op; $$;
CREATE FUNCTION pg_temp.wp_reserve(p_op text, p_proof text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.reserve_wallet_payment_with_pin(pg_temp.wp_scope(),
    pg_catalog.jsonb_build_object('operationId', p_op), p_proof);
$$;
CREATE FUNCTION pg_temp.wp_state(p_op text) RETURNS text LANGUAGE sql AS $$
  SELECT state FROM piggyvest_primary.wallet_payments WHERE id = p_op::uuid;
$$;
CREATE FUNCTION pg_temp.wp_fulfilment(p_op text) RETURNS text LANGUAGE sql AS $$
  SELECT fulfilment FROM piggyvest_primary.wallet_payments WHERE id = p_op::uuid;
$$;
CREATE FUNCTION pg_temp.wp_spent(p_label text) RETURNS boolean LANGUAGE sql AS $$
  SELECT consumed_at IS NOT NULL FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_token(p_label), 'hex'));
$$;
-- Issue, prove and reserve a payment: its operation id.
CREATE FUNCTION pg_temp.wp_reserved(p_ref text, p_amount bigint DEFAULT 100000) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_op text := pg_temp.wp_issue(p_ref, p_amount) ->> 'operationId';
  v_result jsonb;
BEGIN
  v_result := pg_temp.wp_reserve(v_op,
    pg_temp.wp_proof('fixture-' || v_op, 'wallet_pay', p_amount, pg_temp.wp_key(v_op, p_ref)));
  PERFORM pg_temp.wp_assert(v_result ->> 'status' = 'claimed', 'fixture reserve: ' || v_result::text);
  RETURN v_op;
END;
$$;
CREATE FUNCTION pg_temp.wp_dispatched(p_ref text, p_amount bigint DEFAULT 100000) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_op text := pg_temp.wp_reserved(p_ref, p_amount);
BEGIN
  PERFORM pg_temp.wp_assert(
    piggyvest_primary.manage_wallet_payment(pg_temp.wp_scope(), v_op::uuid, 'dispatch'), 'fixture dispatch');
  RETURN v_op;
END;
$$;
-- A provider record of the payment transfer (successful or failed alike).
CREATE FUNCTION pg_temp.wp_pay_proof(p_op text, p_txn text, p_amount bigint DEFAULT 100000) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'operationId', p_op, 'providerTransactionId', p_txn, 'reference', 'pvb-pay-' || p_op,
    'amountKobo', p_amount, 'sourceWalletId', 'synthetic-walletpay-main',
    'destinationWalletId', 'synthetic-walletpay-collection', 'businessId', 'synthetic-walletpay-business');
$$;
CREATE FUNCTION pg_temp.wp_refund_proof(p_op text, p_txn text, p_attempt integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'operationId', p_op, 'providerTransactionId', p_txn,
    'reference', 'pvb-refund-' || p_op || CASE WHEN p_attempt = 0 THEN '' ELSE '-' || p_attempt END,
    'amountKobo', 100000, 'sourceWalletId', 'synthetic-walletpay-collection',
    'destinationWalletId', 'synthetic-walletpay-main', 'businessId', 'synthetic-walletpay-business');
$$;
CREATE FUNCTION pg_temp.wp_settle(p_proof jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.settle_wallet_payment('f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', p_proof);
$$;
CREATE FUNCTION pg_temp.wp_release(p_proof jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.release_failed_wallet_payment('f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', p_proof);
$$;
CREATE FUNCTION pg_temp.wp_claim(p_op text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.claim_wallet_payment_fulfilment('f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', p_op::uuid);
$$;
CREATE FUNCTION pg_temp.wp_finish(p_op text, p_outcome text) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.finish_wallet_payment_fulfilment('f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', p_op::uuid, p_outcome);
$$;
CREATE FUNCTION pg_temp.wp_refunds(p_op text) RETURNS integer LANGUAGE sql AS $$
  SELECT pg_catalog.count(*)::integer FROM piggyvest_primary.wallet_payment_refunds WHERE payment_id = p_op::uuid;
$$;
