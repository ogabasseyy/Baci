-- GL-A: goal funding from the main wallet no longer reads or debits the legacy
-- in-house balance (public.customer_wallets).
--
-- Problem: since the ledger-only deposit change (20261103025419) a PiggyVest
-- deposit is recorded in piggyvest_primary.inflow_receipts only and never
-- credits customer_wallets. The funding reservation still checked and debited
-- customer_wallets, so a customer whose money sits in the PiggyVest main wallet
-- always got 'insufficient' and could not fund a goal.
--
-- Fix: a funding reservation is created for a customer on the PiggyVest primary
-- rail (every caller of this function has an accepted onboarding intent, which
-- assert_savings_scope proves), so it no longer touches customer_wallets or
-- customer_wallet_transactions. The only availability check left is the
-- database's own receipt ledger (verified deposits, minus open funding, plus
-- settled refunds and completions); nothing a caller supplies is trusted as the
-- balance. PiggyVest itself enforces the real balance on the wallet-to-goal
-- transfer, and a definitive refusal already takes the existing release path.
-- The reservation row keeps wallet_transaction_id empty (the column is already
-- nullable).
--
-- The hold, dispatch, release and settle paths are unchanged in every other
-- respect: each skips the legacy-wallet step only when the operation has no
-- legacy wallet transaction, so an operation reserved under the old rule still
-- restores or completes its hold exactly as before. Legacy (non PiggyVest)
-- contributions use public.allocate_customer_savings_contribution, which is not
-- touched and still debits customer_wallets.
--
-- Availability guard (decision: conservative, not advisory). The receipt-ledger
-- sum already subtracts EVERY recorded outflow of the main wallet: each funding
-- operation that is not cancelled (reserved, dispatched and confirmed alike) is
-- deducted, and goal cancel / goal complete settlements are the only inflows
-- added back. No other table records a main-wallet outflow (there is no
-- cash-out), so nothing further is subtracted. A guard that is too strict is
-- safe: PiggyVest still refuses an unaffordable transfer and that refusal
-- releases the hold.
--
-- Goal cancel / goal complete settlement (settle_goal_cancel,
-- settle_goal_complete): the refunded or completed money returns to the
-- customer's PiggyVest main wallet at PiggyVest. Funding no longer debits
-- customer_wallets, so these settlements no longer credit it or write a
-- customer_wallet_transactions row; otherwise fund-then-cancel (or complete)
-- would mint spendable legacy balance out of PiggyVest money. Idempotency, the
-- state machine, provider proof binding, needs_review paths, the goal update,
-- the savings event, the purchase request and the alerts are unchanged. The
-- attempt row and the savings event are the record of the refund. This rollout
-- is dark, so no goal funded under the old legacy hold exists yet to need its
-- legacy refund.
--
-- Same signatures as the current definitions, so grants persist through
-- CREATE OR REPLACE. Rolling this out changes nothing for customers until the
-- PiggyVest primary flags are on.
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

-- Reservation: no customer_wallets read or debit, no wallet transaction.
CREATE OR REPLACE FUNCTION piggyvest_primary.reserve_savings_before_interest(scope jsonb, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  resolved_intent_id uuid := piggyvest_primary.assert_savings_scope(scope);
  operation piggyvest_primary.savings_operations%ROWTYPE;
  goal public.customer_savings_goals%ROWTYPE;
  destination piggyvest_primary.savings_destinations%ROWTYPE;
  amount bigint;
  available_kobo numeric;
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
  SELECT COALESCE(sum((financial_identity->>'amountKobo')::numeric),0) INTO available_kobo FROM piggyvest_primary.inflow_receipts WHERE inflow_receipts.intent_id=resolved_intent_id;
  SELECT available_kobo-COALESCE(sum(amount_kobo),0) INTO available_kobo FROM piggyvest_primary.savings_operations WHERE savings_operations.intent_id=resolved_intent_id AND state<>'cancelled';
  -- A settled goal-cancel refund (confirmed, or settled into review) is money
  -- back in the main wallet; only the refund's own amount counts.
  SELECT available_kobo+COALESCE(sum(refund.amount_kobo),0) INTO available_kobo FROM piggyvest_primary.goal_cancel_operations refund WHERE refund.intent_id=resolved_intent_id AND refund.state IN ('confirmed','needs_review','reviewed');
  -- A settled goal-complete transfer is money back in the main wallet too.
  SELECT available_kobo+COALESCE(sum(done.amount_kobo),0) INTO available_kobo FROM piggyvest_primary.goal_complete_operations done WHERE done.intent_id=resolved_intent_id AND done.state IN ('confirmed','needs_review','reviewed');
  SELECT (goal.target_amount-goal.current_amount)*100-COALESCE(sum(amount_kobo),0) INTO capacity_kobo FROM piggyvest_primary.savings_operations WHERE goal_id=goal.id AND state IN ('reserved','dispatched');
  IF available_kobo<amount OR capacity_kobo<amount THEN RETURN jsonb_build_object('status','insufficient'); END IF;
  INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state)
    VALUES((request->>'operationId')::uuid,(scope->>'integrationId')::uuid,resolved_intent_id,goal.id,amount,source_wallet,destination.provider_wallet_id,'pvb-save-' || (request->>'operationId'),'reserved')
    RETURNING * INTO operation;
  RETURN jsonb_build_object('status','claimed','reservation',jsonb_build_object('operationId',operation.id,'goalId',goal.id,'amountKobo',amount,'sourceWalletId',source_wallet,'destinationWalletId',destination.provider_wallet_id,'reference',operation.reference,'businessId',scope->>'businessId','providerCustomerId',source_customer));
END $$;


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
SET search_path = pg_catalog
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

-- Goal complete settlement: same rule; the purchase request is still saved.
CREATE OR REPLACE FUNCTION piggyvest_primary.settle_goal_complete(
  integration_id uuid,
  environment text,
  proof jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_operation piggyvest_primary.goal_complete_operations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_now timestamptz;
  v_late boolean := false;
  v_review boolean := false;
  v_goal public.customer_savings_goals%ROWTYPE;
  v_goal_amount numeric;
  v_residual bigint := 0;
  v_target text;
BEGIN
  SELECT candidate.* INTO v_binding FROM piggyvest_primary.integrations AS candidate
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = candidate.id
   WHERE candidate.id = settle_goal_complete.integration_id
     AND candidate.environment = settle_goal_complete.environment
     AND candidate.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF candidate, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE = '42501';
  END IF;
  IF piggyvest_primary.goal_complete_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS candidate
   WHERE candidate.id = (proof ->> 'operationId')::uuid AND candidate.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS candidate
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
    IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_complete_operations AS live
                WHERE live.goal_id = v_operation.goal_id AND live.id <> v_operation.id
                  AND live.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review')) THEN
      RETURN 'conflict';
    END IF;
    v_late := true;
  ELSIF v_operation.state <> 'dispatched' THEN
    RETURN 'conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_complete_operations AS other
              WHERE other.integration_id = v_binding.id
                AND other.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS cancel
                WHERE cancel.integration_id = v_binding.id
                  AND cancel.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
                WHERE funding.integration_id = v_binding.id
                  AND funding.provider_transaction_id = proof ->> 'providerTransactionId') THEN
    RETURN 'conflict';
  END IF;
  -- Every row this settlement writes is locked first, and each write reads
  -- the clock itself, so no timestamp predates a lock wait. The goal row is
  -- locked here for both the late check and the final update.
  v_residual := COALESCE((proof ->> 'residualKobo')::bigint, 0);
  SELECT goal.* INTO v_goal FROM public.customer_savings_goals AS goal
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id FOR UPDATE;
  v_goal_amount := v_goal.current_amount;
  -- A goal wallet that still holds money at the provider after the transfer
  -- (a credit landed between the balance snapshot and the transfer) is never
  -- settled as completed-at-zero. A late success settles ONLY its own amount:
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
  -- A goal that is gone or no longer completable can not carry the purchase
  -- request, so the attempt is settled and goes to review instead
  -- of confirming a completion nobody can fulfil.
  v_review := v_review OR v_residual > 0
    OR COALESCE(v_goal.status NOT IN ('active', 'paused', 'completed'), true);
  v_target := CASE WHEN v_review THEN 'needs_review' ELSE 'confirmed' END;
  UPDATE piggyvest_primary.goal_complete_operations
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
     SET status = CASE WHEN v_review THEN goal.status ELSE 'completed' END,
         completed_at = CASE WHEN v_review THEN goal.completed_at ELSE COALESCE(goal.completed_at, v_now) END,
         future_debits_cancelled_at = CASE WHEN v_review THEN goal.future_debits_cancelled_at
           ELSE COALESCE(goal.future_debits_cancelled_at, v_now) END,
         current_amount = CASE
           WHEN v_review THEN GREATEST(0, goal.current_amount - v_operation.amount_kobo::numeric / 100)
           ELSE 0 END,
         updated_at = v_now
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id
     AND goal.status IN ('active', 'paused', 'completed');
  IF FOUND THEN
    INSERT INTO public.customer_savings_events
      (goal_id, merchant_id, customer_id, event_type, actor_type, metadata)
    VALUES (v_operation.goal_id, v_intent.merchant_id, v_intent.customer_id,
      CASE WHEN v_review THEN 'goal_complete_needs_review' ELSE 'goal_completed_to_wallet' END, 'system',
      pg_catalog.jsonb_build_object('operation_id', v_operation.id, 'amount_kobo', v_operation.amount_kobo));
  END IF;
  IF v_review THEN RETURN 'conflict'; END IF;
  -- The purchase request is saved in this same transaction as the completion,
  -- so a settled completion always has its request and a failed save rolls the
  -- whole settlement back. The owner alert is sent only after this commits.
  INSERT INTO piggyvest_primary.goal_purchase_requests
    (complete_operation_id, integration_id, merchant_id, customer_id, goal_id, goal_title,
     target_amount, product_id, variant_id, amount_kobo, created_at)
  VALUES (v_operation.id, v_binding.id, v_intent.merchant_id, v_intent.customer_id, v_operation.goal_id,
    pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(v_goal.title), ''), 'Savings goal'), 500),
    v_goal.target_amount, v_goal.product_id, v_goal.variant_id, v_operation.amount_kobo, v_now);
  RETURN 'confirmed';
END;
$$;

REVOKE EXECUTE ON FUNCTION
  piggyvest_primary.reserve_savings_before_interest(jsonb, jsonb),
  piggyvest_primary.manage_savings(jsonb, uuid, text),
  piggyvest_primary.release_failed_savings(uuid, text, jsonb),
  piggyvest_primary.settle_savings_before_completion(uuid, text, jsonb),
  piggyvest_primary.settle_goal_cancel(uuid, text, jsonb),
  piggyvest_primary.settle_goal_complete(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_savings(jsonb, uuid, text)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.release_failed_savings(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_goal_cancel(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_goal_complete(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
COMMIT;
