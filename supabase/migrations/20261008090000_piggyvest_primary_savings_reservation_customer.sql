BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.reserve_savings(scope jsonb, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  resolved_intent_id uuid := piggyvest_primary.assert_savings_scope(scope);
  operation piggyvest_primary.savings_operations%ROWTYPE;
  goal public.customer_savings_goals%ROWTYPE;
  destination piggyvest_primary.savings_destinations%ROWTYPE;
  amount bigint;
  available_kobo numeric;
  capacity_kobo numeric;
  wallet_id uuid;
  wallet_balance numeric;
  transaction_id uuid:=pg_catalog.gen_random_uuid();
  source_wallet text;
  source_customer text;
BEGIN
  IF request IS NULL OR jsonb_typeof(request)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(request))<>3
    OR NOT request ?& ARRAY['goalId','operationId','amountKobo'] OR jsonb_typeof(request->'amountKobo') IS DISTINCT FROM 'number'
    OR request->>'amountKobo' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'invalid savings request' USING ERRCODE='22023'; END IF;
  amount:=(request->>'amountKobo')::bigint;
  IF amount>9999999999 THEN RAISE EXCEPTION 'savings amount outside ledger range' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('primary-savings:' || resolved_intent_id::text,0));
  SELECT * INTO operation FROM piggyvest_primary.savings_operations WHERE id=(request->>'operationId')::uuid FOR UPDATE;
  IF FOUND THEN
    IF operation.intent_id<>resolved_intent_id OR operation.goal_id<>(request->>'goalId')::uuid OR operation.amount_kobo<>amount THEN RETURN jsonb_build_object('status','conflict'); END IF;
    RETURN jsonb_build_object('status',CASE WHEN operation.state='confirmed' THEN 'confirmed' WHEN operation.state='cancelled' THEN 'conflict' ELSE 'pending' END);
  END IF;
  SELECT candidate.* INTO goal FROM public.customer_savings_goals candidate
    WHERE candidate.id=(request->>'goalId')::uuid AND candidate.customer_id=(scope->>'customerId')::uuid
      AND candidate.merchant_id=(scope->>'merchantId')::uuid AND candidate.status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings goal unavailable' USING ERRCODE='42501'; END IF;
  SELECT candidate.* INTO destination FROM piggyvest_primary.savings_destinations candidate
    WHERE candidate.integration_id=(scope->>'integrationId')::uuid AND candidate.goal_id=goal.id AND candidate.intent_id=resolved_intent_id AND candidate.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings destination unavailable' USING ERRCODE='42501'; END IF;
  SELECT provider_wallet_id,provider_customer_id INTO source_wallet,source_customer FROM piggyvest_primary.onboarding_intents WHERE id=resolved_intent_id;
  IF source_wallet=destination.provider_wallet_id THEN RAISE EXCEPTION 'identical savings wallets' USING ERRCODE='22023'; END IF;
  IF source_customer IS NULL THEN RAISE EXCEPTION 'savings customer unavailable' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(sum((financial_identity->>'amountKobo')::numeric),0) INTO available_kobo FROM piggyvest_primary.inflow_receipts WHERE inflow_receipts.intent_id=resolved_intent_id;
  SELECT available_kobo-COALESCE(sum(amount_kobo),0) INTO available_kobo FROM piggyvest_primary.savings_operations WHERE savings_operations.intent_id=resolved_intent_id AND state<>'cancelled';
  SELECT (goal.target_amount-goal.current_amount)*100-COALESCE(sum(amount_kobo),0) INTO capacity_kobo FROM piggyvest_primary.savings_operations WHERE goal_id=goal.id AND state IN ('reserved','dispatched');
  IF available_kobo<amount OR capacity_kobo<amount THEN RETURN jsonb_build_object('status','insufficient'); END IF;
  UPDATE public.customer_wallets SET available_balance=available_balance-amount::numeric/100,updated_at=pg_catalog.clock_timestamp()
    WHERE customer_id=(scope->>'customerId')::uuid AND merchant_id=(scope->>'merchantId')::uuid AND available_balance>=amount::numeric/100
    RETURNING id,available_balance INTO wallet_id,wallet_balance;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','insufficient'); END IF;
  INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id,status,description)
    VALUES(transaction_id,wallet_id,(scope->>'customerId')::uuid,(scope->>'merchantId')::uuid,'redemption',amount::numeric/100,wallet_balance,'piggyvest_primary_savings',(request->>'operationId')::uuid,'pending','Savings transfer pending');
  INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state,wallet_transaction_id)
    VALUES((request->>'operationId')::uuid,(scope->>'integrationId')::uuid,resolved_intent_id,goal.id,amount,source_wallet,destination.provider_wallet_id,'pvb-save-' || (request->>'operationId'),'reserved',transaction_id)
    RETURNING * INTO operation;
  RETURN jsonb_build_object('status','claimed','reservation',jsonb_build_object('operationId',operation.id,'goalId',goal.id,'amountKobo',amount,'sourceWalletId',source_wallet,'destinationWalletId',destination.provider_wallet_id,'reference',operation.reference,'businessId',scope->>'businessId','providerCustomerId',source_customer));
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.read_dispatched_savings(integration_id uuid,environment text,operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation jsonb;
BEGIN
  PERFORM binding.id FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=read_dispatched_savings.integration_id AND binding.environment=read_dispatched_savings.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF binding,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('operationId',operation.id,'goalId',operation.goal_id,'amountKobo',operation.amount_kobo,
      'sourceWalletId',operation.source_wallet_id,'destinationWalletId',operation.destination_wallet_id,
      'reference',operation.reference,'businessId',binding.business_id,'providerCustomerId',intent.provider_customer_id)
    INTO reservation FROM piggyvest_primary.savings_operations operation
    JOIN piggyvest_primary.integrations binding ON binding.id=operation.integration_id
    JOIN piggyvest_primary.onboarding_intents intent ON intent.id=operation.intent_id AND intent.integration_id=binding.id
    JOIN public.customers customer ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
    WHERE operation.id=operation_id AND operation.integration_id=read_dispatched_savings.integration_id
      AND operation.state='dispatched' AND intent.state IN ('accepted','verified') AND intent.provider_wallet_id=operation.source_wallet_id;
  RETURN reservation;
END $$;
COMMIT;
