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
\ir ../../../../../supabase/migrations/20261007144000_piggyvest_primary_savings_reservations.sql
\ir ../../../../../supabase/migrations/20261007150000_piggyvest_primary_savings_settlement.sql
\ir ../../../../../supabase/migrations/20261007181000_piggyvest_primary_paid_interest_completion.sql
\ir ../../../../../supabase/migrations/20261007190000_piggyvest_primary_savings_provisioning.sql
\ir ../../../../../supabase/migrations/20261007220000_piggyvest_primary_interest_storage.sql
\ir ../../../../../supabase/migrations/20261008092700_primary_wallet_account_deletion_detach.sql
-- Account deletion must succeed for a fully onboarded customer: money
-- evidence detaches (customer/goal NULL, row retained) while goal-scoped
-- operational rows cascade with their goal.
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
  INSERT INTO piggyvest_primary.savings_destinations VALUES(v_integration,v_goal,v_intent,'detach-wallet',true);
  INSERT INTO piggyvest_primary.savings_operations VALUES(v_savings_operation,v_integration,v_intent,v_goal,25000,'source-wallet','detach-wallet','detach-reference','confirmed',v_wallet_transaction,clock_timestamp());
  INSERT INTO piggyvest_primary.savings_completion_reviews VALUES(v_goal,v_integration,v_merchant,v_customer,ARRAY[v_savings_operation],'0','open',clock_timestamp(),clock_timestamp());
  INSERT INTO piggyvest_primary.savings_completion_evidence VALUES(v_savings_operation,v_integration,'detach-provider-txn','{}',clock_timestamp());
  INSERT INTO piggyvest_primary.goal_wallet_intents VALUES(v_integration,v_goal,v_intent,'detach-wallet-name','enrolled',NULL,'detach-wallet',true,clock_timestamp(),clock_timestamp(),clock_timestamp());
  INSERT INTO piggyvest_primary_card.operations(integration_id,merchant_id,customer_id,user_id,environment,business_id,email,idempotency_key,amount_kobo,consent,fingerprint,destination_wallet_id,destination_customer_id,state)
  VALUES(v_integration,v_merchant,v_customer,v_user,'staging','fixture-business','detach@example.test','50000000-0000-4000-8000-000000000007',25000,'{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}',repeat('e',64),'detach-wallet','detach-customer','ready');
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
  -- Goal-scoped operational rows cascade with their goal.
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_destinations WHERE goal_id = v_goal) THEN RAISE EXCEPTION 'destinations not cascaded'; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations WHERE id = v_savings_operation) THEN RAISE EXCEPTION 'operations not cascaded'; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_completion_reviews WHERE goal_id = v_goal) THEN RAISE EXCEPTION 'reviews not cascaded'; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_completion_evidence WHERE operation_id = v_savings_operation) THEN RAISE EXCEPTION 'evidence not cascaded'; END IF;
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
