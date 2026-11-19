-- Catalog-only ACL and shape contract for piggyvest_primary.has_onboarding(jsonb)
-- (20261102121549_piggyvest_onboarding_presence.sql). A denied EXECUTE cannot
-- be trapped on the replay image, so every denial is read from the catalog.
--
-- On the replay image this is a regression guard: no default privilege there
-- gives service_role, client roles or PUBLIC EXECUTE on a new function in this
-- schema, so it catches a later explicit grant but cannot by itself prove the
-- migration's REVOKE. The isolated harness
-- (apps/web/src/lib/piggyvest/primary-wallet-presence.integration.sql) seeds
-- default EXECUTE for each of those grantees before applying the migration,
-- so there these assertions fail unless the REVOKE names every one of them.
DO $test$
DECLARE
  routine regprocedure := pg_catalog.to_regprocedure(
    'piggyvest_primary.has_onboarding(jsonb)'
  );
  principal text;
BEGIN
  IF routine IS NULL THEN
    RAISE EXCEPTION 'onboarding presence function is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = routine
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog']
      AND p.prorettype = 'pg_catalog.bool'::pg_catalog.regtype
  ) THEN
    RAISE EXCEPTION 'onboarding presence must be a boolean SECURITY DEFINER with search_path pg_catalog';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'piggyvest_primary_provisioner', routine, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'provisioner cannot execute onboarding presence';
  END IF;

  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(principal, routine, 'EXECUTE') THEN
      RAISE EXCEPTION '% can execute onboarding presence', principal;
    END IF;
  END LOOP;

  -- The explicit ACL holds only the owner and the provisioner: no PUBLIC
  -- (grantee 0) entry and no other direct grantee.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) privilege
    WHERE p.oid = routine
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> p.proowner
      AND privilege.grantee <> 'piggyvest_primary_provisioner'::pg_catalog.regrole
  ) THEN
    RAISE EXCEPTION 'onboarding presence is executable beyond the provisioner';
  END IF;
END;
$test$;
