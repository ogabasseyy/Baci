-- GL-A (savings and goal cancel settlement).
-- settle_savings_before_completion completes a legacy hold only when one exists
-- (the contribution row is written either way). settle_goal_cancel returns the
-- refund to the PiggyVest main wallet at PiggyVest, so it no longer credits
-- customer_wallets or writes a wallet transaction; everything else (state
-- machine, proof binding, needs_review, goal update, event, alerts) is unchanged.
-- Same signatures as the current definitions, so grants persist through
-- CREATE OR REPLACE. Dark until the PiggyVest primary flags are on.
BEGIN;
DO $guard$
BEGIN
  IF to_regprocedure('piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'settle_savings_before_completion missing; apply the settlement repair first';
  END IF;
END $guard$;

-- Settlement (the inner body behind the completion wrapper): complete a legacy
-- hold only when one exists. The contribution row is written either way.
CREATE OR REPLACE FUNCTION piggyvest_primary.settle_savings_before_completion(integration_id uuid,environment text,proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary.savings_operations%ROWTYPE;
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
  binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  SELECT candidate.* INTO binding FROM piggyvest_primary.integrations candidate
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=candidate.id
    WHERE candidate.id=settle_savings_before_completion.integration_id AND candidate.environment=settle_savings_before_completion.environment
      AND candidate.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF candidate,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE='42501'; END IF;
  IF proof IS NULL OR jsonb_typeof(proof)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(proof))<>7
    OR NOT proof ?& ARRAY['operationId','providerTransactionId','reference','amountKobo','sourceWalletId','destinationWalletId','businessId']
    OR jsonb_typeof(proof->'amountKobo') IS DISTINCT FROM 'number'
    OR COALESCE(proof->>'amountKobo','') !~ '^[0-9]+$'
    OR EXISTS(SELECT 1 FROM jsonb_each(proof) field WHERE field.key<>'amountKobo' AND
      (jsonb_typeof(field.value) IS DISTINCT FROM 'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512)) THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE='22023';
  END IF;
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate
    WHERE candidate.id=(proof->>'operationId')::uuid AND candidate.integration_id=binding.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('primary-savings:' || operation.intent_id::text,0));
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate WHERE candidate.id=operation.id FOR UPDATE;
  SELECT candidate.* INTO intent FROM piggyvest_primary.onboarding_intents candidate
    JOIN public.customers customer ON customer.id=candidate.customer_id AND customer.merchant_id=candidate.merchant_id AND customer.user_id=candidate.user_id
    WHERE candidate.id=operation.intent_id AND candidate.integration_id=binding.id AND candidate.state IN ('accepted','verified') FOR SHARE OF candidate,customer;
  IF NOT FOUND OR intent.provider_wallet_id<>operation.source_wallet_id
    OR operation.amount_kobo<>(proof->>'amountKobo')::bigint OR operation.reference<>proof->>'reference'
    OR operation.source_wallet_id<>proof->>'sourceWalletId' OR operation.destination_wallet_id<>proof->>'destinationWalletId'
    OR binding.business_id<>proof->>'businessId' THEN RETURN 'conflict'; END IF;
  IF operation.state='confirmed' THEN
    IF operation.provider_transaction_id=proof->>'providerTransactionId' THEN RETURN 'duplicate'; END IF;
    RETURN 'conflict';
  END IF;
  IF operation.state<>'dispatched' THEN RETURN 'conflict'; END IF;
  PERFORM candidate.id FROM piggyvest_primary.savings_operations candidate
    WHERE candidate.integration_id=binding.id AND candidate.provider_transaction_id=proof->>'providerTransactionId';
  IF FOUND THEN RETURN 'conflict'; END IF;
  UPDATE public.customer_savings_goals goal SET current_amount=goal.current_amount+operation.amount_kobo::numeric/100,
      status=CASE WHEN goal.status='cancelled' THEN 'paused' ELSE goal.status END
    WHERE goal.id=operation.goal_id AND goal.customer_id=intent.customer_id AND goal.merchant_id=intent.merchant_id
      AND goal.current_amount+operation.amount_kobo::numeric/100<=goal.target_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings settlement capacity unavailable' USING ERRCODE='42501'; END IF;
  IF operation.wallet_transaction_id IS NOT NULL THEN
    UPDATE public.customer_wallet_transactions transaction SET status='completed',description='Savings contribution confirmed'
      WHERE transaction.id=operation.wallet_transaction_id AND transaction.customer_id=intent.customer_id
        AND transaction.merchant_id=intent.merchant_id AND transaction.source_id=operation.id
        AND transaction.source_type='piggyvest_primary_savings' AND transaction.status='pending'
        AND transaction.amount=operation.amount_kobo::numeric/100;
    IF NOT FOUND THEN RAISE EXCEPTION 'savings hold unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,wallet_transaction_id,amount,source_type,status,processed_at,idempotency_key,metadata)
    VALUES(operation.goal_id,intent.merchant_id,intent.customer_id,operation.wallet_transaction_id,operation.amount_kobo::numeric/100,'wallet','completed',pg_catalog.clock_timestamp(),operation.reference,
      jsonb_build_object('provider','piggyvest','provider_transaction_id',proof->>'providerTransactionId'));
  UPDATE piggyvest_primary.savings_operations SET state='confirmed',provider_transaction_id=proof->>'providerTransactionId' WHERE id=operation.id;
  RETURN 'confirmed';
END $$;


-- Goal cancel settlement: the refund returns to the PiggyVest main wallet, so
-- nothing is credited to the legacy balance. Everything else is unchanged.
CREATE OR REPLACE FUNCTION piggyvest_primary.settle_goal_cancel(
  integration_id uuid,
  environment text,
  proof jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_now timestamptz;
  v_late boolean := false;
  v_review boolean := false;
  v_goal_amount numeric;
  v_residual bigint := 0;
  v_target text;
BEGIN
  SELECT candidate.* INTO v_binding FROM piggyvest_primary.integrations AS candidate
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = candidate.id
   WHERE candidate.id = settle_goal_cancel.integration_id
     AND candidate.environment = settle_goal_cancel.environment
     AND candidate.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF candidate, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE = '42501';
  END IF;
  IF piggyvest_primary.goal_cancel_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS candidate
   WHERE candidate.id = (proof ->> 'operationId')::uuid AND candidate.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS candidate
   WHERE candidate.id = v_operation.id FOR UPDATE;
  SELECT candidate.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS candidate
    JOIN public.customers AS customer
      ON customer.id = candidate.customer_id AND customer.merchant_id = candidate.merchant_id
     AND customer.user_id = candidate.user_id
   WHERE candidate.id = v_operation.intent_id AND candidate.integration_id = v_binding.id
     AND candidate.state IN ('accepted', 'verified')
     FOR SHARE OF candidate, customer;
  IF NOT FOUND
    OR v_intent.provider_wallet_id IS DISTINCT FROM v_operation.destination_wallet_id
    OR v_operation.amount_kobo IS DISTINCT FROM (proof ->> 'amountKobo')::bigint
    OR v_operation.reference IS DISTINCT FROM proof ->> 'reference'
    OR v_operation.source_wallet_id IS DISTINCT FROM proof ->> 'sourceWalletId'
    OR v_operation.destination_wallet_id IS DISTINCT FROM proof ->> 'destinationWalletId'
    OR v_binding.business_id IS DISTINCT FROM proof ->> 'businessId' THEN
    RETURN 'conflict';
  END IF;
  IF v_operation.state IN ('confirmed', 'needs_review', 'reviewed') THEN
    IF v_operation.provider_transaction_id = proof ->> 'providerTransactionId' THEN
      RETURN 'duplicate';
    END IF;
    RETURN 'conflict';
  END IF;
  IF v_operation.state = 'released' AND v_operation.dispatched_at IS NOT NULL THEN
    -- A late success: the provider indexed the transfer after it was released.
    -- The money has moved, so the verified record settles it, unless another
    -- attempt for the goal is already live.
    IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS live
                WHERE live.goal_id = v_operation.goal_id AND live.id <> v_operation.id
                  AND live.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review')) THEN
      RETURN 'conflict';
    END IF;
    v_late := true;
  ELSIF v_operation.state <> 'dispatched' THEN
    RETURN 'conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS other
              WHERE other.integration_id = v_binding.id
                AND other.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
                WHERE funding.integration_id = v_binding.id
                  AND funding.provider_transaction_id = proof ->> 'providerTransactionId') THEN
    RETURN 'conflict';
  END IF;
  -- Every row this settlement writes is locked first, and each write reads
  -- the clock itself, so no timestamp predates a lock wait. The goal row is
  -- locked here for both the late check and the final update.
  v_residual := COALESCE((proof ->> 'residualKobo')::bigint, 0);
  SELECT goal.current_amount INTO v_goal_amount FROM public.customer_savings_goals AS goal
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id FOR UPDATE;
  -- A goal wallet that still holds money at the provider after the transfer
  -- (a credit landed between the balance snapshot and the transfer) is never
  -- settled as cancelled-at-zero. A late success settles ONLY its own amount:
  -- the goal may have been funded again after this attempt was released (the
  -- funding fence ignores released attempts), so when funding was reserved
  -- after the dispatch, or any local balance would remain once this refund is
  -- deducted, the attempt becomes 'needs_review'. The refund itself is still
  -- settled, the goal stays open, and the caller is told 'conflict' so an
  -- operator is paged.
  IF v_late THEN
    v_review := EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
                         WHERE funding.goal_id = v_operation.goal_id
                           AND funding.state IN ('reserved', 'dispatched', 'confirmed')
                           AND funding.created_at >= v_operation.dispatched_at)
      OR COALESCE(v_goal_amount - v_operation.amount_kobo::numeric / 100, 0) > 0;
  END IF;
  v_review := v_review OR v_residual > 0;
  v_target := CASE WHEN v_review THEN 'needs_review' ELSE 'confirmed' END;
  UPDATE piggyvest_primary.goal_cancel_operations
     SET state = v_target, provider_transaction_id = proof ->> 'providerTransactionId',
         settled_at = pg_catalog.clock_timestamp()
   WHERE id = v_operation.id;
  -- The money returns to the customer's PiggyVest main wallet at PiggyVest, the
  -- system of record. The legacy in-house balance (public.customer_wallets) is
  -- NOT credited and no spendable customer_wallet_transactions row is written:
  -- funding no longer debits it, so crediting it here would mint spendable
  -- balance out of PiggyVest money. The attempt row (state, settled_at,
  -- provider_transaction_id) and the savings event below are the record.
  -- The refund has reached the main wallet, so the goal no longer holds the
  -- refunded money. A goal row that is gone or already spent does not undo a
  -- settled transfer. Under review the goal stays open, drops by this refund's
  -- own amount ONLY. The provider residual is never booked here: a funding
  -- operation the provider already completed but that is not settled locally
  -- is part of that residual and is booked once, when it settles. The residual
  -- itself is left to the operator (needs_review).
  v_now := pg_catalog.clock_timestamp();
  UPDATE public.customer_savings_goals AS goal
     SET status = CASE WHEN v_review THEN goal.status ELSE 'cancelled' END,
         cancelled_at = CASE WHEN v_review THEN goal.cancelled_at ELSE v_now END,
         future_debits_cancelled_at = CASE WHEN v_review THEN goal.future_debits_cancelled_at
           ELSE COALESCE(goal.future_debits_cancelled_at, v_now) END,
         current_amount = CASE
           WHEN v_review THEN GREATEST(0, goal.current_amount - v_operation.amount_kobo::numeric / 100)
           ELSE 0 END,
         updated_at = v_now
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id AND goal.status <> 'spent';
  IF FOUND THEN
    INSERT INTO public.customer_savings_events
      (goal_id, merchant_id, customer_id, event_type, actor_type, metadata)
    VALUES (v_operation.goal_id, v_intent.merchant_id, v_intent.customer_id,
      CASE WHEN v_review THEN 'goal_cancel_needs_review' ELSE 'goal_cancelled_refunded' END, 'system',
      pg_catalog.jsonb_build_object('operation_id', v_operation.id, 'amount_kobo', v_operation.amount_kobo));
  END IF;
  IF v_review THEN RETURN 'conflict'; END IF;
  RETURN 'confirmed';
END;
$$;

REVOKE EXECUTE ON FUNCTION
  piggyvest_primary.settle_savings_before_completion(uuid, text, jsonb),
  piggyvest_primary.settle_goal_cancel(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_goal_cancel(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
COMMIT;
