-- Retire card top-up into the PiggyVest primary wallet at the database.
--
-- The web initialize route already answers 410 PRIMARY_CARD_FUNDING_RETIRED
-- before reading any configuration, and the app's card executor no longer
-- carries SQL for these functions. This migration makes the database refuse
-- too, so the refusal never depends on a flag or an environment variable:
-- no role may execute the three initialization steps (reserve,
-- claim_initialization, record_initialization), in any overload.
--
-- Revoked from PUBLIC, the Supabase API roles, both card capability roles,
-- the function owner itself and every other grantee on the function's
-- access list, with CASCADE so grants passed on through a grant option go
-- too. That last sweep covers grants that exist only in production, such as
-- a direct grant to a login role created outside migrations. Only a
-- superuser can still run the functions, and nothing calls them.
--
-- The migration then checks its own result and aborts if PUBLIC or any
-- non-superuser role can still execute one of them, so a grant it could not
-- remove stops the deploy instead of leaving initialization executable.
--
-- The drain keeps its grants: read_operation for status
-- (primary_card_authorizer) and record_collection, record_abandonment,
-- flag_reconciliation and select_stale_ready_checkouts for evidence and the
-- abandonment CLI (primary_card_evidence), so operations created before
-- retirement still resolve.
--
-- Fails loudly if a function is missing instead of skipping it: a missing
-- function would mean the schema is not the one this retirement asserts.
--
-- One DO statement, so it applies atomically on its own and can be
-- re-applied inside the catalog suite's rolled-back transaction.
DO $$
DECLARE
  v_name text;
  v_function record;
  v_grantee oid;
  v_found integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'reserve',
    'claim_initialization',
    'record_initialization'
  ]
  LOOP
    v_found := 0;
    FOR v_function IN
      SELECT
        p.oid,
        p.oid::pg_catalog.regprocedure AS signature,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
      FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'piggyvest_primary_card'::pg_catalog.regnamespace
        AND p.proname = v_name
    LOOP
      v_found := v_found + 1;
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, '
          'service_role, primary_card_authorizer, primary_card_evidence, %I '
          'CASCADE',
        v_function.signature,
        v_function.owner_name
      );

      FOR v_grantee IN
        SELECT DISTINCT acl.grantee
        FROM pg_catalog.pg_proc fn
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(fn.proacl, pg_catalog.acldefault('f', fn.proowner))
        ) AS acl
        WHERE fn.oid = v_function.oid
          AND acl.privilege_type = 'EXECUTE'
      LOOP
        IF v_grantee = 0 THEN
          EXECUTE pg_catalog.format(
            'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC CASCADE',
            v_function.signature
          );
        ELSE
          EXECUTE pg_catalog.format(
            'REVOKE EXECUTE ON FUNCTION %s FROM %I CASCADE',
            v_function.signature,
            pg_catalog.pg_get_userbyid(v_grantee)
          );
        END IF;
      END LOOP;

      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc fn
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(fn.proacl, pg_catalog.acldefault('f', fn.proowner))
        ) AS acl
        WHERE fn.oid = v_function.oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ) THEN
        RAISE EXCEPTION 'PUBLIC can still execute %', v_function.signature;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles r
        WHERE NOT r.rolsuper
          AND pg_catalog.has_function_privilege(
            r.oid,
            v_function.oid,
            'EXECUTE'
          )
      ) THEN
        RAISE EXCEPTION 'a non-superuser role can still execute %',
          v_function.signature;
      END IF;
    END LOOP;

    IF v_found = 0 THEN
      RAISE EXCEPTION 'piggyvest_primary_card.% is missing', v_name;
    END IF;
  END LOOP;
END
$$;
