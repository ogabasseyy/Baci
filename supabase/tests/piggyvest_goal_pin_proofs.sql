-- REGRESSION TEST: PIN proof purposes and spend points for goal funding,
-- cancel and complete (migration 20261103044600).
--
-- Catalog checks only, never call-and-catch (a denied EXECUTE cannot be
-- trapped on the replay image). Registered in the replay registry folder
-- 20261103044600_piggyvest_goal_pin_proofs.

BEGIN;

DO $catalog$
DECLARE
  v_signature text;
  v_role text;
  v_oid regprocedure;
  v_purposes text[];
BEGIN
  SELECT pg_catalog.array_agg(purpose.purpose ORDER BY purpose.purpose)
    INTO v_purposes
    FROM wallet_pin_private.proof_purposes AS purpose
   WHERE purpose.purpose LIKE 'goal\_%';
  IF v_purposes IS DISTINCT FROM ARRAY['goal_cancel', 'goal_complete', 'goal_fund'] THEN
    RAISE EXCEPTION 'goal proof purposes missing or extra: %', v_purposes;
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.reserve_savings_with_pin(jsonb,jsonb,text)',
    'piggyvest_primary.consume_goal_pin_proof(jsonb,uuid,text,text)'
  ] LOOP
    v_oid := v_signature::regprocedure;
    IF NOT (SELECT proc.prosecdef FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER', v_signature;
    END IF;
    IF NOT COALESCE((SELECT proc.proconfig @> ARRAY['search_path=""']
                       FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid), false) THEN
      RAISE EXCEPTION '% must pin an empty search_path', v_signature;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not be executable by %', v_signature, v_role;
      END IF;
    END LOOP;
    -- consume_goal_pin_proof was revoked from the authorizer by migration
    -- 20261103071442 (see piggyvest_goal_pin_proof_consume_revoked.sql).
    IF v_signature NOT LIKE '%consume_goal_pin_proof%'
       AND NOT pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by piggyvest_primary_authorizer', v_signature;
    END IF;
    -- PUBLIC holds no EXECUTE: the ACL has no empty-grantee entry.
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS proc,
             pg_catalog.aclexplode(COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) AS acl
       WHERE proc.oid = v_oid AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION '% must not be executable by PUBLIC', v_signature;
    END IF;
  END LOOP;

  -- The executor login reaches the original reservation only through the
  -- wrapper: it must not execute reserve_savings(jsonb,jsonb) itself.
  v_oid := 'piggyvest_primary.reserve_savings(jsonb,jsonb)'::regprocedure;
  IF pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'piggyvest_primary_authorizer must not execute reserve_savings directly';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'reserve_savings must not be executable by %', v_role;
    END IF;
  END LOOP;
  -- The wrapper's owner can still run it (the definer path).
  IF NOT pg_catalog.has_function_privilege(
    (SELECT proc.proowner FROM pg_catalog.pg_proc AS proc
      WHERE proc.oid = 'piggyvest_primary.reserve_savings_with_pin(jsonb,jsonb,text)'::regprocedure),
    v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'the wrapper owner must keep EXECUTE on reserve_savings';
  END IF;
END
$catalog$;

ROLLBACK;
