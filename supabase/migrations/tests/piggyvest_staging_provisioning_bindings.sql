\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  reserved record;
  claimed record;
  missing_reference text;
BEGIN
  SELECT intent_id INTO STRICT reserved FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003',
    'create_plan_wallet', decode(repeat('aa', 32), 'hex'));
  FOREACH missing_reference IN ARRAY ARRAY[NULL, 'missing-customer', 'customer-one'] LOOP
    PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
      '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', reserved.intent_id,
      300, 'synthetic-one', missing_reference)), 'null, absent, or another customers reference blocks POST');
  END LOOP;
  PERFORM provisioning_test.assert_true((SELECT attempts = 0 AND status = 'pending'
    FROM piggyvest_staging.provisioning_intents WHERE id = reserved.intent_id), 'rejected bindings consume no dispatch');
  INSERT INTO piggyvest_staging.wallet_goal_mappings
    (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES ('40000000-0000-4000-8000-000000000001', 'existing-wallet-two', 'customer-two',
      '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003');
  UPDATE public.customer_savings_goals SET customer_id = '20000000-0000-4000-8000-000000000001'
    WHERE id = '30000000-0000-4000-8000-000000000003';
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', reserved.intent_id,
    300, 'synthetic-one', 'customer-two')), 'valid provider binding cannot override changed goal ownership');
  UPDATE public.customer_savings_goals SET customer_id = '20000000-0000-4000-8000-000000000002'
    WHERE id = '30000000-0000-4000-8000-000000000003';
  UPDATE public.customers SET merchant_id = '10000000-0000-4000-8000-000000000002'
    WHERE id = '20000000-0000-4000-8000-000000000002';
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', reserved.intent_id,
    300, 'synthetic-one', 'customer-two')), 'valid provider binding cannot override changed merchant ownership');
  UPDATE public.customers SET merchant_id = '10000000-0000-4000-8000-000000000001'
    WHERE id = '20000000-0000-4000-8000-000000000002';
  SELECT intent_id, claim_token INTO STRICT claimed FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', reserved.intent_id,
    300, 'synthetic-one', 'customer-two');
  PERFORM provisioning_test.assert_true((SELECT dispatch_provider_customer_id = 'customer-two'
    FROM piggyvest_staging.provisioning_intents WHERE id = claimed.intent_id), 'canonical dispatch customer durable');
  PERFORM provisioning_test.expect_error(format(
    'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''accepted'',NULL,''new-wallet-two'')',
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
    claimed.claim_token), '23514');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
    claimed.claim_token, 'accepted', 'customer-two', 'new-wallet-two') = 'awaiting_confirmation', 'existing mapping permits correlated acknowledgement');
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  reserved record;
BEGIN
  SELECT intent_id INTO STRICT reserved FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'));
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', reserved.intent_id,
    300, 'synthetic-two', 'unexpected-customer')), 'customer creation cannot claim with provider customer input');
  UPDATE piggyvest_staging.integrations SET enabled = false WHERE id = '40000000-0000-4000-8000-000000000002';
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', reserved.intent_id,
    300, 'synthetic-two', NULL)), 'disabled provider registry blocks existing pending intent');
  UPDATE piggyvest_staging.integrations SET enabled = true, expected_provider_account_id = 'replacement-business'
    WHERE id = '40000000-0000-4000-8000-000000000002';
  PERFORM provisioning_test.expect_error(format('SELECT piggyvest_staging.claim_provisioning_intent(%L,%L,%L,300,%L,NULL)',
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', reserved.intent_id,
    'replacement-business'), '23514');
  PERFORM provisioning_test.assert_true((SELECT attempts = 0 AND status = 'pending'
    FROM piggyvest_staging.provisioning_intents WHERE id = reserved.intent_id), 'changed business cannot inherit old correlations');
END $$;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT provisioning_test.expect_error($command$
  SELECT piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'))
$command$, '22023');
ROLLBACK;
