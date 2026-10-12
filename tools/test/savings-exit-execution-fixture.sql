CREATE SCHEMA savings_exit_execution_test;
CREATE FUNCTION savings_exit_execution_test.assert(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF;
END $$;
CREATE FUNCTION savings_exit_execution_test.reject(statement text, expected_state text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF expected_state IS NULL OR SQLSTATE = expected_state THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'expected rejection';
END $$;

INSERT INTO public.customer_savings_goals
  (id,merchant_id,customer_id,product_id,variant_id,product_snapshot,updated_at,current_amount,initial_contribution_amount,status,source_mode)
SELECT goal_policy_test.goal(212),merchant_id,customer_id,product_id,variant_id,product_snapshot,updated_at,0,0,'paused','manual'
FROM public.customer_savings_goals WHERE id=goal_policy_test.goal(201);
INSERT INTO piggyvest_savings_ledger.bindings
SELECT goal_policy_test.goal(212),integration_id,merchant_id,customer_id,authorized_login,enabled
FROM piggyvest_savings_ledger.bindings WHERE goal_id=goal_policy_test.goal(201);
INSERT INTO piggyvest_goal_policy.bindings
SELECT goal_policy_test.goal(212),integration_id,merchant_id,customer_id,expected_business_id,authorized_login,enabled
FROM piggyvest_goal_policy.bindings WHERE goal_id=goal_policy_test.goal(201);
INSERT INTO piggyvest_goal_policy.lifecycle_gates(goal_id,enabled) VALUES(goal_policy_test.goal(212),true);

SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT goal_policy_test.stage(212);
SELECT piggyvest_goal_policy.prepare_lifecycle_terms('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
  (goal_policy_test.command(212)->>'revisionId')::uuid,1);
SELECT piggyvest_goal_policy.accept_lifecycle_terms('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
  (goal_policy_test.command(212)->>'revisionId')::uuid,'90000000-0000-4000-8000-000000000001',1);
SELECT goal_policy_test.purchase_credit(212,99150,1212);
SELECT piggyvest_goal_policy.activate_lifecycle('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
  (goal_policy_test.command(212)->>'revisionId')::uuid,goal_policy_test.goal(2212));
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_purchase_preparation.quotes(id,goal_id,revision_id,product_id,variant_id,condition,currency,quantity,
  current_device_kobo,delivery_kobo,tax_kobo,fee_kobo,savings_kobo,quoted_at,expires_at,enabled)
SELECT goal_policy_test.goal(212),goal_policy_test.goal(212),(goal_policy_test.command(212)->>'revisionId')::uuid,
  product_id,variant_id,condition,currency,quantity,97000,2000,100,50,99150,clock_timestamp(),clock_timestamp()+interval '1 day',true
FROM piggyvest_purchase_preparation.quotes WHERE id=goal_policy_test.goal(201);

SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT goal_policy_test.purchase_prepare(212,jsonb_build_object('operationId',goal_policy_test.goal(4212),
  'actorId','90000000-0000-4000-8000-000000000001','accepted',true,'quote',goal_policy_test.purchase_quote(212)));
RESET SESSION AUTHORIZATION;

INSERT INTO piggyvest_staging.wallet_goal_mappings
  (integration_id,provider_wallet_id,provider_customer_id,merchant_id,customer_id,goal_id)
VALUES ('40000000-0000-4000-8000-000000000001','goal-212-wallet','customer-212',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212));
INSERT INTO piggyvest_savings_exit_execution.wallet_authorities
  (integration_id,provider_wallet_id,authority_kind,merchant_id,customer_id,verified_at)
VALUES
  ('40000000-0000-4000-8000-000000000001','merchant-wallet','merchant','10000000-0000-4000-8000-000000000001',NULL,clock_timestamp()),
  ('40000000-0000-4000-8000-000000000001','customer-wallet','customer','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',clock_timestamp());
INSERT INTO piggyvest_savings_exit_execution.provisioned_policies
  (policy_id,integration_id,merchant_id,customer_id,goal_id,action,revision_id,version,source_wallet_id,
   purchase_destination_wallet_id,cancellation_destination_wallet_id,purchase_requires_fully_funded_goal,
   purchase_paid_interest_disposition,cancellation_principal_disposition,cancellation_paid_interest_disposition,
   cancellation_pending_interest_disposition,cancellation_fee_kobo)
VALUES ('70000000-0000-4000-8000-000000000212','40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),
  'purchase',(goal_policy_test.command(212)->>'revisionId')::uuid,'synthetic-v1','goal-212-wallet','merchant-wallet',
  'customer-wallet',true,'retain','return_to_owned_wallet','retain','retain',0);

INSERT INTO public.customer_savings_goals
  (id,merchant_id,customer_id,product_id,variant_id,product_snapshot,updated_at,current_amount,initial_contribution_amount,status,source_mode)
SELECT goal_policy_test.goal(213),merchant_id,customer_id,product_id,variant_id,product_snapshot,updated_at,0,0,'active','manual'
FROM public.customer_savings_goals WHERE id=goal_policy_test.goal(212);
INSERT INTO piggyvest_savings_ledger.bindings
SELECT goal_policy_test.goal(213),integration_id,merchant_id,customer_id,authorized_login,enabled
FROM piggyvest_savings_ledger.bindings WHERE goal_id=goal_policy_test.goal(212);
INSERT INTO piggyvest_goal_policy.bindings
SELECT goal_policy_test.goal(213),integration_id,merchant_id,customer_id,expected_business_id,authorized_login,enabled
FROM piggyvest_goal_policy.bindings WHERE goal_id=goal_policy_test.goal(212);
GRANT EXECUTE ON FUNCTION piggyvest_goal_policy.accept(uuid,uuid,uuid,uuid,text,uuid,uuid)
  TO piggyvest_staging_policy_writer;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT goal_policy_test.stage(213);
SELECT piggyvest_goal_policy.accept('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(213),'synthetic-business',
  (goal_policy_test.command(213)->>'revisionId')::uuid,'90000000-0000-4000-8000-000000000001');
SELECT goal_policy_test.purchase_credit(213,100,1213);
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_cancel_plan.reviewed_policies(terms_version,terms_sha256,consent_version,enabled)
  VALUES('synthetic-v1',repeat('a',64),'2026-09-11',true);
GRANT USAGE ON SCHEMA piggyvest_cancel_plan TO piggyvest_staging_policy_writer;
GRANT EXECUTE ON FUNCTION piggyvest_cancel_plan.prepare(uuid,uuid,uuid,uuid,text,jsonb)
  TO piggyvest_staging_policy_writer;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT piggyvest_cancel_plan.prepare('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(213),'synthetic-business',
  jsonb_build_object('operationId',goal_policy_test.goal(4213),'actorId','90000000-0000-4000-8000-000000000001',
    'revisionId',goal_policy_test.command(213)->>'revisionId','termsVersion','synthetic-v1','termsHash',repeat('a',64),
    'consentVersion','2026-09-11','accepted',true,'principalKobo',100,'paidInterestKobo',0,'pendingInterestKobo',0));
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_staging.wallet_goal_mappings
  (integration_id,provider_wallet_id,provider_customer_id,merchant_id,customer_id,goal_id)
VALUES ('40000000-0000-4000-8000-000000000001','goal-213-wallet','customer-213',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',goal_policy_test.goal(213));
INSERT INTO piggyvest_savings_exit_execution.provisioned_policies
  (policy_id,integration_id,merchant_id,customer_id,goal_id,action,revision_id,version,source_wallet_id,
   purchase_destination_wallet_id,cancellation_destination_wallet_id,purchase_requires_fully_funded_goal,
   purchase_paid_interest_disposition,cancellation_principal_disposition,cancellation_paid_interest_disposition,
   cancellation_pending_interest_disposition,cancellation_fee_kobo)
VALUES ('70000000-0000-4000-8000-000000000213','40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',goal_policy_test.goal(213),
  'cancellation',(goal_policy_test.command(213)->>'revisionId')::uuid,'synthetic-v1','goal-213-wallet','merchant-wallet',
  'customer-wallet',true,'retain','return_to_owned_wallet','retain','retain',0);

GRANT USAGE ON SCHEMA piggyvest_savings_exit_execution TO piggyvest_staging_policy_writer;
GRANT USAGE ON SCHEMA savings_exit_execution_test TO piggyvest_staging_policy_writer;
GRANT EXECUTE ON FUNCTION savings_exit_execution_test.assert(boolean,text),
  savings_exit_execution_test.reject(text,text) TO piggyvest_staging_policy_writer;
GRANT EXECUTE ON FUNCTION piggyvest_savings_exit_execution.begin(uuid,uuid,uuid,uuid,text,uuid,uuid,text,jsonb),
  piggyvest_savings_exit_execution.record_finality(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb)
  TO piggyvest_staging_policy_writer;
