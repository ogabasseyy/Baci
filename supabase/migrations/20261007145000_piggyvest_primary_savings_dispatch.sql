BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.manage_savings(scope jsonb, operation_id uuid, action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  resolved_intent_id uuid:=piggyvest_primary.assert_savings_scope(scope);
  operation piggyvest_primary.savings_operations%ROWTYPE;
  restored_balance numeric;
BEGIN
  IF operation_id IS NULL OR action IS NULL OR action NOT IN ('dispatch','cancel') THEN
    RAISE EXCEPTION 'invalid savings transition' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('primary-savings:' || resolved_intent_id::text,0));
  SELECT candidate.* INTO operation FROM piggyvest_primary.savings_operations candidate
    WHERE candidate.id=operation_id AND candidate.intent_id=resolved_intent_id
      AND candidate.integration_id=(scope->>'integrationId')::uuid FOR UPDATE;
  IF NOT FOUND OR operation.state<>'reserved' THEN RETURN false; END IF;
  IF action='dispatch' THEN
    PERFORM goal.id FROM public.customer_savings_goals goal
      JOIN piggyvest_primary.savings_destinations destination ON destination.goal_id=goal.id AND destination.integration_id=operation.integration_id
      JOIN piggyvest_primary.onboarding_intents intent ON intent.id=destination.intent_id
      WHERE goal.id=operation.goal_id AND goal.customer_id=intent.customer_id AND goal.merchant_id=intent.merchant_id
        AND goal.status='active' AND destination.enabled AND destination.intent_id=operation.intent_id
        AND destination.provider_wallet_id=operation.destination_wallet_id AND intent.provider_wallet_id=operation.source_wallet_id
      FOR SHARE OF goal,destination,intent;
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE piggyvest_primary.savings_operations SET state='dispatched' WHERE id=operation.id;
    RETURN true;
  END IF;
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
  UPDATE piggyvest_primary.savings_operations SET state='cancelled' WHERE id=operation.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.manage_savings(jsonb,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_savings(jsonb,uuid,text) TO piggyvest_primary_authorizer;
COMMIT;
