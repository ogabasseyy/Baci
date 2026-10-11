-- Release the customer hold when the provider terminally fails a dispatched
-- savings transfer. Before this path, reconcile mapped every non-successful
-- provider response to 'pending': the operation stayed 'dispatched', its
-- wallet debit stayed pending, and primary_savings_single_pending_goal_idx
-- blocked further contributions to the goal even though no provider
-- transfer can ever settle. Authenticate the failed evidence exactly like
-- settlement (same authority, same proof bindings), then atomically
-- restore the held balance, fail the wallet transaction, and cancel the
-- operation so the goal accepts a fresh contribution. Confirmed
-- operations are never released; reserved operations stay owned by the
-- pre-dispatch cancel path; replays of the same failed proof are idempotent.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.release_failed_savings(integration_id uuid,environment text,proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary.savings_operations%ROWTYPE;
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
  binding piggyvest_primary.integrations%ROWTYPE;
  restored_balance numeric;
BEGIN
  SELECT candidate.* INTO binding FROM piggyvest_primary.integrations candidate
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=candidate.id
    WHERE candidate.id=release_failed_savings.integration_id AND candidate.environment=release_failed_savings.environment
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
  IF operation.state='cancelled' THEN RETURN 'duplicate'; END IF;
  IF operation.state<>'dispatched' THEN RETURN 'conflict'; END IF;
  UPDATE public.customer_wallets wallet SET
    available_balance=wallet.available_balance+operation.amount_kobo::numeric/100,
    updated_at=pg_catalog.clock_timestamp()
    FROM public.customer_wallet_transactions transaction
    WHERE transaction.id=operation.wallet_transaction_id AND transaction.wallet_id=wallet.id
      AND wallet.customer_id=intent.customer_id AND wallet.merchant_id=intent.merchant_id
      AND transaction.customer_id=wallet.customer_id AND transaction.merchant_id=wallet.merchant_id
      AND transaction.source_id=operation.id AND transaction.source_type='piggyvest_primary_savings'
      AND transaction.status='pending' AND transaction.amount=operation.amount_kobo::numeric/100
    RETURNING wallet.available_balance INTO restored_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings hold unavailable' USING ERRCODE='42501'; END IF;
  UPDATE public.customer_wallet_transactions transaction SET status='failed',description='Savings transfer failed at provider'
    WHERE transaction.id=operation.wallet_transaction_id;
  UPDATE piggyvest_primary.savings_operations SET state='cancelled' WHERE id=operation.id;
  RETURN 'released';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.release_failed_savings(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.release_failed_savings(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
