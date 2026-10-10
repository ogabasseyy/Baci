-- Release dispatched savings holds after a definitive provider rejection.
-- The dispatch claim moves a reservation out of 'reserved', after which no
-- cancel path could run: when the provider definitively rejects the wallet
-- transfer without creating it (auth refusal, semantic 4xx, explicit
-- decline envelope), the operation sat dispatched forever with the wallet
-- hold reserved and the goal's single-pending slot occupied. The new
-- 'release' action transitions 'dispatched' rows to 'cancelled' with the
-- same hold restoration as 'cancel'. The TypeScript caller invokes it only
-- after classifying the rejection as definitive AND proving the reference
-- absent via lookup, so a late provider submission is never orphaned by a
-- freed hold; ambiguous failures keep holding pending for reconciliation.
BEGIN;
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
    UPDATE piggyvest_primary.savings_operations SET state='cancelled' WHERE id=operation.id;
    RETURN true;
  END IF;
  IF action='cancel_stale' AND operation.created_at >= pg_catalog.clock_timestamp() - interval '5 minutes' THEN RETURN false; END IF;
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
COMMIT;
