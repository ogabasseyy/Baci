-- GL-A (funding reservation).
-- A funding reservation on the PiggyVest primary rail no longer reads or debits
-- customer_wallets and no longer refuses based on the local receipt ledger.
-- That ledger only records verified deposits and undercounts main-wallet money
-- that is not a deposit receipt (paid interest, a merchant top-up). PiggyVest's
-- balance is the authority: the application checks the provider balance before
-- dispatch, and PiggyVest's own refusal of an unaffordable transfer releases the
-- hold exactly once. Nothing a caller supplies is trusted as a balance. One
-- reservation per operation, idempotency, tenant scope and goal capacity are
-- unchanged. Applied AFTER the release and settlement migrations so every path
-- is compatible with reservations that carry no legacy wallet transaction.
-- Same signatures as the current definitions, so grants persist through
-- CREATE OR REPLACE. Dark until the PiggyVest primary flags are on.
BEGIN;
DO $guard$
BEGIN
  IF to_regprocedure('piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'settle_savings_before_completion missing; apply the settlement repair first';
  END IF;
END $guard$;

-- The reservation row carries no legacy wallet transaction. The column is
-- already nullable; restating it keeps this migration self-sufficient.
SET LOCAL lock_timeout = '5s';
ALTER TABLE piggyvest_primary.savings_operations
  ALTER COLUMN wallet_transaction_id DROP NOT NULL;

-- Reservation: no customer_wallets read or debit, no wallet transaction, and no
-- local balance gate. PiggyVest's main-wallet balance is the authority (the
-- application checks it before dispatch and PiggyVest refuses an unaffordable
-- transfer, which releases the hold). The only database limit is the goal's
-- remaining target capacity net of open reservations.
CREATE OR REPLACE FUNCTION piggyvest_primary.reserve_savings_before_interest(scope jsonb, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  resolved_intent_id uuid := piggyvest_primary.assert_savings_scope(scope);
  operation piggyvest_primary.savings_operations%ROWTYPE;
  goal public.customer_savings_goals%ROWTYPE;
  destination piggyvest_primary.savings_destinations%ROWTYPE;
  amount bigint;
  capacity_kobo numeric;
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
  SELECT (goal.target_amount-goal.current_amount)*100-COALESCE(sum(amount_kobo),0) INTO capacity_kobo FROM piggyvest_primary.savings_operations WHERE goal_id=goal.id AND state IN ('reserved','dispatched');
  IF capacity_kobo<amount THEN RETURN jsonb_build_object('status','insufficient'); END IF;
  INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state)
    VALUES((request->>'operationId')::uuid,(scope->>'integrationId')::uuid,resolved_intent_id,goal.id,amount,source_wallet,destination.provider_wallet_id,'pvb-save-' || (request->>'operationId'),'reserved')
    RETURNING * INTO operation;
  RETURN jsonb_build_object('status','claimed','reservation',jsonb_build_object('operationId',operation.id,'goalId',goal.id,'amountKobo',amount,'sourceWalletId',source_wallet,'destinationWalletId',destination.provider_wallet_id,'reference',operation.reference,'businessId',scope->>'businessId','providerCustomerId',source_customer));
END $$;

-- No role is granted EXECUTE on the inner function: it was already closed to the
-- executor login (piggyvest_primary_authorizer) by 20261007181000, and the login
-- reaches it only through the SECURITY DEFINER reserve_savings wrapper, whose
-- grant is unchanged. The revoke stays explicit and idempotent.
REVOKE EXECUTE ON FUNCTION
  piggyvest_primary.reserve_savings_before_interest(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer;
COMMIT;
