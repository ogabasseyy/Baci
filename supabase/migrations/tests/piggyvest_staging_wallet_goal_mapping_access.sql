\set ON_ERROR_STOP on

DO $$
DECLARE
  role_name text;
  function_oid oid;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
    WHERE oid = 'piggyvest_staging.wallet_goal_mappings'::regclass) THEN
    RAISE EXCEPTION 'mapping RLS required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass) THEN
    RAISE EXCEPTION 'mapping must be default deny';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE contype = 'f'
    AND conrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass) <> 4 THEN
    RAISE EXCEPTION 'four mapping FKs required';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'mapping_test_reader', 'mapping_test_untrusted'] LOOP
    IF pg_catalog.has_schema_privilege(role_name, 'piggyvest_staging', 'USAGE')
      OR pg_catalog.has_table_privilege(role_name, 'piggyvest_staging.wallet_goal_mappings', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'unexpected mapping access';
    END IF;
    FOR function_oid IN SELECT oid FROM pg_catalog.pg_proc
      WHERE pronamespace = 'piggyvest_staging'::regnamespace LOOP
      IF pg_catalog.has_function_privilege(role_name, function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'unexpected mapping execute';
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc
    WHERE pronamespace = 'piggyvest_staging'::regnamespace
      AND (NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'])) THEN
    RAISE EXCEPTION 'security definer fixed search path required';
  END IF;
END $$;

GRANT USAGE ON SCHEMA piggyvest_staging TO mapping_test_reader, mapping_test_untrusted;
GRANT EXECUTE ON FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid, text, text) TO mapping_test_reader;
SET ROLE mapping_test_untrusted;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM piggyvest_staging.wallet_goal_mappings;
    RAISE EXCEPTION 'untrusted mapping read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_staging.resolve_wallet_mapping('40000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'untrusted execute allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE mapping_test_reader;
DO $$
DECLARE
  result record;
  fixture record;
  identity text;
BEGIN
  BEGIN
    PERFORM 1 FROM piggyvest_staging.wallet_goal_mappings;
    RAISE EXCEPTION 'reader direct table read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM piggyvest_staging.wallet_goal_mappings;
    RAISE EXCEPTION 'reader can mutate mappings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO piggyvest_staging.wallet_goal_mappings
      (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004',
      '70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004');
    RAISE EXCEPTION 'reader can provision mappings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT merchant_id, customer_id, goal_id INTO STRICT result FROM piggyvest_staging.resolve_wallet_mapping(
    '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001');
  IF result.merchant_id <> '10000000-0000-4000-8000-000000000001'::uuid
    OR result.customer_id <> '20000000-0000-4000-8000-000000000001'::uuid
    OR result.goal_id <> '30000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'incorrect resolved local ownership';
  END IF;
  SELECT merchant_id, customer_id, goal_id INTO STRICT result FROM piggyvest_staging.resolve_wallet_mapping(
    '40000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002');
  IF result.goal_id <> '30000000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'provider wallet not integration scoped';
  END IF;
  FOR fixture IN SELECT cases.integration_id, cases.wallet_id, cases.customer_id FROM (VALUES
    ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002'),
    ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000009', '70000000-0000-4000-8000-000000000001'),
    ('40000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
    ('40000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
    ('40000000-0000-4000-8000-000000000009', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001')
  ) AS cases(integration_id, wallet_id, customer_id) LOOP
    IF EXISTS (SELECT 1 FROM piggyvest_staging.resolve_wallet_mapping(
      fixture.integration_id::uuid, fixture.wallet_id, fixture.customer_id)) THEN
      RAISE EXCEPTION 'mismatched identity resolved';
    END IF;
  END LOOP;
  FOREACH identity IN ARRAY ARRAY[NULL::text, '', pg_catalog.repeat('0', 513), pg_catalog.repeat(chr(233), 257)] LOOP
    BEGIN
      PERFORM piggyvest_staging.resolve_wallet_mapping('40000000-0000-4000-8000-000000000001',
        identity, '70000000-0000-4000-8000-000000000001');
      RAISE EXCEPTION 'invalid wallet ID accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
      PERFORM piggyvest_staging.resolve_wallet_mapping('40000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000001', identity);
      RAISE EXCEPTION 'invalid customer ID accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  PERFORM piggyvest_staging.resolve_wallet_mapping('40000000-0000-4000-8000-000000000001',
    pg_catalog.repeat(chr(233), 256), pg_catalog.repeat('0', 512));
  BEGIN
    PERFORM piggyvest_staging.resolve_wallet_mapping(NULL,
      '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'missing integration accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
RESET ROLE;

BEGIN;
UPDATE piggyvest_staging.integrations SET enabled = false WHERE id = '40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE mapping_test_reader;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_staging.resolve_wallet_mapping('40000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001')) THEN
    RAISE EXCEPTION 'disabled registered mapping resolved';
  END IF;
END $$;
ROLLBACK;

DO $$
DECLARE
  mutation text;
BEGIN
  FOREACH mutation IN ARRAY ARRAY[
    'UPDATE public.customers SET merchant_id = ''10000000-0000-4000-8000-000000000002'' WHERE id = ''20000000-0000-4000-8000-000000000001''',
    'UPDATE public.customer_savings_goals SET merchant_id = ''10000000-0000-4000-8000-000000000002'' WHERE id = ''30000000-0000-4000-8000-000000000001''',
    'UPDATE public.customer_savings_goals SET customer_id = ''20000000-0000-4000-8000-000000000003'' WHERE id = ''30000000-0000-4000-8000-000000000001'''
  ] LOOP
    BEGIN
      EXECUTE mutation;
      IF EXISTS (SELECT 1 FROM piggyvest_staging.resolve_wallet_mapping('40000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001')) THEN
        RAISE EXCEPTION 'changed public ownership resolved';
      END IF;
      RAISE EXCEPTION 'rollback synthetic ownership change' USING ERRCODE = 'ZX001';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    END;
  END LOOP;
END $$;
