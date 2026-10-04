\set ON_ERROR_STOP on
DO $$
DECLARE
  first_intent record;
  replay record;
  changed record;
  wallet record;
BEGIN
  SELECT intent_id, outcome, status INTO STRICT first_intent FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'));
  PERFORM provisioning_test.assert_true(first_intent.outcome = 'accepted' AND first_intent.status = 'pending', 'first reserve');
  SELECT intent_id, outcome INTO STRICT replay FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'));
  PERFORM provisioning_test.assert_true(replay.intent_id = first_intent.intent_id AND replay.outcome = 'duplicate', 'same identity replay');
  SELECT intent_id, outcome INTO STRICT changed FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', NULL, 'create_customer', decode(repeat('bb', 32), 'hex'));
  PERFORM provisioning_test.assert_true(changed.intent_id = first_intent.intent_id AND changed.outcome = 'conflict', 'changed fingerprint conflict');
  SELECT intent_id, outcome INTO STRICT wallet FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    'create_plan_wallet', decode(repeat('aa', 32), 'hex'));
  PERFORM provisioning_test.assert_true(wallet.intent_id <> first_intent.intent_id AND wallet.outcome = 'accepted', 'operation identities distinct');
  SELECT intent_id, outcome INTO STRICT replay FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    'create_plan_wallet', decode(repeat('aa', 32), 'hex'));
  PERFORM provisioning_test.assert_true(replay.intent_id = wallet.intent_id AND replay.outcome = 'duplicate', 'wallet replay');
  SELECT intent_id, outcome INTO STRICT changed FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    'create_plan_wallet', decode(repeat('bb', 32), 'hex'));
  PERFORM provisioning_test.assert_true(changed.intent_id = wallet.intent_id AND changed.outcome = 'conflict', 'wallet fingerprint conflict');
END $$;

DO $$
DECLARE
  bad_arguments text;
BEGIN
  FOREACH bad_arguments IN ARRAY ARRAY[
    $args$'40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', NULL, 'create_customer'$args$,
    $args$'40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', NULL, 'create_customer'$args$,
    $args$'40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', NULL, 'create_customer'$args$,
    $args$'40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'create_plan_wallet'$args$,
    $args$'40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'create_plan_wallet'$args$,
    $args$'40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', NULL, 'create_plan_wallet'$args$,
    $args$'40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'create_customer'$args$,
    $args$NULL, '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', NULL, 'create_customer'$args$
  ] LOOP
    PERFORM provisioning_test.expect_error('SELECT piggyvest_staging.prepare_provisioning_intent(' || bad_arguments ||
      ', decode(repeat(''aa'', 32), ''hex''))', '22023');
  END LOOP;
END $$;
SELECT provisioning_test.expect_error($command$
  SELECT piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', NULL, 'create_customer', '\x00'::bytea)
$command$, '22023');
SELECT provisioning_test.expect_error($command$
  UPDATE piggyvest_staging.provisioning_intents SET customer_id = '20000000-0000-4000-8000-000000000002'
$command$, '23514');
SELECT provisioning_test.expect_error($command$
  UPDATE piggyvest_staging.provisioning_intents SET request_fingerprint = decode(repeat('bb', 32), 'hex')
$command$, '23514');
SELECT provisioning_test.expect_error($command$
  UPDATE piggyvest_staging.provisioning_integrations SET merchant_id = '10000000-0000-4000-8000-000000000002'
$command$, '23514');
SELECT provisioning_test.expect_error('DELETE FROM piggyvest_staging.provisioning_intents', '23514');
SELECT provisioning_test.expect_error('TRUNCATE piggyvest_staging.provisioning_intents', '23514');
SELECT provisioning_test.expect_error('TRUNCATE piggyvest_staging.provisioning_integrations CASCADE', '23514');
SELECT provisioning_test.assert_true((SELECT count(*) = 2 AND bool_and(attempts = 0)
  FROM piggyvest_staging.provisioning_intents), 'invalid requests never created or dispatched');

UPDATE public.customer_savings_goals SET customer_id = '20000000-0000-4000-8000-000000000002'
  WHERE id = '30000000-0000-4000-8000-000000000001';
SELECT provisioning_test.assert_true(NOT EXISTS (
  SELECT 1 FROM piggyvest_staging.provisioning_intents AS intent,
    LATERAL piggyvest_staging.claim_provisioning_intent(intent.integration_id, intent.merchant_id, intent.id, 30, 'synthetic-one', NULL)
  WHERE intent.goal_id = '30000000-0000-4000-8000-000000000001'), 'ownership drift blocks dispatch');
SELECT provisioning_test.assert_true((SELECT outcome = 'conflict' FROM piggyvest_staging.prepare_provisioning_intent(
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
  'create_plan_wallet', decode(repeat('aa', 32), 'hex'))), 'same fingerprint cannot rebind goal owner');
UPDATE public.customer_savings_goals SET customer_id = '20000000-0000-4000-8000-000000000001'
  WHERE id = '30000000-0000-4000-8000-000000000001';
