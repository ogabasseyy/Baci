-- Keep in-flight primary savings transfers recoverable across goal
-- cancellation. A dispatched-but-unsettled contribution has not yet
-- grown current_amount, so cancel_customer_savings_goal_future_debits
-- marks the goal 'cancelled'; the later settlement then credited a goal
-- that is no longer exposed as active savings, stranding customer funds.
-- Two coordinated changes:
-- 1. Cancellation raises while any primary savings operation for the goal
--    is still reserved or dispatched. The goal row lock is already held,
--    and both reserve and settle take that same lock, so no transfer can
--    sneak into flight between the check and the status change. The
--    message keeps the 'not_cancellable' marker so the route still maps
--    it to 409 for retry after the transfer resolves.
-- 2. Settlement flips a 'cancelled' goal back to 'paused' when its funds
--    land, preserving the codebase invariant that a goal holding money is
--    never 'cancelled' (cancel itself pauses funded goals). No future
--    debits resume: future_debits_cancelled_at is untouched.
BEGIN;
CREATE OR REPLACE FUNCTION public.cancel_customer_savings_goal_future_debits(
  p_goal_id uuid,
  p_customer_id uuid,
  p_merchant_id uuid,
  p_actor_id uuid DEFAULT NULL
) RETURNS TABLE(success boolean, goal_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_goal record;
  v_goal_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'authentication_required'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p_customer_id
        AND c.merchant_id = p_merchant_id
        AND c.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_authorized_for_customer_savings'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT *
  INTO v_goal
  FROM public.customer_savings_goals
  WHERE id = p_goal_id
    AND customer_id = p_customer_id
    AND merchant_id = p_merchant_id
  FOR UPDATE;

  IF v_goal.id IS NULL THEN
    RAISE EXCEPTION 'savings_goal_not_found'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_goal.status IN ('spent', 'cancelled') THEN
    RAISE EXCEPTION 'savings_goal_not_cancellable'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM piggyvest_primary.savings_operations pending
    WHERE pending.goal_id = p_goal_id AND pending.state IN ('reserved', 'dispatched')
  ) THEN
    RAISE EXCEPTION 'savings_goal_not_cancellable_pending_transfer'
      USING ERRCODE = 'P0001';
  END IF;

  v_goal_status := CASE
    WHEN v_goal.current_amount > 0 THEN 'paused'
    ELSE 'cancelled'
  END;

  UPDATE public.customer_savings_goals
  SET
    status = v_goal_status,
    future_debits_cancelled_at = now(),
    cancelled_at = CASE WHEN v_goal_status = 'cancelled' THEN now() ELSE cancelled_at END,
    updated_at = now()
  WHERE id = p_goal_id;

  INSERT INTO public.customer_savings_events (
    goal_id,
    merchant_id,
    customer_id,
    event_type,
    actor_type,
    actor_id,
    metadata
  )
  VALUES (
    p_goal_id,
    p_merchant_id,
    p_customer_id,
    'future_debits_cancelled',
    'customer',
    p_actor_id,
    jsonb_build_object('status', v_goal_status)
  );

  RETURN QUERY SELECT true, v_goal_status;
END;
$$;
CREATE OR REPLACE FUNCTION piggyvest_primary.settle_savings(integration_id uuid,environment text,proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary.savings_operations%ROWTYPE;
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
  binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  SELECT candidate.* INTO binding FROM piggyvest_primary.integrations candidate
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=candidate.id
    WHERE candidate.id=settle_savings.integration_id AND candidate.environment=settle_savings.environment
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
  UPDATE public.customer_wallet_transactions transaction SET status='completed',description='Savings contribution confirmed'
    WHERE transaction.id=operation.wallet_transaction_id AND transaction.customer_id=intent.customer_id
      AND transaction.merchant_id=intent.merchant_id AND transaction.source_id=operation.id
      AND transaction.source_type='piggyvest_primary_savings' AND transaction.status='pending'
      AND transaction.amount=operation.amount_kobo::numeric/100;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings hold unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,wallet_transaction_id,amount,source_type,status,processed_at,idempotency_key,metadata)
    VALUES(operation.goal_id,intent.merchant_id,intent.customer_id,operation.wallet_transaction_id,operation.amount_kobo::numeric/100,'wallet','completed',pg_catalog.clock_timestamp(),operation.reference,
      jsonb_build_object('provider','piggyvest','provider_transaction_id',proof->>'providerTransactionId'));
  UPDATE piggyvest_primary.savings_operations SET state='confirmed',provider_transaction_id=proof->>'providerTransactionId' WHERE id=operation.id;
  RETURN 'confirmed';
END $$;
COMMIT;
