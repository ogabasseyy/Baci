-- GL-A (release paths).
-- Cancel, cancel_stale, release and terminal provider failure restore a legacy
-- wallet hold only when the operation has one (wallet_transaction_id IS NOT
-- NULL), so an operation reserved without a hold releases cleanly.
-- Runs before the reservation change (20261104130800) so every release path is
-- compatible with hold-free reservations first.
-- Same signatures as the current definitions, so grants persist through
-- CREATE OR REPLACE. Dark until the PiggyVest primary flags are on.
BEGIN;
DO $guard$
BEGIN
  IF to_regprocedure('piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'settle_savings_before_completion missing; apply the settlement repair first';
  END IF;
END $guard$;

-- Cancel, cancel_stale and release: restore a legacy hold only when one exists.
CREATE OR REPLACE FUNCTION piggyvest_primary.manage_savings(scope jsonb, operation_id uuid, action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  resolved_intent_id uuid:=piggyvest_primary.assert_savings_scope(scope);
  operation piggyvest_primary.savings_operations%ROWTYPE;
  restored_balance numeric;
BEGIN
  IF operation_id IS NULL OR action IS NULL OR action NOT IN ('dispatch','cancel','cancel_stale','release') THEN
    RAISE EXCEPTION 'invalid savings transition' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('primary-savings:' || resolved_intent_id::text,0));
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate
    WHERE candidate.id=operation_id AND candidate.intent_id=resolved_intent_id
      AND candidate.integration_id=(scope->>'integrationId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF action='release' AND operation.state<>'dispatched' THEN RETURN false; END IF;
  IF action<>'release' AND operation.state<>'reserved' THEN RETURN false; END IF;
  IF action='dispatch' THEN
    PERFORM goal.id FROM public.customer_savings_goals goal
      JOIN piggyvest_primary.savings_destinations destination ON destination.goal_id=goal.id AND destination.integration_id=operation.integration_id
      JOIN piggyvest_primary.onboarding_intents intent ON intent.id=destination.intent_id
      WHERE goal.id=operation.goal_id AND goal.customer_id=intent.customer_id AND goal.merchant_id=intent.merchant_id
        AND goal.status='active' AND destination.enabled AND destination.intent_id=operation.intent_id
        AND destination.provider_wallet_id=operation.destination_wallet_id AND intent.provider_wallet_id=operation.source_wallet_id
      FOR SHARE OF goal,destination,intent;
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE piggyvest_primary.savings_operations SET state='dispatched',dispatched_at=pg_catalog.clock_timestamp() WHERE id=operation.id;
    RETURN true;
  END IF;
  IF action='release' THEN
    IF operation.wallet_transaction_id IS NOT NULL THEN
      UPDATE public.customer_wallets wallet SET
        available_balance=wallet.available_balance+operation.amount_kobo::numeric/100,
        updated_at=pg_catalog.clock_timestamp()
        FROM public.customer_wallet_transactions transaction
        WHERE transaction.id=operation.wallet_transaction_id AND transaction.wallet_id=wallet.id
          AND wallet.customer_id=(scope->>'customerId')::uuid AND wallet.merchant_id=(scope->>'merchantId')::uuid
          AND transaction.customer_id=wallet.customer_id AND transaction.merchant_id=wallet.merchant_id
          AND transaction.source_id=operation.id AND transaction.source_type='piggyvest_primary_savings'
          AND transaction.status='pending' AND transaction.amount=operation.amount_kobo::numeric/100
        RETURNING wallet.available_balance INTO restored_balance;
      IF NOT FOUND THEN RAISE EXCEPTION 'savings hold unavailable' USING ERRCODE='42501'; END IF;
      UPDATE public.customer_wallet_transactions SET status='failed',description='Savings transfer released after definitive provider rejection'
        WHERE id=operation.wallet_transaction_id;
    END IF;
    UPDATE piggyvest_primary.savings_operations SET state='cancelled' WHERE id=operation.id;
    RETURN true;
  END IF;
  IF action='cancel_stale' AND operation.created_at >= pg_catalog.clock_timestamp() - interval '5 minutes' THEN RETURN false; END IF;
  IF operation.wallet_transaction_id IS NOT NULL THEN
    UPDATE public.customer_wallets wallet SET
      available_balance=wallet.available_balance+operation.amount_kobo::numeric/100,
      updated_at=pg_catalog.clock_timestamp()
      FROM public.customer_wallet_transactions transaction
      WHERE transaction.id=operation.wallet_transaction_id AND transaction.wallet_id=wallet.id
        AND wallet.customer_id=(scope->>'customerId')::uuid AND wallet.merchant_id=(scope->>'merchantId')::uuid
        AND transaction.customer_id=wallet.customer_id AND transaction.merchant_id=wallet.merchant_id
        AND transaction.source_id=operation.id AND transaction.source_type='piggyvest_primary_savings'
        AND transaction.status='pending' AND transaction.amount=operation.amount_kobo::numeric/100
      RETURNING wallet.available_balance INTO restored_balance;
    IF NOT FOUND THEN RAISE EXCEPTION 'savings hold unavailable' USING ERRCODE='42501'; END IF;
    UPDATE public.customer_wallet_transactions SET status='failed',description='Savings transfer cancelled before submission'
      WHERE id=operation.wallet_transaction_id;
  END IF;
  UPDATE piggyvest_primary.savings_operations SET state='cancelled' WHERE id=operation.id;
  RETURN true;
END $$;


-- Terminal provider failure: restore a legacy hold only when one exists.
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
  IF operation.wallet_transaction_id IS NOT NULL THEN
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
  END IF;
  UPDATE piggyvest_primary.savings_operations SET state='cancelled' WHERE id=operation.id;
  RETURN 'released';
END $$;

REVOKE EXECUTE ON FUNCTION
  piggyvest_primary.manage_savings(jsonb, uuid, text),
  piggyvest_primary.release_failed_savings(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_savings(jsonb, uuid, text)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.release_failed_savings(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
COMMIT;
