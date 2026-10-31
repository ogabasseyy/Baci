-- Include-only part of public_definer_function_exposure.sql (no BEGIN/ROLLBACK): the
-- entry point owns the transaction and loads this file with \ir.
--
-- (a) A throwaway function created as the migration owner is not executable by
-- anon, authenticated or PUBLIC, in schema public and in a brand-new schema, and
-- service_role keeps its default grant in public.

DO $defaults$
DECLARE
  v_probe record;
BEGIN
  SET LOCAL ROLE postgres;

  CREATE FUNCTION public.zz_definer_exposure_probe()
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = ''
  AS 'SELECT 1';

  CREATE SCHEMA zz_definer_exposure_probe;
  CREATE FUNCTION zz_definer_exposure_probe.probe()
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = ''
  AS 'SELECT 1';

  FOR v_probe IN
    SELECT
      proc.oid,
      pg_catalog.pg_get_userbyid(proc.proowner) AS owner_name,
      namespace.nspname || '.' || proc.proname AS function_name,
      COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner)) AS effective_acl
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = proc.pronamespace
    WHERE (namespace.nspname, proc.proname) IN (
      ('public', 'zz_definer_exposure_probe'),
      ('zz_definer_exposure_probe', 'probe')
    )
    ORDER BY 3
  LOOP
    IF v_probe.owner_name <> 'postgres' THEN
      RAISE EXCEPTION 'probe % must be owned by the migration owner postgres, got %',
        v_probe.function_name, v_probe.owner_name;
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_probe.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'new function % is executable by anon: default privileges are open',
        v_probe.function_name;
    END IF;

    IF pg_catalog.has_function_privilege('authenticated', v_probe.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'new function % is executable by authenticated: default privileges are open',
        v_probe.function_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(v_probe.effective_acl) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'new function % has an EXECUTE grant to PUBLIC: the global built-in default is open',
        v_probe.function_name;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
    'service_role', 'public.zz_definer_exposure_probe()'::pg_catalog.regprocedure, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must keep its default EXECUTE grant on new public functions';
  END IF;

  RESET ROLE;
END
$defaults$;

