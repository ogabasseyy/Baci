-- Contract tests for read_pending_savings (20261102044438): recovery reads do
-- not depend on onboarding state, ownership is still enforced, settled and
-- cancelled operations are never returned, and only the savings executor role
-- can call it. Synthetic, transaction-local fixture.
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
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb; field text;
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
  FOREACH field IN ARRAY ARRAY['merchantId','customerId','integrationId','businessId','environment'] LOOP
    BEGIN
      PERFORM piggyvest_primary.read_pending_savings(
        scope || jsonb_build_object(field, CASE WHEN field IN ('businessId','environment')
          THEN 'wrong-binding' ELSE '00000000-0000-4000-8000-000000000000' END),
        'f3810000-0000-4000-8000-000000000005');
      RAISE EXCEPTION 'Wrong binding % was accepted', field;
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

-- Catalog: a pinned SECURITY DEFINER whose only EXECUTE grantee besides its
-- owner is the savings executor role.
DO $catalog$
DECLARE routine regprocedure:='piggyvest_primary.read_pending_savings(jsonb,uuid)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = routine) THEN
    RAISE EXCEPTION 'read_pending_savings is not SECURITY DEFINER';
  END IF;
  IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = routine)
    IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'read_pending_savings search_path is not pinned';
  END IF;
  IF (SELECT array_agg(grantee_name ORDER BY grantee_name) FROM (
      SELECT DISTINCT CASE WHEN privilege.grantee = 0 THEN 'PUBLIC'
        ELSE grantee_role.rolname::text END AS grantee_name
      FROM pg_catalog.pg_proc routine_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(routine_row.proacl,
        pg_catalog.acldefault('f', routine_row.proowner))) privilege
      LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = privilege.grantee
      WHERE routine_row.oid = routine AND privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee <> routine_row.proowner) grantees)
    IS DISTINCT FROM ARRAY['piggyvest_primary_authorizer'] THEN
    RAISE EXCEPTION 'read_pending_savings EXECUTE reaches roles beyond the savings executor';
  END IF;
  IF pg_catalog.has_function_privilege('anon', routine, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', routine, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', routine, 'EXECUTE') THEN
    RAISE EXCEPTION 'read_pending_savings is executable by a client role';
  END IF;
END;
$catalog$;
ROLLBACK;
