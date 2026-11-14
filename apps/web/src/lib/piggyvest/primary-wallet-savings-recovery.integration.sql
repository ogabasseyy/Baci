\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
\ir ../../../../../supabase/migrations/20261007153000_piggyvest_primary_savings_pending_recovery.sql
\ir ../../../../../supabase/migrations/20261102214100_piggyvest_preonboarding_savings_recovery.sql
-- Pending-savings recovery only reads what already exists. It answers
-- "nothing pending" (NULL) for a customer whose onboarding is absent or
-- incomplete, keeps refusing callers it cannot bind (42501), and never changes
-- money state. Customer 0d holds a rejected intent from the storage fixture;
-- customer f1 has never started onboarding.
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f2');
INSERT INTO public.customer_savings_goals VALUES
  ('00000000-0000-4000-8000-0000000000f3','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1','active',200,0),
  ('00000000-0000-4000-8000-0000000000f4','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000000d','active',200,0);
-- A settled transfer older than the pending one must never be recovered.
INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state,wallet_transaction_id,created_at)
  SELECT '00000000-0000-4000-8000-0000000000f5',integration_id,intent_id,goal_id,1000,'wallet','destination','pvb-save-settled-fixture','confirmed',wallet_transaction_id,created_at-interval '1 hour'
  FROM piggyvest_primary.savings_operations WHERE id='00000000-0000-4000-8000-000000000008';
-- A second authorizer login that no savings authority names.
CREATE ROLE recovery_impostor_fixture LOGIN;
GRANT piggyvest_primary_authorizer TO recovery_impostor_fixture;
CREATE TABLE public.recovery_ledger_snapshot AS
  SELECT id,state,amount_kobo,reference FROM piggyvest_primary.savings_operations;
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  never_onboarded jsonb := jsonb_set(jsonb_set(scope,'{customerId}','"00000000-0000-4000-8000-0000000000f1"'),'{userId}','"00000000-0000-4000-8000-0000000000f2"');
  rejected jsonb := jsonb_set(jsonb_set(scope,'{customerId}','"00000000-0000-4000-8000-00000000000d"'),'{userId}','"00000000-0000-4000-8000-00000000000e"');
  recovered jsonb;
  field text;
BEGIN
  recovered:=piggyvest_primary.read_pending_savings(scope,'00000000-0000-4000-8000-000000000006');
  IF recovered->>'operationId'<>'00000000-0000-4000-8000-000000000008'
    OR recovered->>'state'<>'dispatched' OR (recovered->>'amountKobo')::bigint<>2000
    THEN RAISE EXCEPTION 'pending operation not recovered'; END IF;
  -- No onboarding at all, and onboarding that ended rejected: nothing pending.
  IF piggyvest_primary.read_pending_savings(never_onboarded,'00000000-0000-4000-8000-0000000000f3') IS NOT NULL
    THEN RAISE EXCEPTION 'never-onboarded customer recovered an operation'; END IF;
  IF piggyvest_primary.read_pending_savings(rejected,'00000000-0000-4000-8000-0000000000f4') IS NOT NULL
    THEN RAISE EXCEPTION 'rejected-onboarding customer recovered an operation'; END IF;
  -- Opening recovery does not open reservations before onboarding.
  BEGIN
    PERFORM piggyvest_primary.reserve_savings(never_onboarded,'{"goalId":"00000000-0000-4000-8000-0000000000f3","operationId":"00000000-0000-4000-8000-0000000000f6","amountKobo":1000}');
    RAISE EXCEPTION 'reservation accepted before onboarding';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Goals the caller does not own: another customer's, and one that does not exist.
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'00000000-0000-4000-8000-0000000000f3');
    RAISE EXCEPTION 'foreign goal accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'00000000-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'unknown goal accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(never_onboarded,'00000000-0000-4000-8000-000000000006');
    RAISE EXCEPTION 'never-onboarded customer read another goal';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Every binding field is checked, and the scope shape is exact.
  FOREACH field IN ARRAY ARRAY['merchantId','customerId','userId','integrationId','businessId','environment'] LOOP
    BEGIN
      PERFORM piggyvest_primary.read_pending_savings(scope || jsonb_build_object(field,
        CASE WHEN field IN ('businessId','environment') THEN 'wrong-binding' ELSE '00000000-0000-4000-8000-0000000000ff' END),
        '00000000-0000-4000-8000-000000000006');
      RAISE EXCEPTION 'wrong % accepted', field;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope || '{"extra":"key"}','00000000-0000-4000-8000-000000000006');
    RAISE EXCEPTION 'oversized scope accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
-- The right role through the wrong login is still refused.
SET SESSION AUTHORIZATION recovery_impostor_fixture;
DO $$ BEGIN
  PERFORM piggyvest_primary.read_pending_savings('{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}','00000000-0000-4000-8000-000000000006');
  RAISE EXCEPTION 'unbound SESSION_USER accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET SESSION AUTHORIZATION;
-- Cutover: a second integration of the same merchant, with its own executor
-- login, under which customer 02 has no intent. The transfer dispatched under
-- integration 04 is invisible to that scoped read, so it must refuse.
CREATE ROLE recovery_cutover_fixture LOGIN;
GRANT piggyvest_primary_authorizer TO recovery_cutover_fixture;
INSERT INTO piggyvest_primary.integrations(id,merchant_id,business_id,environment,executor_login,enabled)
  VALUES ('00000000-0000-4000-8000-0000000000b4','00000000-0000-4000-8000-000000000001','fixture-business','production','recovery_cutover_fixture',true);
INSERT INTO piggyvest_primary.savings_authorities(integration_id,executor_login,enabled)
  VALUES ('00000000-0000-4000-8000-0000000000b4','recovery_cutover_fixture',true);
-- Mixed set: the second integration also holds its own attributable transfer
-- for the same goal. The older one under integration 04 is still unattributed
-- to this scope, so the read must still refuse instead of returning only the
-- attributable one. The extra rows are removed again before the snapshot check.
INSERT INTO piggyvest_primary.onboarding_intents(id,integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
  VALUES ('00000000-0000-4000-8000-0000000000b5','00000000-0000-4000-8000-0000000000b4','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',repeat('c',64),'unknown',NULL,NULL);
INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state,wallet_transaction_id,created_at)
  SELECT '00000000-0000-4000-8000-0000000000b6','00000000-0000-4000-8000-0000000000b4','00000000-0000-4000-8000-0000000000b5',goal_id,1100,'wallet','destination','pvb-save-mixed-own-fixture','dispatched',wallet_transaction_id,created_at+interval '1 hour'
  FROM piggyvest_primary.savings_operations WHERE id='00000000-0000-4000-8000-000000000008';
SET SESSION AUTHORIZATION recovery_cutover_fixture;
DO $$ BEGIN
  PERFORM piggyvest_primary.read_pending_savings('{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-0000000000b4","businessId":"fixture-business","environment":"production"}','00000000-0000-4000-8000-000000000006');
  RAISE EXCEPTION 'in-flight transfer under another integration read as nothing pending';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET SESSION AUTHORIZATION;
DELETE FROM piggyvest_primary.savings_operations WHERE id='00000000-0000-4000-8000-0000000000b6';
DELETE FROM piggyvest_primary.onboarding_intents WHERE id='00000000-0000-4000-8000-0000000000b5';
-- Reads changed nothing: same operations, same states, same balances.
DO $$ BEGIN
  IF EXISTS (SELECT id,state,amount_kobo,reference FROM piggyvest_primary.savings_operations
      EXCEPT SELECT * FROM public.recovery_ledger_snapshot)
    OR EXISTS (SELECT * FROM public.recovery_ledger_snapshot
      EXCEPT SELECT id,state,amount_kobo,reference FROM piggyvest_primary.savings_operations)
    THEN RAISE EXCEPTION 'recovery changed savings operations'; END IF;
  IF (SELECT available_balance FROM public.customer_wallets WHERE customer_id='00000000-0000-4000-8000-000000000002')<>88.50 THEN RAISE EXCEPTION 'recovery changed wallet'; END IF;
  IF EXISTS (SELECT 1 FROM public.customer_savings_goals WHERE current_amount<>0) THEN RAISE EXCEPTION 'recovery credited unverified savings'; END IF;
END $$;
-- Once the pending transfer settles, nothing is pending; a later reservation
-- is recovered in its own right, and a cancelled one is not.
UPDATE piggyvest_primary.savings_operations SET state='confirmed' WHERE id='00000000-0000-4000-8000-000000000008';
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$ BEGIN
  IF piggyvest_primary.read_pending_savings('{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}','00000000-0000-4000-8000-000000000006') IS NOT NULL
    THEN RAISE EXCEPTION 'settled or cancelled operation recovered'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
-- With nothing in flight on the goal, the cutover caller gets a definite NULL.
SET SESSION AUTHORIZATION recovery_cutover_fixture;
DO $$ BEGIN
  IF piggyvest_primary.read_pending_savings('{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-0000000000b4","businessId":"fixture-business","environment":"production"}','00000000-0000-4000-8000-000000000006') IS NOT NULL
    THEN RAISE EXCEPTION 'cutover caller recovered a settled operation'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state,wallet_transaction_id)
  SELECT '00000000-0000-4000-8000-0000000000f7',integration_id,intent_id,goal_id,1500,'wallet','destination','pvb-save-reserved-fixture','reserved',wallet_transaction_id
  FROM piggyvest_primary.savings_operations WHERE id='00000000-0000-4000-8000-000000000008';
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE recovered jsonb;
BEGIN
  recovered:=piggyvest_primary.read_pending_savings('{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}','00000000-0000-4000-8000-000000000006');
  IF recovered IS DISTINCT FROM '{"operationId":"00000000-0000-4000-8000-0000000000f7","goalId":"00000000-0000-4000-8000-000000000006","amountKobo":1500,"state":"reserved"}'::jsonb
    THEN RAISE EXCEPTION 'reserved operation not recovered: %', recovered; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.savings_operations SET state='cancelled' WHERE id='00000000-0000-4000-8000-0000000000f7';
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$ BEGIN
  IF piggyvest_primary.read_pending_savings('{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}','00000000-0000-4000-8000-000000000006') IS NOT NULL
    THEN RAISE EXCEPTION 'cancelled operation recovered'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
-- Catalog: a pinned definer whose only grantee besides its owner is the
-- savings executor role.
DO $$
DECLARE routine regprocedure := 'piggyvest_primary.read_pending_savings(jsonb,uuid)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid=routine) THEN RAISE EXCEPTION 'recovery is not SECURITY DEFINER'; END IF;
  IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid=routine) IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN RAISE EXCEPTION 'recovery search_path not pinned'; END IF;
  IF (SELECT array_agg(grantee_name ORDER BY grantee_name) FROM (
        SELECT DISTINCT CASE WHEN privilege.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name
        FROM pg_catalog.pg_proc routine_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(routine_row.proacl,pg_catalog.acldefault('f',routine_row.proowner))) privilege
        LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid=privilege.grantee
        WHERE routine_row.oid=routine AND privilege.privilege_type='EXECUTE' AND privilege.grantee<>routine_row.proowner) grantees)
    IS DISTINCT FROM ARRAY['piggyvest_primary_authorizer'] THEN RAISE EXCEPTION 'recovery EXECUTE reaches roles beyond the savings executor'; END IF;
  IF has_function_privilege('anon',routine,'EXECUTE') OR has_function_privilege('authenticated',routine,'EXECUTE')
    OR has_function_privilege('service_role',routine,'EXECUTE') THEN RAISE EXCEPTION 'public recovery'; END IF;
END $$;
