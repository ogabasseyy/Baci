-- Contract tests for the pre-onboarding read_pending_savings: recovery reads
-- do not depend on onboarding state, ownership is still enforced, settled and
-- cancelled operations are never returned, an in-flight transfer the scoped
-- read cannot see fails closed, and only the savings executor role can call
-- it. Synthetic, transaction-local fixture.
BEGIN;
-- piggyvest_primary_onboarding_review_hold.sql runs earlier and COMMITs an
-- integration bound to SESSION_USER. executor_login is UNIQUE, so retire any
-- such rows inside this transaction; the final ROLLBACK restores them.
UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.savings_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
-- Bind the fixture to the replay connection's actual SESSION_USER. Do not
-- impersonate a worker login: SET SESSION AUTHORIZATION requires superuser.
INSERT INTO auth.users (id, email) VALUES
  ('f3810000-0000-4000-8000-000000000001', 'piggyvest-recovery@example.test'),
  ('f3810000-0000-4000-8000-000000000011', 'piggyvest-recovery-other@example.test');
-- Merchant insert audit triggers require an attributable actor. Bind only this
-- insert to the synthetic owner, then clear the request claims.
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
  'synthetic-recovery-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
VALUES ('f3810000-0000-4000-8000-000000000006', SESSION_USER, true);
SELECT set_config('test.recovery_scope', jsonb_build_object(
  'merchantId', 'f3810000-0000-4000-8000-000000000002',
  'customerId', 'f3810000-0000-4000-8000-000000000003',
  'userId', 'f3810000-0000-4000-8000-000000000001',
  'integrationId', 'f3810000-0000-4000-8000-000000000006',
  'businessId', 'synthetic-recovery-business', 'environment', 'staging')::text, true);

-- Before onboarding: nothing pending, and reservations stay closed.
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

-- An unknown intent has no provider identity, but a dispatched operation
-- associated with it must remain recoverable while onboarding is incomplete.
-- Older settled and cancelled operations sit beside it and must be skipped.
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
  destination_wallet_id, reference, state, wallet_transaction_id, created_at
) VALUES
  ('f3810000-0000-4000-8000-000000000015', 'f3810000-0000-4000-8000-000000000006',
   'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
   1000, 'synthetic-source-wallet', 'synthetic-destination-wallet',
   'synthetic-recovery-settled', 'confirmed', 'f3810000-0000-4000-8000-000000000009',
   now() - interval '3 hours'),
  ('f3810000-0000-4000-8000-000000000016', 'f3810000-0000-4000-8000-000000000006',
   'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
   1000, 'synthetic-source-wallet', 'synthetic-destination-wallet',
   'synthetic-recovery-cancelled', 'cancelled', 'f3810000-0000-4000-8000-000000000009',
   now() - interval '2 hours'),
  ('f3810000-0000-4000-8000-000000000010', 'f3810000-0000-4000-8000-000000000006',
   'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
   1000, 'synthetic-source-wallet', 'synthetic-destination-wallet',
   'synthetic-recovery-reference', 'dispatched', 'f3810000-0000-4000-8000-000000000009',
   now() - interval '1 hour');

-- Ownership failures still raise 42501.
DO $test$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb; bad_scope jsonb;
BEGIN
  UPDATE piggyvest_primary.integrations SET executor_login = SESSION_USER || '_mismatch'
    WHERE id = 'f3810000-0000-4000-8000-000000000006';
  UPDATE piggyvest_primary.savings_authorities SET executor_login = SESSION_USER || '_mismatch'
    WHERE integration_id = 'f3810000-0000-4000-8000-000000000006';
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'Mismatched SESSION_USER binding was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.integrations SET executor_login = SESSION_USER
    WHERE id = 'f3810000-0000-4000-8000-000000000006';
  UPDATE piggyvest_primary.savings_authorities SET executor_login = SESSION_USER
    WHERE integration_id = 'f3810000-0000-4000-8000-000000000006';
  -- A real goal belonging to the second synthetic customer, then one that
  -- does not exist.
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000013');
    RAISE EXCEPTION 'Another customer goal was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'00000000-0000-4000-8000-000000000000');
    RAISE EXCEPTION 'Unknown goal was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Every binding field is checked, and the scope shape is exact: an extra,
  -- missing or renamed key, a non-object and NULL are all refused.
  FOREACH bad_scope IN ARRAY ARRAY[
    scope || '{"merchantId":"00000000-0000-4000-8000-000000000000"}',
    scope || '{"customerId":"00000000-0000-4000-8000-000000000000"}',
    scope || '{"userId":"00000000-0000-4000-8000-000000000000"}',
    scope || '{"integrationId":"00000000-0000-4000-8000-000000000000"}',
    scope || '{"businessId":"wrong-binding"}', scope || '{"environment":"wrong-binding"}',
    scope || '{"extra":"key"}', scope - 'environment',
    (scope - 'environment') || '{"env":"staging"}', '[]'::jsonb, NULL::jsonb] LOOP
    BEGIN
      PERFORM piggyvest_primary.read_pending_savings(bad_scope,'f3810000-0000-4000-8000-000000000005');
      RAISE EXCEPTION 'Wrong or malformed scope % was accepted', bad_scope;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM piggyvest_primary.reserve_savings(scope, jsonb_build_object(
      'goalId','f3810000-0000-4000-8000-000000000005',
      'operationId','f3810000-0000-4000-8000-000000000014', 'amountKobo',1000));
    RAISE EXCEPTION 'Valid reservation was accepted for incomplete onboarding';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$test$;

-- The pending operation is recovered; the older settled and cancelled ones
-- are not, and the read changes nothing.
DO $pending$
DECLARE operation jsonb;
BEGIN
  operation:=piggyvest_primary.read_pending_savings(
    current_setting('test.recovery_scope')::jsonb,
    'f3810000-0000-4000-8000-000000000005');
  IF operation IS DISTINCT FROM jsonb_build_object(
      'operationId','f3810000-0000-4000-8000-000000000010',
      'goalId','f3810000-0000-4000-8000-000000000005',
      'amountKobo',1000,'state','dispatched') THEN
    RAISE EXCEPTION 'Synthetic pending transfer was not recovered: %', operation;
  END IF;
  IF (SELECT array_agg(state ORDER BY created_at) FROM piggyvest_primary.savings_operations
      WHERE intent_id='f3810000-0000-4000-8000-000000000007')
    IS DISTINCT FROM ARRAY['confirmed','cancelled','dispatched'] THEN
    RAISE EXCEPTION 'Recovery changed savings operations';
  END IF;
END;
$pending$;

-- After onboarding completes the same read keeps working; once the transfer
-- settles nothing is pending, a later reservation is recovered, and a
-- cancelled one is not.
UPDATE piggyvest_primary.onboarding_intents
  SET state = 'accepted', provider_customer_id = 'synthetic-recovery-customer',
    provider_wallet_id = 'synthetic-source-wallet'
  WHERE id = 'f3810000-0000-4000-8000-000000000007';
DO $settled$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb; operation jsonb;
BEGIN
  IF piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005')->>'operationId'
    IS DISTINCT FROM 'f3810000-0000-4000-8000-000000000010' THEN
    RAISE EXCEPTION 'Pending transfer not recovered after onboarding';
  END IF;
  UPDATE piggyvest_primary.savings_operations SET state = 'confirmed'
    WHERE id = 'f3810000-0000-4000-8000-000000000010';
  IF piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005') IS NOT NULL THEN
    RAISE EXCEPTION 'Settled transfer was recovered';
  END IF;
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id
  ) VALUES ('f3810000-0000-4000-8000-000000000017', 'f3810000-0000-4000-8000-000000000006',
    'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
    1500, 'synthetic-source-wallet', 'synthetic-destination-wallet',
    'synthetic-recovery-reserved', 'reserved', 'f3810000-0000-4000-8000-000000000009');
  operation:=piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005');
  IF operation->>'operationId' IS DISTINCT FROM 'f3810000-0000-4000-8000-000000000017'
    OR operation->>'state' IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'Reserved transfer was not recovered: %', operation;
  END IF;
  UPDATE piggyvest_primary.savings_operations SET state = 'cancelled'
    WHERE id = 'f3810000-0000-4000-8000-000000000017';
  IF piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005') IS NOT NULL THEN
    RAISE EXCEPTION 'Cancelled transfer was recovered';
  END IF;
END;
$settled$;

\ir piggyvest_preonboarding_savings_recovery_disabled.inc.sql

\ir piggyvest_preonboarding_savings_recovery_ordering.inc.sql

-- Cutover: the runtime moves to a second integration of the same merchant
-- while a transfer made under the first is still in flight, and the customer
-- has no intent under the second. The scoped read cannot see that transfer,
-- so it must refuse rather than report "nothing pending". Once nothing is in
-- flight on the goal, the same caller gets a definite NULL.
DO $cutover$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb
  || '{"integrationId":"f3810000-0000-4000-8000-000000000018","environment":"production"}';
BEGIN
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id
  ) VALUES ('f3810000-0000-4000-8000-000000000019', 'f3810000-0000-4000-8000-000000000006',
    'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
    1200, 'synthetic-source-wallet', 'synthetic-destination-wallet',
    'synthetic-recovery-cutover', 'dispatched', 'f3810000-0000-4000-8000-000000000009');
  UPDATE piggyvest_primary.integrations SET executor_login = SESSION_USER || '_staging'
    WHERE id = 'f3810000-0000-4000-8000-000000000006';
  UPDATE piggyvest_primary.savings_authorities SET executor_login = SESSION_USER || '_staging'
    WHERE integration_id = 'f3810000-0000-4000-8000-000000000006';
  INSERT INTO piggyvest_primary.integrations
    (id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('f3810000-0000-4000-8000-000000000018', 'f3810000-0000-4000-8000-000000000002',
    'synthetic-recovery-business', 'production', SESSION_USER, true);
  INSERT INTO piggyvest_primary.savings_authorities (integration_id, executor_login, enabled)
  VALUES ('f3810000-0000-4000-8000-000000000018', SESSION_USER, true);
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'In-flight transfer under another integration read as nothing pending';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.savings_operations SET state = 'confirmed'
    WHERE id = 'f3810000-0000-4000-8000-000000000019';
  IF piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005') IS NOT NULL THEN
    RAISE EXCEPTION 'Nothing in flight, yet the cutover caller recovered an operation';
  END IF;
END;
$cutover$;

\ir piggyvest_preonboarding_savings_recovery_mixed.inc.sql

\ir piggyvest_preonboarding_savings_recovery_catalog.inc.sql
ROLLBACK;
