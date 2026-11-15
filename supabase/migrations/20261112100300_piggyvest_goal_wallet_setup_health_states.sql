BEGIN;
-- Names the in-flight setup states the stalled-setup read counts
-- (dispatched, unknown, accepted) instead of "anything not enrolled", so a
-- state added to goal_wallet_intents later can never page as stuck. Today the
-- table allows only those three plus enrolled, so the count is unchanged.
-- Same signature, VOLATILE (it reads the wall clock), same grants.
-- Append-only: replaces the function from 20261112100000.
CREATE OR REPLACE FUNCTION piggyvest_primary.read_goal_wallet_setup_health(integration_id uuid,environment text,options jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  stale_seconds integer;
  as_of timestamptz;
  stalled integer;
BEGIN
  IF options IS NULL OR jsonb_typeof(options)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(options))<>1
    OR COALESCE(jsonb_typeof(options->'staleAfterSeconds')='number',false) IS NOT TRUE
    OR COALESCE((options->>'staleAfterSeconds') ~ '^[0-9]{2,5}$',false) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid goal wallet health options' USING ERRCODE='22023';
  END IF;
  stale_seconds:=(options->>'staleAfterSeconds')::integer;
  IF stale_seconds NOT BETWEEN 60 AND 86400 THEN
    RAISE EXCEPTION 'invalid goal wallet health options' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=read_goal_wallet_setup_health.integration_id
      AND binding.environment=read_goal_wallet_setup_health.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER;
  IF NOT FOUND THEN RAISE EXCEPTION 'goal wallet health authority unavailable' USING ERRCODE='42501'; END IF;
  as_of:=pg_catalog.clock_timestamp();
  SELECT count(*)::integer INTO stalled
    FROM piggyvest_primary.goal_wallet_intents intent
    -- Only goals whose setup can still finish: setup requires an active goal,
    -- so a goal cancelled or completed mid-setup is never counted as stuck.
    JOIN public.customer_savings_goals goal ON goal.id=intent.goal_id AND goal.status='active'
    WHERE intent.integration_id=read_goal_wallet_setup_health.integration_id
      -- The in-flight states, named: a state added later (a terminal failure,
      -- say) is never counted as stuck. "<> 'enrolled'" stays so the partial
      -- index on not-yet-enrolled setups still serves this scan.
      AND intent.state<>'enrolled'
      AND intent.state IN ('dispatched','unknown','accepted')
      AND intent.created_at<=as_of-pg_catalog.make_interval(secs=>stale_seconds);
  RETURN pg_catalog.jsonb_build_object('generatedAt',as_of,'staleAfterSeconds',stale_seconds,'stalledGoalWallets',stalled);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_goal_wallet_setup_health(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_wallet_setup_health(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
