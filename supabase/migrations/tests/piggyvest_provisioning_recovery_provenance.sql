\set ON_ERROR_STOP on
GRANT EXECUTE ON FUNCTION piggyvest_staging.record_created_customer(uuid,uuid,uuid,uuid,text,text,text) TO recovery_test_worker;
DO $$
DECLARE
  integration uuid := '40000000-0000-4000-8000-000000000001';
  merchant uuid := '10000000-0000-4000-8000-000000000001';
  customer uuid := '20000000-0000-4000-8000-000000000004';
  goal uuid := '30000000-0000-4000-8000-000000000005';
  intent uuid;
  historical uuid;
  plan uuid;
  claim uuid;
  token uuid;
BEGIN
  SELECT id INTO historical FROM piggyvest_staging.provisioning_intents
    WHERE customer_id = '20000000-0000-4000-8000-000000000001' AND operation = 'create_customer';
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_created_customer(
    integration,merchant,historical,gen_random_uuid(),'synthetic-one','customer-one','default-wallet') = 'stale',
    'legacy acknowledgement cannot be retroactively stamped');
  SELECT intent_id INTO intent FROM piggyvest_staging.prepare_provisioning_intent(
    integration,merchant,customer,NULL,'create_customer',decode(repeat('ab',32),'hex'));
  SELECT claim_token INTO claim FROM piggyvest_staging.claim_provisioning_intent(
    integration,merchant,intent,60,'synthetic-one',NULL);
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_created_customer(
    integration,merchant,intent,gen_random_uuid(),'synthetic-one','created-four','default-four') = 'stale', 'wrong claim denied');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_created_customer(
    integration,merchant,intent,claim,'wrong-business','created-four','default-four') = 'stale', 'wrong business denied');
  BEGIN
    PERFORM piggyvest_staging.record_created_customer(integration,merchant,intent,claim,'synthetic-one','created-four','default-four');
    RAISE EXCEPTION 'rollback new provenance' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.created_customer_provenance
    WHERE intent_id = intent), 'rollback discards proof');
  PERFORM provisioning_test.assert_true((SELECT status = 'dispatched' FROM piggyvest_staging.provisioning_intents
    WHERE id = intent), 'rollback discards accepted transition');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_created_customer(
    integration,merchant,intent,claim,'synthetic-one','created-four','default-four') = 'awaiting_confirmation', 'fresh created acknowledgement durable');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_created_customer(
    integration,merchant,intent,claim,'synthetic-one','created-four','default-four') = 'stale', 'receipt cannot be rewritten on replay');
  PERFORM provisioning_test.expect_error(format('UPDATE piggyvest_staging.created_customer_provenance SET provider_wallet_id=%L WHERE intent_id=%L',
    'forged',intent), '23514');
  PERFORM provisioning_test.expect_error('TRUNCATE piggyvest_staging.created_customer_provenance', '23514');
  SELECT intent_id INTO plan FROM piggyvest_staging.prepare_provisioning_intent(
    integration,merchant,customer,goal,'create_plan_wallet',decode(repeat('cd',32),'hex'));
  SELECT claim_token INTO claim FROM piggyvest_staging.claim_provisioning_intent(
    integration,merchant,plan,60,'synthetic-one','created-four');
  PERFORM piggyvest_staging.record_provisioning_result(integration,merchant,plan,claim,'accepted','created-four','plan-four');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.begin_provisioning_verification(
    integration,merchant,customer,goal,plan,'synthetic-one')), 'unconfirmed customer proof alone cannot confirm a plan');
  SELECT verification_token INTO token FROM piggyvest_staging.begin_provisioning_verification(
    integration,merchant,customer,NULL,intent,'synthetic-one');
  PERFORM provisioning_test.assert_true(token IS NOT NULL, 'new customer proof obtains verification');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration,merchant,customer,NULL,intent,'synthetic-one',token,'default-four','synthetic-one','NGN','active') = 'completed',
    'new proven customer plus active default wallet completes');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings
    WHERE customer_id = customer), 'customer completion invents no goal mapping');
  INSERT INTO recovery_test.receipts VALUES(intent,token);
  SELECT verification_token INTO token FROM piggyvest_staging.begin_provisioning_verification(
    integration,merchant,customer,goal,plan,'synthetic-one');
  PERFORM provisioning_test.assert_true(token IS NOT NULL, 'completed customer proof bootstraps first plan without preexisting mapping');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration,merchant,customer,goal,plan,'synthetic-one',token,'plan-four','synthetic-one','NGN','active') = 'completed',
    'first plan completes from proven customer chain');
  PERFORM provisioning_test.assert_true((SELECT count(*) = 1 FROM piggyvest_staging.wallet_goal_mappings
    WHERE customer_id = customer AND goal_id = goal AND provider_wallet_id = 'plan-four'), 'first plan exact mapping');
  INSERT INTO recovery_test.receipts VALUES(plan,token);
END $$;
SET ROLE recovery_test_worker;
SELECT provisioning_test.expect_error('SELECT intent_id FROM piggyvest_staging.created_customer_provenance', '42501');
RESET ROLE;
SELECT provisioning_test.assert_true(NOT has_function_privilege('authenticated',
  'piggyvest_staging.record_created_customer(uuid,uuid,uuid,uuid,text,text,text)', 'EXECUTE'), 'authenticated cannot stamp proof');
SELECT provisioning_test.assert_true(NOT has_function_privilege('service_role',
  'piggyvest_staging.record_created_customer(uuid,uuid,uuid,uuid,text,text,text)', 'EXECUTE'), 'service role cannot stamp proof');
