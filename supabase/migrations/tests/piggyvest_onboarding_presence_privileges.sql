-- Catalog-only ACL contract; registered in the CI PostgreSQL replay sql-checks.
DO $test$
DECLARE
  routine oid := pg_catalog.to_regprocedure(
    'piggyvest_primary.has_onboarding(jsonb)'
  );
BEGIN
  IF routine IS NULL THEN
    RAISE EXCEPTION 'onboarding presence function is missing';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'piggyvest_primary_provisioner', routine, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'provisioner cannot execute onboarding presence';
  END IF;

  IF pg_catalog.has_function_privilege('service_role', routine, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role can execute onboarding presence';
  END IF;

  IF pg_catalog.has_function_privilege('anon', routine, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', routine, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'application role can execute onboarding presence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) privilege
    WHERE p.oid = routine
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute onboarding presence';
  END IF;
END;
$test$;
