-- The cancel-guard migration (20261008091700) CREATE OR REPLACE'd
-- piggyvest_primary.settle_savings, which at that point held the
-- paid-interest completion wrapper installed by 20261007181000. The
-- wrapper's pending-capacity fencing (completion_totals consult plus
-- savings_completion_evidence recording) was silently replaced by the
-- bare principal-only capacity check, so over-capacity settlements
-- raise 'savings settlement capacity unavailable' instead of fencing
-- the transfer into completion review with durable evidence.
--
-- This repair reinstalls the wrapper on top of the cancel-guard body.
-- Production order is settlement -> interest-completion -> cancel-guard
-- -> this repair. The guard also accepts the already-repaired state
-- (outer delegates to the inner body and records evidence, e.g. when
-- interest-completion replays after cancel-guard in fixture worlds) as
-- a no-op, and refuses any other shape loudly instead of stacking
-- wrappers or orphaning bodies.
BEGIN;
DO $repair$
DECLARE
  outer_def text;
  inner_def text;
BEGIN
  IF to_regclass('piggyvest_primary.savings_completion_evidence') IS NULL THEN
    RAISE EXCEPTION 'completion evidence missing for settlement repair';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(to_regprocedure('piggyvest_primary.settle_savings(uuid,text,jsonb)')) INTO outer_def;
  IF outer_def IS NULL THEN
    RAISE EXCEPTION 'settle_savings missing for completion repair';
  END IF;
  IF outer_def LIKE '%settle_savings_before_completion(%'
    AND outer_def LIKE '%savings_completion_evidence%' THEN
    SELECT pg_catalog.pg_get_functiondef(to_regprocedure('piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)')) INTO inner_def;
    IF inner_def IS NULL OR inner_def NOT LIKE '%THEN ''paused''%' THEN
      RAISE EXCEPTION 'settlement repair inner body missing cancel behavior';
    END IF;
    RETURN;
  END IF;
  IF outer_def NOT LIKE '%THEN ''paused''%' THEN
    RAISE EXCEPTION 'settle_savings body unrecognized for completion repair';
  END IF;
  EXECUTE 'DROP FUNCTION IF EXISTS piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)';
  EXECUTE 'ALTER FUNCTION piggyvest_primary.settle_savings(uuid,text,jsonb) RENAME TO settle_savings_before_completion';
  SELECT pg_get_functiondef('piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)'::regprocedure) INTO inner_def;
  EXECUTE replace(inner_def, 'settle_savings.', 'settle_savings_before_completion.');
  EXECUTE 'REVOKE ALL ON FUNCTION piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)'
    ' FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_evidence';
  EXECUTE $wrapper$CREATE FUNCTION piggyvest_primary.settle_savings(integration_id uuid,environment text,proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary.savings_operations%ROWTYPE;
  integration piggyvest_primary.integrations%ROWTYPE;
  totals record;
  principal numeric;
  target numeric;
BEGIN
  SELECT candidate.* INTO integration FROM piggyvest_primary.integrations candidate
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=candidate.id
    WHERE candidate.id=settle_savings.integration_id AND candidate.environment=settle_savings.environment
      AND candidate.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF candidate,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE='42501'; END IF;
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate
    WHERE candidate.id=(proof->>'operationId')::uuid AND candidate.integration_id=integration.id;
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('primary-savings:'||operation.intent_id::text,0));
  END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.savings_completion_evidence saved
    WHERE saved.operation_id=(settle_savings.proof->>'operationId')::uuid AND saved.integration_id=integration.id
      AND saved.proof IS DISTINCT FROM settle_savings.proof) THEN RETURN 'conflict'; END IF;
  BEGIN
    RETURN piggyvest_primary.settle_savings_before_completion(integration_id,environment,proof);
  EXCEPTION WHEN SQLSTATE 'P0001' OR SQLSTATE '42501' THEN
    IF SQLERRM NOT IN ('savings_contribution_exceeds_remaining_target','savings settlement capacity unavailable') THEN RAISE; END IF;
  END;
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate
    WHERE candidate.id=(proof->>'operationId')::uuid AND candidate.integration_id=integration.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('primary-savings:'||operation.intent_id::text,0));
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate WHERE candidate.id=operation.id FOR UPDATE;
  IF operation.state<>'dispatched' OR operation.amount_kobo<>(proof->>'amountKobo')::numeric
    OR operation.reference<>proof->>'reference' OR operation.source_wallet_id<>proof->>'sourceWalletId'
    OR operation.destination_wallet_id<>proof->>'destinationWalletId' OR integration.business_id<>proof->>'businessId'
    OR NOT EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents intent
      JOIN public.customers customer ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
      JOIN public.customer_savings_goals goal ON goal.id=operation.goal_id AND goal.customer_id=intent.customer_id AND goal.merchant_id=intent.merchant_id
      WHERE intent.id=operation.intent_id AND intent.integration_id=integration.id AND intent.merchant_id=integration.merchant_id
        AND intent.state IN ('accepted','verified') AND intent.provider_wallet_id=operation.source_wallet_id) THEN RETURN 'conflict'; END IF;
  SELECT goal.current_amount*100,goal.target_amount*100 INTO principal,target
    FROM public.customer_savings_goals goal WHERE goal.id=operation.goal_id FOR UPDATE;
  SELECT scoped.* INTO totals FROM public.customer_savings_goals goal
    CROSS JOIN LATERAL piggyvest_primary.completion_totals(goal.id,goal.merchant_id,goal.customer_id) scoped
    WHERE goal.id=operation.goal_id AND scoped.integration_id=integration.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings completion review scope unavailable' USING ERRCODE='42501'; END IF;
  IF principal+totals.paid_interest_kobo+totals.pending_kobo<=target THEN
    RAISE EXCEPTION 'savings completion review capacity mismatch' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.savings_operations saved
    WHERE saved.integration_id=integration.id AND saved.provider_transaction_id=proof->>'providerTransactionId' AND saved.id<>operation.id) THEN RETURN 'conflict'; END IF;
  INSERT INTO piggyvest_primary.savings_completion_evidence(operation_id,integration_id,provider_transaction_id,proof)
    VALUES(operation.id,integration.id,settle_savings.proof->>'providerTransactionId',settle_savings.proof) ON CONFLICT DO NOTHING;
  UPDATE public.customer_savings_goals goal SET status=goal.status WHERE goal.id=operation.goal_id;
  RETURN 'conflict';
END $$;$wrapper$;
  EXECUTE 'REVOKE ALL ON FUNCTION piggyvest_primary.settle_savings(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_savings(uuid,text,jsonb) TO piggyvest_primary_evidence';
END $repair$;
COMMIT;
