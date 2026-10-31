-- Retire card top-up into the PiggyVest primary wallet at the database.
--
-- The web initialize route already answers 410 PRIMARY_CARD_FUNDING_RETIRED
-- before reading any configuration, and the app's card executor no longer
-- carries SQL for these functions. This migration makes the database refuse
-- too, so the refusal never depends on a flag or an environment variable:
-- no role may execute the three initialization steps (reserve,
-- claim_initialization, record_initialization), in any overload.
--
-- Revoked from PUBLIC, the Supabase API roles, both card capability roles
-- and the function owner itself; only a superuser can still run them, and
-- nothing calls them. The drain keeps its grants: read_operation for status
-- (primary_card_authorizer) and record_collection, record_abandonment,
-- flag_reconciliation and select_stale_ready_checkouts for evidence and the
-- abandonment CLI (primary_card_evidence), so operations created before
-- retirement still resolve.
--
-- Fails loudly if a function is missing instead of skipping it: a missing
-- function would mean the schema is not the one this retirement asserts.
BEGIN;

DO $$
DECLARE
  v_name text;
  v_function record;
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
        p.oid::pg_catalog.regprocedure AS signature,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
      FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'piggyvest_primary_card'::pg_catalog.regnamespace
        AND p.proname = v_name
    LOOP
      v_found := v_found + 1;
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, '
          'service_role, primary_card_authorizer, primary_card_evidence, %I',
        v_function.signature,
        v_function.owner_name
      );
    END LOOP;

    IF v_found = 0 THEN
      RAISE EXCEPTION 'piggyvest_primary_card.% is missing', v_name;
    END IF;
  END LOOP;
END
$$;

COMMIT;
