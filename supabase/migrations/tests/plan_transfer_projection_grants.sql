BEGIN;
CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
DO $$
BEGIN
  IF to_regprocedure(
    'public.allocate_plan_transfer_contribution(uuid,uuid,bigint,text,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'plan transfer projection RPC is missing';
  END IF;
  IF to_regprocedure(
    'public.allocate_plan_transfer_contribution(uuid,uuid,bigint,text,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'stale census-only projection overload must be dropped';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.allocate_plan_transfer_contribution(uuid,uuid,bigint,text,text,text,text)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not execute the plan transfer projection RPC';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.allocate_plan_transfer_contribution(uuid,uuid,bigint,text,text,text,text)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute the plan transfer projection RPC';
  END IF;
END;
$$ LANGUAGE plpgsql;
ROLLBACK;
