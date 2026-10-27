-- Synthetic transaction-local fixture. It preserves the no-intent, incomplete
-- intent, cross-customer, and pending-operation recovery contracts.
BEGIN;
-- Model the separately provisioned LOGIN and its sole restricted capability
-- group inside this disposable transaction; the production migration creates
-- only the NOLOGIN group role.
CREATE ROLE baci_piggyvest_primary_authorizer LOGIN INHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT piggyvest_primary_authorizer TO baci_piggyvest_primary_authorizer;
INSERT INTO auth.users (id, email) VALUES
  ('f3810000-0000-4000-8000-000000000001', 'piggyvest-recovery@example.test'),
  ('f3810000-0000-4000-8000-000000000011', 'piggyvest-recovery-other@example.test');
-- Merchant insert audit triggers require an attributable actor even though the
-- fixture is created by the replay administrator. Bind only this insert to the
-- synthetic owner, then clear the request claims before worker RPCs.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3810000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3810000-0000-4000-8000-000000000002', 'f3810000-0000-4000-8000-000000000001',
   'piggyvest-recovery@example.test', 'PiggyVest Recovery Fixture', 'piggyvest-recovery-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3810000-0000-4000-8000-000000000003', 'f3810000-0000-4000-8000-000000000002',
   'f3810000-0000-4000-8000-000000000001', 'piggyvest-recovery-customer@example.test'),
  ('f3810000-0000-4000-8000-000000000012', 'f3810000-0000-4000-8000-000000000002',
   'f3810000-0000-4000-8000-000000000011', 'piggyvest-recovery-other-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3810000-0000-4000-8000-000000000004', 'f3810000-0000-4000-8000-000000000002',
   'Synthetic savings product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES
  ('f3810000-0000-4000-8000-000000000005', 'f3810000-0000-4000-8000-000000000002',
   'f3810000-0000-4000-8000-000000000003', 'f3810000-0000-4000-8000-000000000004',
   'Synthetic recovery goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
   'manual', now(), now()),
  ('f3810000-0000-4000-8000-000000000013', 'f3810000-0000-4000-8000-000000000002',
   'f3810000-0000-4000-8000-000000000012', 'f3810000-0000-4000-8000-000000000004',
   'Other synthetic customer goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
   'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3810000-0000-4000-8000-000000000006', 'f3810000-0000-4000-8000-000000000002',
  'synthetic-recovery-business', 'staging', 'baci_piggyvest_primary_authorizer', true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f3810000-0000-4000-8000-000000000006', 'baci_piggyvest_primary_authorizer', true);
SELECT set_config('test.recovery_scope', jsonb_build_object(
  'merchantId', 'f3810000-0000-4000-8000-000000000002',
  'customerId', 'f3810000-0000-4000-8000-000000000003',
  'userId', 'f3810000-0000-4000-8000-000000000001',
  'integrationId', 'f3810000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-recovery-business', 'environment', 'staging')::text, true);

SET SESSION AUTHORIZATION baci_piggyvest_primary_authorizer;
DO $preonboarding$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb; result jsonb;
BEGIN
  result:=piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005');
  IF result IS NOT NULL THEN RAISE EXCEPTION 'Expected NULL before onboarding or a pending operation'; END IF;
  BEGIN
    PERFORM piggyvest_primary.reserve_savings(scope, jsonb_build_object(
      'goalId','f3810000-0000-4000-8000-000000000005',
      'operationId','f3810000-0000-4000-8000-000000000014', 'amountKobo',1000));
    RAISE EXCEPTION 'Valid reservation was accepted before onboarding';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$preonboarding$;
RESET SESSION AUTHORIZATION;

-- An unknown intent has no provider identity, but a dispatched operation
-- associated with it must remain recoverable while onboarding is incomplete.
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES (
  'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000006',
  'f3810000-0000-4000-8000-000000000002', 'f3810000-0000-4000-8000-000000000003',
  'f3810000-0000-4000-8000-000000000001', repeat('a', 64), 'unknown', NULL, NULL
);
INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
  ('f3810000-0000-4000-8000-000000000008', 'f3810000-0000-4000-8000-000000000003',
   'f3810000-0000-4000-8000-000000000002');
INSERT INTO public.customer_wallet_transactions (
  id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status
) VALUES (
  'f3810000-0000-4000-8000-000000000009', 'f3810000-0000-4000-8000-000000000008',
  'f3810000-0000-4000-8000-000000000003', 'f3810000-0000-4000-8000-000000000002',
  'adjustment', 10, 10, 'completed'
);
INSERT INTO piggyvest_primary.savings_operations (
  id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
  destination_wallet_id, reference, state, wallet_transaction_id
) VALUES (
  'f3810000-0000-4000-8000-000000000010', 'f3810000-0000-4000-8000-000000000006',
  'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
  1000, 'synthetic-source-wallet', 'synthetic-destination-wallet',
  'synthetic-recovery-reference', 'dispatched', 'f3810000-0000-4000-8000-000000000009'
);

SET SESSION AUTHORIZATION baci_piggyvest_primary_authorizer;
DO $test$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb; field text;
BEGIN
  -- This is a real goal belonging to the second synthetic customer.
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000013');
    RAISE EXCEPTION 'Another customer goal was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOREACH field IN ARRAY ARRAY['merchantId','customerId','integrationId','businessId','environment'] LOOP
    BEGIN
      PERFORM piggyvest_primary.read_pending_savings(
        scope || jsonb_build_object(field, CASE WHEN field IN ('businessId','environment')
          THEN 'wrong-binding' ELSE '00000000-0000-4000-8000-000000000000' END),
        'f3810000-0000-4000-8000-000000000005');
      RAISE EXCEPTION 'Wrong binding was accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(
      scope || jsonb_build_object('userId','00000000-0000-4000-8000-000000000000'),
      'f3810000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'Wrong user was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary.reserve_savings(scope, jsonb_build_object(
      'goalId','f3810000-0000-4000-8000-000000000005',
      'operationId','f3810000-0000-4000-8000-000000000014', 'amountKobo',1000));
    RAISE EXCEPTION 'Valid reservation was accepted for incomplete onboarding';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$test$;
DO $pending$
DECLARE operation jsonb;
BEGIN
  operation:=piggyvest_primary.read_pending_savings(
    current_setting('test.recovery_scope')::jsonb,
    'f3810000-0000-4000-8000-000000000005');
  IF operation IS NULL OR operation->>'state' IS DISTINCT FROM 'dispatched'
    OR operation->>'operationId' IS DISTINCT FROM 'f3810000-0000-4000-8000-000000000010' THEN
    RAISE EXCEPTION 'Synthetic pending transfer was not recovered';
  END IF;
END;
$pending$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
