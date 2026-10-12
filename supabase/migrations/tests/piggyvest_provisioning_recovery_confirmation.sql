\set ON_ERROR_STOP on
CREATE SCHEMA recovery_test;
CREATE TABLE recovery_test.receipts (intent_id uuid, verification_token uuid);
CREATE ROLE recovery_test_worker NOINHERIT;
GRANT USAGE ON SCHEMA piggyvest_staging, provisioning_test TO recovery_test_worker;
GRANT EXECUTE ON FUNCTION piggyvest_staging.read_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text),
  piggyvest_staging.observe_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text),
  piggyvest_staging.begin_provisioning_verification(uuid, uuid, uuid, uuid, uuid, text),
  piggyvest_staging.confirm_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, text)
  TO recovery_test_worker;

DO $$
DECLARE
  integration uuid := '40000000-0000-4000-8000-000000000001';
  merchant uuid := '10000000-0000-4000-8000-000000000001';
  customer uuid := '20000000-0000-4000-8000-000000000001';
  other_customer uuid := '20000000-0000-4000-8000-000000000002';
  goal uuid := '30000000-0000-4000-8000-000000000002';
  customer_intent uuid;
  plan_intent uuid;
  unknown_intent uuid;
  claim uuid;
  token uuid;
  old_token uuid;
BEGIN
  SELECT intent_id INTO customer_intent FROM piggyvest_staging.prepare_provisioning_intent(
    integration, merchant, customer, NULL, 'create_customer', decode(repeat('ab', 32), 'hex'));
  SELECT claim_token INTO claim FROM piggyvest_staging.claim_provisioning_intent(
    integration, merchant, customer_intent, 60, 'synthetic-one', NULL);
  PERFORM piggyvest_staging.record_provisioning_result(
    integration, merchant, customer_intent, claim, 'accepted', 'customer-one', 'default-wallet');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.begin_provisioning_verification(
    integration, merchant, customer, NULL, customer_intent, 'synthetic-one')), 'historical customer acknowledgement lacks new_customer provenance');
  SELECT intent_id INTO plan_intent FROM piggyvest_staging.prepare_provisioning_intent(
    integration, merchant, customer, goal, 'create_plan_wallet', decode(repeat('cd', 32), 'hex'));
  SELECT claim_token INTO claim FROM piggyvest_staging.claim_provisioning_intent(
    integration, merchant, plan_intent, 60, 'synthetic-one', 'customer-one');
  PERFORM piggyvest_staging.record_provisioning_result(
    integration, merchant, plan_intent, claim, 'accepted', 'customer-one', 'plan-wallet');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.begin_provisioning_verification(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one')), 'plan cannot inherit ambiguous customer acknowledgement without trusted mapping');
  INSERT INTO piggyvest_staging.wallet_goal_mappings (
    integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES (integration, 'trusted-existing-wallet', 'customer-one', merchant, customer,
      '30000000-0000-4000-8000-000000000001');
  PERFORM provisioning_test.assert_true((SELECT count(*) = 1 FROM piggyvest_staging.read_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one')), 'scoped acknowledged read');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.read_provisioning_recovery(
    integration, merchant, other_customer, goal, plan_intent, 'synthetic-one')), 'wrong customer read denied');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.read_provisioning_recovery(
    integration, merchant, customer, NULL, plan_intent, 'synthetic-one')), 'wrong goal read denied');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.read_provisioning_recovery(
    integration, other_customer, customer, goal, plan_intent, 'synthetic-one')), 'wrong merchant read denied');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.read_provisioning_recovery(
    merchant, merchant, customer, goal, plan_intent, 'synthetic-one')), 'wrong integration read denied');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.read_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'Synthetic-one')), 'business comparison exact');
  SELECT verification_token INTO old_token FROM piggyvest_staging.begin_provisioning_verification(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one');
  SELECT verification_token INTO token FROM piggyvest_staging.begin_provisioning_verification(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one');
  PERFORM provisioning_test.assert_true(token <> old_token, 'snapshot rotation fences concurrent verifier');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', old_token,
    'plan-wallet', 'synthetic-one', 'NGN', 'active') = 'stale', 'old verification token denied');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'different-wallet', 'synthetic-one', 'NGN', 'active') = 'wallet_mismatch', 'supplied wallet cannot prove ownership');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'different-business', 'NGN', 'active') = 'wallet_mismatch', 'wrong business blocked');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'synthetic-one', 'USD', 'active') = 'wallet_mismatch', 'wrong currency blocked');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'synthetic-one', 'NGN', 'pending') = 'wallet_not_active', 'unready wallet blocked');
  UPDATE piggyvest_staging.provisioning_recovery_verifications SET
    issued_at = clock_timestamp() - interval '120 seconds', expires_at = clock_timestamp() - interval '60 seconds'
    WHERE intent_id = plan_intent;
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'synthetic-one', 'NGN', 'active') = 'stale', 'expired observation cannot confirm');
  SELECT verification_token INTO token FROM piggyvest_staging.begin_provisioning_verification(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one');
  UPDATE piggyvest_staging.integrations SET enabled = false WHERE id = integration;
  PERFORM provisioning_test.assert_true((SELECT count(*) = 1 FROM piggyvest_staging.read_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one')), 'disabled integration recovery still readable');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'synthetic-one', 'NGN', 'active') = 'stale', 'disabled registry cannot confirm');
  UPDATE piggyvest_staging.integrations SET enabled = true, expected_provider_account_id = 'changed' WHERE id = integration;
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'synthetic-one', 'NGN', 'active') = 'stale', 'changed registry invalidates snapshot');
  UPDATE piggyvest_staging.integrations SET expected_provider_account_id = 'synthetic-one' WHERE id = integration;
  UPDATE public.customer_savings_goals SET customer_id = other_customer WHERE id = goal;
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'synthetic-one', 'NGN', 'active') = 'stale', 'current goal ownership rechecked');
  UPDATE public.customer_savings_goals SET customer_id = customer WHERE id = goal;
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'synthetic-one', 'NGN', 'active') = 'completed', 'accepted canonical plan chain plus active GET completes');
  PERFORM provisioning_test.assert_true((SELECT count(*) = 1 FROM piggyvest_staging.wallet_goal_mappings
    WHERE goal_id = goal AND provider_wallet_id = 'plan-wallet' AND provider_customer_id = 'customer-one'), 'exact plan mapping persisted');
  PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
    integration, merchant, customer, goal, plan_intent, 'synthetic-one', token,
    'plan-wallet', 'synthetic-one', 'NGN', 'active') = 'completed', 'completed receipt idempotent');
  INSERT INTO recovery_test.receipts VALUES (plan_intent, token);
  SELECT intent_id INTO unknown_intent FROM piggyvest_staging.prepare_provisioning_intent(
    integration, merchant, other_customer, NULL, 'create_customer', decode(repeat('ef', 32), 'hex'));
  SELECT claim_token INTO claim FROM piggyvest_staging.claim_provisioning_intent(
    integration, merchant, unknown_intent, 60, 'synthetic-one', NULL);
  PERFORM piggyvest_staging.record_provisioning_result(integration, merchant, unknown_intent, claim, 'ambiguous', NULL, NULL);
  PERFORM provisioning_test.assert_true(piggyvest_staging.observe_provisioning_recovery(
    integration, merchant, other_customer, NULL, unknown_intent, 'synthetic-one',
    'supplied-wallet', 'synthetic-one', 'NGN', 'active') = 'missing_reference', 'unknown supplied ID not evidence');
  PERFORM piggyvest_staging.observe_provisioning_recovery(integration, merchant, other_customer, NULL,
    unknown_intent, 'synthetic-one', NULL, NULL, NULL, NULL);
  PERFORM provisioning_test.assert_true((SELECT count(*) = 1 FROM piggyvest_staging.provisioning_recovery_observations
    WHERE intent_id = unknown_intent), 'duplicate observations bounded');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.begin_provisioning_verification(
    integration, merchant, other_customer, NULL, unknown_intent, 'synthetic-one')), 'unknown never obtains confirmation token');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    integration, merchant, unknown_intent, 60, 'synthetic-one', NULL)), 'unknown never resends');
  PERFORM provisioning_test.assert_true((SELECT bool_and(attempts = 1) FROM piggyvest_staging.provisioning_intents), 'recovery never increments attempts');
END $$;

SET ROLE recovery_test_worker;
SELECT provisioning_test.expect_error('SELECT intent_id FROM piggyvest_staging.provisioning_recovery_verifications', '42501');
SELECT provisioning_test.expect_error('SELECT id FROM piggyvest_staging.provisioning_intents', '42501');
SELECT provisioning_test.expect_error('DELETE FROM piggyvest_staging.provisioning_recovery_observations', '42501');
SELECT provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.read_provisioning_recovery(
  '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', NULL, '40000000-0000-4000-8000-000000000001', 'synthetic-one')), 'restricted function scoped');
RESET ROLE;
SELECT provisioning_test.assert_true(NOT has_function_privilege('anon',
  'piggyvest_staging.read_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'anon cannot recover');
SELECT provisioning_test.assert_true(NOT has_function_privilege('authenticated',
  'piggyvest_staging.confirm_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text)', 'EXECUTE'), 'authenticated cannot confirm');
SELECT provisioning_test.assert_true(NOT has_function_privilege('service_role',
  'piggyvest_staging.confirm_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text)', 'EXECUTE'), 'service role cannot confirm');
