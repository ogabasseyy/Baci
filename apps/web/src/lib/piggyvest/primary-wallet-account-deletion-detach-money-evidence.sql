-- Core retained money-evidence detach regression, including receipts and reversals.
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
  INSERT INTO piggyvest_primary.paid_interest_reversals(integration_id,provider_reversal_id,payout_id,amount_kobo,provider_evidence_sha256,evidence_reference)
    VALUES(v_integration,'detach-reversal','detach-payout',100,repeat('c',64),'detach-evidence');
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
