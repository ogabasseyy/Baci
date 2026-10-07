\set ON_ERROR_STOP on

DO $$
DECLARE
  function_oid oid := 'piggyvest_staging.read_scoped_wallet_mapping(uuid,uuid,uuid,uuid)'::regprocedure;
  role_name text;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = function_oid)
    OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = function_oid)
      IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'scoped mapping reader must be security definer with fixed search path';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure,
        pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS privilege
      WHERE procedure.oid = function_oid
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'unexpected scoped mapping execute grant for PUBLIC';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'mapping_test_reader', 'mapping_test_untrusted', 'piggyvest_staging_worker'] LOOP
    IF pg_catalog.has_function_privilege(role_name, function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'unexpected scoped mapping execute grant for %', role_name;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_schema_privilege('piggyvest_staging_provisioner', 'piggyvest_staging', 'USAGE')
    OR NOT pg_catalog.has_function_privilege('piggyvest_staging_provisioner', function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'provisioner scoped mapping grant missing';
  END IF;
END $$;

SET ROLE piggyvest_staging_provisioner;
DO $$
DECLARE
  result record;
BEGIN
  BEGIN
    PERFORM 1 FROM piggyvest_staging.wallet_goal_mappings;
    RAISE EXCEPTION 'provisioner direct mapping read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT provider_wallet_id, provider_customer_id INTO STRICT result
    FROM piggyvest_staging.read_scoped_wallet_mapping(
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    );
  IF result.provider_wallet_id <> '60000000-0000-4000-8000-000000000001'
    OR result.provider_customer_id <> '70000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'exact scoped mapping projection mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM piggyvest_staging.read_scoped_wallet_mapping(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  )) OR EXISTS (SELECT 1 FROM piggyvest_staging.read_scoped_wallet_mapping(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001'
  )) OR EXISTS (SELECT 1 FROM piggyvest_staging.read_scoped_wallet_mapping(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000009'
  )) THEN
    RAISE EXCEPTION 'foreign scoped mapping resolved';
  END IF;
END $$;
RESET ROLE;

BEGIN;
UPDATE public.customer_savings_goals
  SET status = 'paused'
  WHERE id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE piggyvest_staging_provisioner;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_staging.read_scoped_wallet_mapping(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  )) THEN
    RAISE EXCEPTION 'inactive goal mapping resolved';
  END IF;
END $$;
ROLLBACK;

DO $$
BEGIN
  IF (SELECT status FROM public.customer_savings_goals
    WHERE id = '30000000-0000-4000-8000-000000000001') <> 'active' THEN
    RAISE EXCEPTION 'inactive goal rehearsal did not roll back';
  END IF;
END $$;

\echo PASS scoped private mapping read: provisioner-only, exact scope, active goal, rollback
