BEGIN;
-- Goal-wallet setup health read (PiggyVest degraded-health alert). Read-only:
-- it changes no row and returns one number, with no ids and no customer data:
-- how many goal-wallet setups of the integration are not yet enrolled more
-- than staleAfterSeconds after they started (created_at, when the customer
-- chose the wallet; updated_at is refreshed by every retry, so it would keep
-- a long-stuck setup looking young). The caller must be the evidence login
-- bound to the integration (the same authority read_daily_reconciliation
-- checks); any other caller, or a disabled binding, gets 42501. Options must
-- be exactly {"staleAfterSeconds": <whole number from 60 to 86400>};
-- anything else gets 22023, never a default.
CREATE OR REPLACE FUNCTION piggyvest_primary.read_goal_wallet_setup_health(integration_id uuid,environment text,options jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
    WHERE intent.integration_id=read_goal_wallet_setup_health.integration_id
      AND intent.state<>'enrolled'
      AND intent.created_at<=as_of-pg_catalog.make_interval(secs=>stale_seconds);
  RETURN pg_catalog.jsonb_build_object('generatedAt',as_of,'staleAfterSeconds',stale_seconds,'stalledGoalWallets',stalled);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_goal_wallet_setup_health(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_wallet_setup_health(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
