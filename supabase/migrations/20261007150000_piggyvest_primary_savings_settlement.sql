BEGIN;
ALTER TABLE piggyvest_primary.savings_operations ADD COLUMN IF NOT EXISTS provider_transaction_id text;
CREATE UNIQUE INDEX IF NOT EXISTS primary_savings_provider_transaction_idx ON piggyvest_primary.savings_operations(integration_id,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
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
  UPDATE public.customer_savings_goals goal SET current_amount=goal.current_amount+operation.amount_kobo::numeric/100
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
REVOKE ALL ON FUNCTION piggyvest_primary.settle_savings(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_savings(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
