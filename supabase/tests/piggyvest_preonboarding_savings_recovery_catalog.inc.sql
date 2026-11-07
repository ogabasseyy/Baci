-- Included by piggyvest_preonboarding_savings_recovery.sql inside its transaction.
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
