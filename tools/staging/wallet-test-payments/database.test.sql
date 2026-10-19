-- Run after database.sql only in a disposable database named
-- wallet_test_payments_scratch, never against the isolated staging cluster.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';

DO $test$
DECLARE
  v_system_identifier text;
  v_definition text;
  v_settlement text;
BEGIN
  IF current_database() <> 'wallet_test_payments_scratch' THEN
    RAISE EXCEPTION 'refusing non-scratch database';
  END IF;
  SELECT system_identifier::text INTO v_system_identifier FROM pg_catalog.pg_control_system();
  IF v_system_identifier = '7685292944002592802' THEN
    RAISE EXCEPTION 'refusing pinned staging cluster';
  END IF;

  IF to_regprocedure('staging_wallet_payments.begin_top_up(uuid,uuid,bigint,text)') IS NULL
    OR to_regprocedure('staging_wallet_payments.read_top_up(uuid,uuid,text)') IS NULL
    OR to_regprocedure('staging_wallet_payments.settle_top_up(uuid,uuid,text,bigint,text,text,text,text)') IS NULL
    OR to_regprocedure('staging_wallet_payments.assert_identity()') IS NULL
    OR to_regprocedure('staging_wallet_payments.assert_configuration(uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'missing worker RPC signature';
  END IF;
  IF NOT has_function_privilege('baci_staging_test_payments',
      'staging_wallet_payments.begin_top_up(uuid,uuid,bigint,text)', 'EXECUTE')
    OR NOT has_function_privilege('baci_staging_test_payments',
      'staging_wallet_payments.read_top_up(uuid,uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege('baci_staging_test_payments',
      'staging_wallet_payments.settle_top_up(uuid,uuid,text,bigint,text,text,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('baci_staging_test_payments',
      'staging_wallet_payments.assert_identity()', 'EXECUTE')
    OR NOT has_function_privilege('baci_staging_test_payments',
      'staging_wallet_payments.assert_configuration(uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'worker lacks explicit RPC grant';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'staging_wallet_payments'::regnamespace
        AND has_function_privilege('baci_staging_test_payments', p.oid, 'EXECUTE')) <> 5 THEN
    RAISE EXCEPTION 'worker RPC grant inventory is not exact';
  END IF;
  IF has_function_privilege('baci_staging_test_payments',
      'staging_wallet_payments._guard()', 'EXECUTE')
    OR has_function_privilege('baci_staging_test_payments',
      'staging_wallet_payments._customer(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('baci_staging_test_payments',
      'public.credit_customer_wallet(uuid,uuid,numeric,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'worker has direct helper or canonical credit privilege';
  END IF;
  IF has_function_privilege('anon', 'staging_wallet_payments.assert_configuration(uuid,uuid[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'staging_wallet_payments.assert_configuration(uuid,uuid[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'staging_wallet_payments.assert_configuration(uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'configuration assertion is exposed beyond worker';
  END IF;
  IF has_table_privilege('baci_staging_test_payments', 'staging_wallet_payments.config', 'SELECT')
    OR has_table_privilege('baci_staging_test_payments', 'staging_wallet_payments.pending_topups', 'SELECT')
    OR has_table_privilege('baci_staging_test_payments', 'staging_wallet_payments.pending_topups', 'INSERT')
    OR has_table_privilege('baci_staging_test_payments', 'staging_wallet_payments.pending_topups', 'UPDATE') THEN
    RAISE EXCEPTION 'worker has direct table privilege';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class
    WHERE oid = 'staging_wallet_payments.config'::regclass)
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class
    WHERE oid = 'staging_wallet_payments.pending_topups'::regclass) THEN
    RAISE EXCEPTION 'worker tables are not force-RLS protected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'baci_staging_test_payments'
      AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'worker role attributes are unsafe';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'staging_wallet_payments._guard()'::regprocedure
  ) || pg_catalog.pg_get_functiondef(
    'staging_wallet_payments.assert_identity()'::regprocedure
  ) || pg_catalog.pg_get_functiondef(
    'staging_wallet_payments.assert_configuration(uuid,uuid[])'::regprocedure
  ) || pg_catalog.pg_get_functiondef(
    'staging_wallet_payments._customer(uuid,uuid)'::regprocedure
  ) || pg_catalog.pg_get_functiondef(
    'staging_wallet_payments.begin_top_up(uuid,uuid,bigint,text)'::regprocedure
  ) || pg_catalog.pg_get_functiondef(
    'staging_wallet_payments.settle_top_up(uuid,uuid,text,bigint,text,text,text,text)'::regprocedure
  ) || pg_catalog.pg_get_functiondef(
    'public.credit_customer_wallet(uuid,uuid,numeric,text,uuid,text)'::regprocedure
  ) INTO v_definition;
  IF position('7685292944002592802' IN v_definition) = 0
    OR position('1790697550' IN v_definition) = 0
    OR position('session_user' IN v_definition) = 0
    OR position('current_user' IN v_definition) = 0
    OR position('10000 AND 50000000' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'worker identity, lease, amount, or source guard missing';
  END IF;
  IF position('FOR UPDATE' IN v_definition) = 0
    OR position('p_verified_domain IS DISTINCT FROM ''test''' IN v_definition) = 0
    OR position('p_verified_currency IS DISTINCT FROM ''NGN''' IN v_definition) = 0
    OR position('v_entry.id' IN v_definition) = 0
    OR position('''wallet_topup''' IN v_definition) = 0
    OR position('array_ndims(p_customer_ids) <> 1' IN v_definition) = 0
    OR position('cardinality(p_customer_ids) <> 1' IN v_definition) = 0
    OR position('c.user_id IS NOT NULL' IN v_definition) = 0
    OR position('c.deleted_at IS NULL' IN v_definition) = 0
    OR position('c.user_id = p_auth_user' IN v_definition) = 0
    OR position('cfg.merchant_id = p_merchant' IN v_definition) = 0
    OR position('v_entry.customer_id <> v_customer' IN v_definition) = 0
    OR position('v_entry.amount_kobo <> p_amount_kobo' IN v_definition) = 0
    OR position('pg_advisory_xact_lock' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'settlement lock or replay/provider checks missing';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(
    'staging_wallet_payments.settle_top_up(uuid,uuid,text,bigint,text,text,text,text)'::regprocedure
  ) INTO v_settlement;
  IF position('FROM public.credit_customer_wallet' IN v_settlement) = 0
    OR position('UPDATE staging_wallet_payments.pending_topups SET status = ''settled''' IN v_settlement)
      < position('FROM public.credit_customer_wallet' IN v_settlement)
    OR position('''balance''' IN v_settlement) = 0
    OR position('''first_credit''' IN v_settlement) = 0 THEN
    RAISE EXCEPTION 'credit and settlement are not in one ordered transaction';
  END IF;
END;
$test$;

ROLLBACK;

BEGIN;
SET LOCAL statement_timeout = '5s';

DO $fixture$
BEGIN
  IF current_database() <> 'wallet_test_payments_scratch' THEN
    RAISE EXCEPTION 'refusing non-scratch database';
  END IF;
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) = '7685292944002592802' THEN
    RAISE EXCEPTION 'refusing pinned staging cluster';
  END IF;
END;
$fixture$;
INSERT INTO public.merchants(id) VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.customers(id, merchant_id, user_id, email) VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000003', 'synthetic@example.test');
INSERT INTO staging_wallet_payments.config(singleton, merchant_id, customer_id)
VALUES (true, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');
CREATE OR REPLACE FUNCTION staging_wallet_payments._guard()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $test_guard$
BEGIN
  IF session_user <> 'baci_staging_test_payments' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'scratch caller rejected' USING ERRCODE = '42501';
  END IF;
END;
$test_guard$;
ALTER FUNCTION staging_wallet_payments._guard() OWNER TO postgres;

SET SESSION AUTHORIZATION baci_staging_test_payments;
DO $behavior$
DECLARE
  v_result jsonb;
  v_read jsonb;
BEGIN
  IF NOT staging_wallet_payments.assert_configuration(
      '00000000-0000-4000-8000-000000000001',
      ARRAY['00000000-0000-4000-8000-000000000002'::uuid]) THEN
    RAISE EXCEPTION 'valid configuration was rejected';
  END IF;
  BEGIN
    PERFORM staging_wallet_payments.assert_configuration(
      '10000000-0000-4000-8000-000000000001',
      ARRAY['00000000-0000-4000-8000-000000000002'::uuid]);
    RAISE EXCEPTION 'configuration with other merchant was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.assert_configuration(
      '00000000-0000-4000-8000-000000000001',
      ARRAY['00000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000002'::uuid]);
    RAISE EXCEPTION 'multi-customer configuration was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.begin_top_up(
      '10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 10000, 'identity01');
    RAISE EXCEPTION 'other auth user was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.begin_top_up(
      '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 10000, 'merchant01');
    RAISE EXCEPTION 'other merchant was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_result := staging_wallet_payments.begin_top_up(
    '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 10000, 'replayref01');
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_result)) <> 5 OR v_result->>'amount_kobo' <> '10000'
    OR v_result->>'customer_id' <> '00000000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'begin response contract mismatch';
  END IF;
  v_read := staging_wallet_payments.read_top_up(
    '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'replayref01');
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_read)) <> 7 OR v_read->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'read response contract mismatch';
  END IF;
  v_read := staging_wallet_payments.read_top_up(
    '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'missingref01');
  IF v_read <> '{"found": false}'::jsonb THEN
    RAISE EXCEPTION 'missing read response mismatch';
  END IF;
  BEGIN
    PERFORM staging_wallet_payments.begin_top_up(
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 9999, 'belowmin01');
    RAISE EXCEPTION 'amount below minimum was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.begin_top_up(
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 50000001, 'abovemax01');
    RAISE EXCEPTION 'amount above maximum was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.begin_top_up(
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 10001, 'replayref01');
    RAISE EXCEPTION 'reference replay with changed amount was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.settle_top_up(
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
      'replayref01', 10001, 'NGN', 'test', 'replayref01', 'synthetic@example.test');
    RAISE EXCEPTION 'settlement with changed amount was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.settle_top_up(
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
      'replayref01', 10000, 'USD', 'test', 'replayref01', 'synthetic@example.test');
    RAISE EXCEPTION 'non-NGN settlement was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.settle_top_up(
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
      'replayref01', 10000, 'NGN', 'test', 'otherref001', 'synthetic@example.test');
    RAISE EXCEPTION 'reference mismatch settlement was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.settle_top_up(
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
      'replayref01', 10000, 'NGN', 'live', 'replayref01', 'synthetic@example.test');
    RAISE EXCEPTION 'live-domain settlement was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM staging_wallet_payments.settle_top_up(
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
      'replayref01', 10000, 'NGN', 'test', 'replayref01', 'other@example.test');
    RAISE EXCEPTION 'email mismatch settlement was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$behavior$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
