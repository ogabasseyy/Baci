-- REGRESSION TEST: the authorizer login cannot spend cancel or complete PIN
-- proofs (migration 20261103071442). Catalog checks only. S6/S7 re-grant this
-- once the proofs bind to a server-issued per-attempt operation id.

BEGIN;

DO $catalog$
DECLARE
  v_oid regprocedure := 'piggyvest_primary.consume_goal_pin_proof(jsonb,uuid,text,text)'::regprocedure;
  v_role text;
BEGIN
  IF pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'piggyvest_primary_authorizer must not execute consume_goal_pin_proof';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'consume_goal_pin_proof must not be executable by %', v_role;
    END IF;
  END LOOP;
  -- Funding stays reachable through the wrapper.
  IF NOT pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
    'piggyvest_primary.reserve_savings_with_pin(jsonb,jsonb,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'the authorizer must keep reserve_savings_with_pin';
  END IF;
END
$catalog$;

ROLLBACK;
