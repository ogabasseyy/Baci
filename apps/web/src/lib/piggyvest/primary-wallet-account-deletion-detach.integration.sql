\set ON_ERROR_STOP on
\ir primary-wallet-card-checkout.integration.sql
-- Savings/interest dependency surface the detach migration rewrites.
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants(id),customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,status text,goal_kind text,current_amount numeric,target_amount numeric);
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY,customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE);
CREATE SCHEMA piggyvest_savings_ledger;
CREATE FUNCTION piggyvest_savings_ledger.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'ledger immutable' USING ERRCODE = '23514'; END $$;
-- Staging-ledger surface referenced (creation-time) by completion helpers.
CREATE TABLE piggyvest_savings_ledger.bindings(integration_id uuid,goal_id uuid,merchant_id uuid,customer_id uuid,enabled boolean);
CREATE TABLE piggyvest_savings_ledger.operations(id uuid,integration_id uuid,goal_id uuid,merchant_id uuid,customer_id uuid,amount_kobo bigint);
CREATE TABLE piggyvest_savings_ledger.postings(operation_id uuid,account text,amount_kobo bigint);
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,expected_provider_account_id text,enabled boolean);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_primary_evidence') THEN
    CREATE ROLE piggyvest_primary_evidence NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
\ir ../../../../../supabase/migrations/20261007142000_piggyvest_primary_inflow_ledger.sql
\ir ../../../../../supabase/migrations/20261007144000_piggyvest_primary_savings_reservations.sql
\ir ../../../../../supabase/migrations/20261007150000_piggyvest_primary_savings_settlement.sql
\ir ../../../../../supabase/migrations/20261007181000_piggyvest_primary_paid_interest_completion.sql
\ir ../../../../../supabase/migrations/20261007190000_piggyvest_primary_savings_provisioning.sql
\ir ../../../../../supabase/migrations/20261007220000_piggyvest_primary_interest_storage.sql
\ir ../../../../../supabase/migrations/20261008092700_primary_wallet_account_deletion_detach.sql
\ir ../../../../../supabase/migrations/20261008092900_primary_savings_deletion_retention.sql
\ir ../../../../../supabase/migrations/20261008093100_primary_inflow_receipt_deletion_detach.sql
\ir ../../../../../supabase/migrations/20261008093200_primary_card_unsettled_deletion_block.sql
\ir ../../../../../supabase/migrations/20261008093300_primary_card_reconciliation_deletion_detach.sql
\ir ../../../../../supabase/migrations/20261008093400_primary_savings_unsettled_deletion_block.sql
\ir ../../../../../supabase/migrations/20261008093500_primary_card_saved_token_deletion_purge.sql
-- Account deletion must succeed for a fully onboarded customer: all money
-- evidence detaches (customer/goal/transaction NULL, row retained). Only
-- provisioning-process intents cascade with their goal.
DO $$ DECLARE
  v_merchant uuid := '10000000-0000-4000-8000-000000000001';
  v_customer uuid := '50000000-0000-4000-8000-000000000001';
  v_user uuid := '50000000-0000-4000-8000-000000000002';
  v_goal uuid := '50000000-0000-4000-8000-000000000003';
  v_integration uuid := '10000000-0000-4000-8000-000000000004';
  v_intent uuid;
  v_savings_operation uuid := '50000000-0000-4000-8000-000000000005';
  v_wallet_transaction uuid := '50000000-0000-4000-8000-000000000006';
  v_crosswalk uuid;
BEGIN
  INSERT INTO public.customers VALUES(v_customer, v_merchant, v_user, 'detach@example.test');
  INSERT INTO public.customer_savings_goals VALUES(v_goal, v_merchant, v_customer);
  INSERT INTO public.customer_wallet_transactions VALUES(v_wallet_transaction, v_customer);
  INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
  VALUES(v_integration,v_merchant,v_customer,v_user,repeat('d',64),'verified','detach-customer','detach-wallet') RETURNING id INTO v_intent;
  INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled) VALUES(v_integration,v_goal,v_intent,'detach-wallet',true);
  INSERT INTO piggyvest_primary.savings_operations VALUES(v_savings_operation,v_integration,v_intent,v_goal,25000,'source-wallet','detach-wallet','detach-reference','confirmed',v_wallet_transaction,clock_timestamp());
  INSERT INTO piggyvest_primary.savings_completion_reviews(goal_id,integration_id,merchant_id,customer_id,pending_operation_ids,overshoot_kobo,state,first_flagged_at,updated_at) VALUES(v_goal,v_integration,v_merchant,v_customer,ARRAY[v_savings_operation],'0','open',clock_timestamp(),clock_timestamp());
  INSERT INTO piggyvest_primary.savings_completion_evidence VALUES(v_savings_operation,v_integration,'detach-provider-txn','{}',clock_timestamp());
  INSERT INTO piggyvest_primary.inflow_receipts(id,integration_id,intent_id,provider_transaction_id,event_id,body_digest,financial_identity,wallet_transaction_id)
  VALUES('50000000-0000-4000-8000-000000000014',v_integration,v_intent,'detach-provider-inflow','detach-inflow-event',repeat('a',64),'{}',v_wallet_transaction);
  INSERT INTO piggyvest_primary.goal_wallet_intents VALUES(v_integration,v_goal,v_intent,'detach-wallet-name','enrolled',NULL,'detach-wallet',true,clock_timestamp(),clock_timestamp(),clock_timestamp());
  INSERT INTO piggyvest_primary_card.operations(integration_id,merchant_id,customer_id,user_id,environment,business_id,email,idempotency_key,amount_kobo,consent,fingerprint,destination_wallet_id,destination_customer_id,state)
  VALUES(v_integration,v_merchant,v_customer,v_user,'staging','fixture-business','detach@example.test','50000000-0000-4000-8000-000000000007',25000,'{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}',repeat('e',64),'detach-wallet','detach-customer','completed');
  INSERT INTO piggyvest_primary.paid_interest_crosswalks(integration_id,goal_id,api_wallet_id,api_customer_id,onboarding_customer_id,webhook_customer_id,source_wallet_id,accrued_wallet_id,destination_wallet_id,provider_evidence_sha256,policy_evidence_sha256,policy_reference,allocation_policy,enabled)
  VALUES(v_integration,v_goal,'detach-wallet','detach-api-customer','detach-customer','detach-webhook','detach-source','detach-accrued','detach-destination',repeat('f',64),repeat('a',64),'detach-policy','provider_net_is_customer_plan_interest',true)
  RETURNING id INTO v_crosswalk;
  INSERT INTO piggyvest_primary.paid_interest_receipts VALUES(v_integration,'detach-payout',v_crosswalk,v_goal,v_merchant,v_customer,1000,'{}',repeat('b',64),clock_timestamp());
  INSERT INTO piggyvest_primary.paid_interest_delivery_ids VALUES(v_integration,'detach-event','detach-payout');
  INSERT INTO piggyvest_primary.paid_interest_reversals VALUES(v_integration,'detach-reversal','detach-payout',100,repeat('c',64),'detach-evidence');
  -- The delete previously aborted here on the NO ACTION customer/goal links.
  DELETE FROM public.customers WHERE id = v_customer;
  IF EXISTS (SELECT 1 FROM public.customer_savings_goals WHERE id = v_goal) THEN RAISE EXCEPTION 'goal not cascaded'; END IF;
  IF EXISTS (SELECT 1 FROM public.customer_wallet_transactions WHERE id = v_wallet_transaction) THEN RAISE EXCEPTION 'wallet txn not cascaded'; END IF;
  -- Retained evidence detaches.
  IF (SELECT customer_id FROM piggyvest_primary.onboarding_intents WHERE id = v_intent) IS NOT NULL THEN RAISE EXCEPTION 'onboarding not detached'; END IF;
  IF (SELECT customer_id FROM piggyvest_primary_card.operations WHERE email = 'detach@example.test') IS NOT NULL THEN RAISE EXCEPTION 'card operation not detached'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.paid_interest_crosswalks WHERE id = v_crosswalk AND goal_id IS NULL) <> 1 THEN RAISE EXCEPTION 'crosswalk not detached'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.paid_interest_receipts WHERE payout_id = 'detach-payout' AND goal_id IS NULL AND customer_id IS NULL) <> 1 THEN RAISE EXCEPTION 'receipt not detached'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.paid_interest_delivery_ids WHERE payout_id = 'detach-payout') <> 1 THEN RAISE EXCEPTION 'delivery id not retained'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.paid_interest_reversals WHERE payout_id = 'detach-payout') <> 1 THEN RAISE EXCEPTION 'reversal not retained'; END IF;
  -- Funded savings evidence detaches with every money field intact.
  IF (SELECT count(*) FROM piggyvest_primary.savings_destinations WHERE provider_wallet_id = 'detach-wallet' AND goal_id IS NULL AND intent_id = v_intent AND enabled) <> 1 THEN RAISE EXCEPTION 'destination not retained'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.savings_operations WHERE id = v_savings_operation AND goal_id IS NULL AND wallet_transaction_id IS NULL AND amount_kobo = 25000 AND reference = 'detach-reference' AND state = 'confirmed') <> 1 THEN RAISE EXCEPTION 'operation not retained'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.savings_completion_reviews WHERE goal_id IS NULL AND customer_id IS NULL AND state = 'open') <> 1 THEN RAISE EXCEPTION 'review not retained'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.savings_completion_evidence WHERE operation_id = v_savings_operation) <> 1 THEN RAISE EXCEPTION 'evidence not retained'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.inflow_receipts WHERE provider_transaction_id = 'detach-provider-inflow' AND wallet_transaction_id IS NULL AND intent_id = v_intent) <> 1 THEN RAISE EXCEPTION 'inflow receipt not retained'; END IF;
  -- Provisioning-process intents still cascade with their goal.
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_wallet_intents WHERE goal_id = v_goal) THEN RAISE EXCEPTION 'wallet intents not cascaded'; END IF;
  -- The detach allowance is exact: financial fields stay frozen and links
  -- may only null, never re-attach or swap.
  BEGIN
    UPDATE piggyvest_primary.paid_interest_receipts SET net_kobo = 999 WHERE payout_id = 'detach-payout';
    RAISE EXCEPTION 'receipt financial field updated';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE piggyvest_primary.paid_interest_receipts SET goal_id = v_goal WHERE payout_id = 'detach-payout';
    RAISE EXCEPTION 'receipt goal re-attached';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE piggyvest_primary.paid_interest_crosswalks SET api_wallet_id = 'swapped' WHERE id = v_crosswalk;
    RAISE EXCEPTION 'crosswalk field updated';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE piggyvest_primary.paid_interest_crosswalks SET goal_id = v_goal WHERE id = v_crosswalk;
    RAISE EXCEPTION 'crosswalk goal re-attached';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM piggyvest_primary.paid_interest_receipts WHERE payout_id = 'detach-payout';
    RAISE EXCEPTION 'receipt deleted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- The surrogate keys keep live upserts working: the reviews
-- ON CONFLICT(goal_id) arbiter and the destinations composite key both
-- still arbitrate on their UNIQUEs after retention.
DO $$ DECLARE
  v_merchant uuid := '10000000-0000-4000-8000-000000000001';
  v_integration uuid := '10000000-0000-4000-8000-000000000004';
  v_customer2 uuid := '50000000-0000-4000-8000-000000000011';
  v_user2 uuid := '50000000-0000-4000-8000-000000000012';
  v_goal2 uuid := '50000000-0000-4000-8000-000000000013';
  v_intent2 uuid;
BEGIN
  INSERT INTO public.customers VALUES(v_customer2, v_merchant, v_user2, 'retained@example.test');
  INSERT INTO public.customer_savings_goals VALUES(v_goal2, v_merchant, v_customer2);
  INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
  VALUES(v_integration,v_merchant,v_customer2,v_user2,repeat('e',64),'verified','retained-customer','retained-wallet') RETURNING id INTO v_intent2;
  INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled) VALUES(v_integration,v_goal2,v_intent2,'retained-wallet',true);
  INSERT INTO piggyvest_primary.savings_completion_reviews(goal_id,integration_id,merchant_id,customer_id,pending_operation_ids,overshoot_kobo,state)
  VALUES(v_goal2,v_integration,v_merchant,v_customer2,ARRAY['50000000-0000-4000-8000-000000000005'::uuid],'0','open')
  ON CONFLICT(goal_id) DO UPDATE SET pending_operation_ids=excluded.pending_operation_ids,overshoot_kobo=excluded.overshoot_kobo,state='open',updated_at=clock_timestamp();
  INSERT INTO piggyvest_primary.savings_completion_reviews(goal_id,integration_id,merchant_id,customer_id,pending_operation_ids,overshoot_kobo,state)
  VALUES(v_goal2,v_integration,v_merchant,v_customer2,ARRAY['50000000-0000-4000-8000-000000000005'::uuid],'5','open')
  ON CONFLICT(goal_id) DO UPDATE SET pending_operation_ids=excluded.pending_operation_ids,overshoot_kobo=excluded.overshoot_kobo,state='open',updated_at=clock_timestamp();
  IF (SELECT overshoot_kobo FROM piggyvest_primary.savings_completion_reviews WHERE goal_id = v_goal2) <> 5 THEN RAISE EXCEPTION 'reviews upsert arbiter broken'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.savings_destinations WHERE goal_id = v_goal2 AND provider_wallet_id = 'retained-wallet') <> 1 THEN RAISE EXCEPTION 'destination composite key broken'; END IF;
END $$;
-- Deletion is rejected while a card operation is unresolved: detaching a
-- custody_pending operation would strand the collected charge without a
-- wallet to credit. Terminal operations keep detaching (main block).
DO $$ DECLARE
  v_blocked uuid := '50000000-0000-4000-8000-000000000021';
  v_deleted boolean := false;
BEGIN
  INSERT INTO public.customers VALUES(v_blocked, '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000022', 'blocked@example.test');
  INSERT INTO piggyvest_primary_card.operations(integration_id,merchant_id,customer_id,user_id,environment,business_id,email,idempotency_key,amount_kobo,consent,fingerprint,destination_wallet_id,destination_customer_id,state)
  VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',v_blocked,'50000000-0000-4000-8000-000000000022','staging','fixture-business','blocked@example.test','50000000-0000-4000-8000-000000000023',25000,'{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}',repeat('d',64),'blocked-wallet','blocked-customer','custody_pending');
  -- A probe RAISE inside the handler block would be caught by that same
  -- handler (and roll the delete back), so it can never fail: record
  -- the outcome in a flag instead (PL/pgSQL variables are not
  -- transactional, so the flag survives either way).
  BEGIN
    DELETE FROM public.customers WHERE id = v_blocked;
    v_deleted := true;
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF v_deleted THEN RAISE EXCEPTION 'unsettled deletion allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_blocked) THEN RAISE EXCEPTION 'blocked customer deleted'; END IF;
  IF (SELECT customer_id FROM piggyvest_primary_card.operations WHERE email = 'blocked@example.test') <> v_blocked THEN RAISE EXCEPTION 'blocked operation detached'; END IF;
  UPDATE piggyvest_primary_card.operations SET state = 'completed' WHERE email = 'blocked@example.test';
  DELETE FROM public.customers WHERE id = v_blocked;
  IF (SELECT customer_id FROM piggyvest_primary_card.operations WHERE email = 'blocked@example.test') IS NOT NULL THEN RAISE EXCEPTION 'settled operation not detached'; END IF;
END $$;
-- reconciliation_required operations hold no live money-movement state
-- (flag_reconciliation releases the reservation; record_collection
-- rejects the state so no collection or transfer_outbox row can exist),
-- so detaching them strands no dispatch. The deletion guard must let
-- them detach: blocking this absorbing state would lock the account
-- permanently with no terminal transition.
DO $$ DECLARE
  v_review uuid := '50000000-0000-4000-8000-000000000031';
BEGIN
  INSERT INTO public.customers VALUES(v_review, '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000032', 'review@example.test');
  INSERT INTO piggyvest_primary_card.operations(integration_id,merchant_id,customer_id,user_id,environment,business_id,email,idempotency_key,amount_kobo,consent,fingerprint,destination_wallet_id,destination_customer_id,state)
  VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',v_review,'50000000-0000-4000-8000-000000000032','staging','fixture-business','review@example.test','50000000-0000-4000-8000-000000000033',25000,'{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}',repeat('f',64),'review-wallet','review-customer','reconciliation_required');
  DELETE FROM public.customers WHERE id = v_review;
  IF (SELECT count(*) FROM piggyvest_primary_card.operations WHERE email = 'review@example.test' AND customer_id IS NULL AND amount_kobo = 25000 AND state = 'reconciliation_required') <> 1 THEN RAISE EXCEPTION 'review operation not retained'; END IF;
END $$;
-- Deletion is rejected while a savings transfer is dispatched: detaching
-- the goal and wallet transaction would leave settle_savings unable to
-- credit the goal or complete the hold, stranding accepted funds.
DO $$ DECLARE
  v_savings_blocked uuid := '50000000-0000-4000-8000-000000000041';
  v_goal uuid := '50000000-0000-4000-8000-000000000042';
  v_txn uuid := '50000000-0000-4000-8000-000000000043';
  v_op uuid := '50000000-0000-4000-8000-000000000044';
  v_user uuid := '50000000-0000-4000-8000-000000000045';
  v_intent uuid;
  v_deleted boolean := false;
BEGIN
  INSERT INTO public.customers VALUES(v_savings_blocked,'10000000-0000-4000-8000-000000000001',v_user,'savings-blocked@example.test');
  INSERT INTO public.customer_savings_goals VALUES(v_goal,'10000000-0000-4000-8000-000000000001',v_savings_blocked);
  INSERT INTO public.customer_wallet_transactions VALUES(v_txn,v_savings_blocked);
  INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
  VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',v_savings_blocked,v_user,repeat('b',64),'verified','savings-blocked-customer','savings-blocked-wallet') RETURNING id INTO v_intent;
  INSERT INTO piggyvest_primary.savings_operations VALUES(v_op,'10000000-0000-4000-8000-000000000004',v_intent,v_goal,25000,'savings-source','savings-blocked-wallet','savings-blocked-reference','dispatched',v_txn,clock_timestamp());
  BEGIN
    DELETE FROM public.customers WHERE id = v_savings_blocked;
    v_deleted := true;
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF v_deleted THEN RAISE EXCEPTION 'dispatched savings deletion allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_savings_blocked) THEN RAISE EXCEPTION 'savings-blocked customer deleted'; END IF;
  UPDATE piggyvest_primary.savings_operations SET state = 'confirmed' WHERE id = v_op;
  DELETE FROM public.customers WHERE id = v_savings_blocked;
  IF (SELECT count(*) FROM piggyvest_primary.savings_operations WHERE id = v_op AND goal_id IS NULL AND wallet_transaction_id IS NULL AND state = 'confirmed') <> 1 THEN RAISE EXCEPTION 'settled savings not detached'; END IF;
END $$;
-- Goal deletion is rejected while a savings operation is reserved: the
-- dispatch cannot run without its goal link. Cancelled operations keep
-- detaching normally.
DO $$ DECLARE
  v_goal uuid := '50000000-0000-4000-8000-000000000046';
  v_txn uuid := '50000000-0000-4000-8000-000000000047';
  v_op uuid := '50000000-0000-4000-8000-000000000048';
  v_customer uuid := '50000000-0000-4000-8000-000000000049';
  v_user uuid := '50000000-0000-4000-8000-000000000050';
  v_intent uuid;
  v_deleted boolean := false;
BEGIN
  INSERT INTO public.customers VALUES(v_customer,'10000000-0000-4000-8000-000000000001',v_user,'savings-goal@example.test');
  INSERT INTO public.customer_savings_goals VALUES(v_goal,'10000000-0000-4000-8000-000000000001',v_customer);
  INSERT INTO public.customer_wallet_transactions VALUES(v_txn,v_customer);
  INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
  VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',v_customer,v_user,repeat('c',64),'verified','savings-goal-customer','savings-goal-wallet') RETURNING id INTO v_intent;
  INSERT INTO piggyvest_primary.savings_operations VALUES(v_op,'10000000-0000-4000-8000-000000000004',v_intent,v_goal,25000,'savings-source','savings-goal-wallet','savings-goal-reference','reserved',v_txn,clock_timestamp());
  BEGIN
    DELETE FROM public.customer_savings_goals WHERE id = v_goal;
    v_deleted := true;
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF v_deleted THEN RAISE EXCEPTION 'reserved savings goal deletion allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_savings_goals WHERE id = v_goal) THEN RAISE EXCEPTION 'savings-blocked goal deleted'; END IF;
  UPDATE piggyvest_primary.savings_operations SET state = 'cancelled' WHERE id = v_op;
  DELETE FROM public.customer_savings_goals WHERE id = v_goal;
  IF (SELECT count(*) FROM piggyvest_primary.savings_operations WHERE id = v_op AND goal_id IS NULL AND state = 'cancelled') <> 1 THEN RAISE EXCEPTION 'cancelled savings not detached'; END IF;
END $$;
-- Account deletion purges reusable card tokens: the collection keeps
-- its non-secret evidence, but the saved authorization must not
-- survive as a charging credential.
DO $$ DECLARE
  v_token uuid := '50000000-0000-4000-8000-000000000051';
  v_op uuid := '50000000-0000-4000-8000-000000000052';
BEGIN
  INSERT INTO public.customers VALUES(v_token,'10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000053','token@example.test');
  INSERT INTO piggyvest_primary_card.operations(id,integration_id,merchant_id,customer_id,user_id,environment,business_id,email,idempotency_key,amount_kobo,consent,fingerprint,destination_wallet_id,destination_customer_id,state)
  VALUES(v_op,'10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',v_token,'50000000-0000-4000-8000-000000000053','staging','fixture-business','token@example.test','50000000-0000-4000-8000-000000000054',25000,'{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":true}',repeat('a',64),'token-wallet','token-customer','completed');
  INSERT INTO piggyvest_primary_card.collections(operation_id,integration_id,environment,provider_transaction_id,evidence,saved_token)
  VALUES(v_op,'10000000-0000-4000-8000-000000000004','staging','424242','{"reference":"pvb-first-primary-token"}','{"authorizationCode":"AUTH_fixture","customerCode":"CUS_fixture","email":"token@example.test","reusable":true}');
  DELETE FROM public.customers WHERE id = v_token;
  IF (SELECT count(*) FROM piggyvest_primary_card.collections WHERE operation_id = v_op AND saved_token IS NULL AND provider_transaction_id = '424242' AND evidence = '{"reference":"pvb-first-primary-token"}') <> 1 THEN RAISE EXCEPTION 'saved token not purged'; END IF;
END $$;
