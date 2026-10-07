\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  integration uuid := '40000000-0000-4000-8000-000000000001';
  merchant uuid := '10000000-0000-4000-8000-000000000001';
  customer uuid := '20000000-0000-4000-8000-000000000001';
  goal uuid := '30000000-0000-4000-8000-000000000006';
  intent uuid;
  claim uuid;
  token uuid;
BEGIN
  INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id) VALUES(goal,merchant,customer);
  SELECT intent_id INTO intent FROM piggyvest_staging.prepare_provisioning_intent(
    integration,merchant,customer,goal,'create_plan_wallet',decode(repeat('ef',32),'hex'));
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.read_provisioning_recovery(
    integration,merchant,customer,goal,intent,'synthetic-one')), 'pending excluded from recovery');
  SELECT claim_token INTO claim FROM piggyvest_staging.claim_provisioning_intent(
    integration,merchant,intent,60,'synthetic-one','customer-one');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.read_provisioning_recovery(
    integration,merchant,customer,goal,intent,'synthetic-one')), 'live dispatch excluded from recovery');
  PERFORM piggyvest_staging.record_provisioning_result(integration,merchant,intent,claim,'accepted','customer-one','wallet-six');
  SELECT verification_token INTO token FROM piggyvest_staging.begin_provisioning_verification(
    integration,merchant,customer,goal,intent,'synthetic-one');
  BEGIN
    UPDATE piggyvest_staging.provisioning_recovery_verifications SET request_fingerprint = decode(repeat('00',32),'hex')
      WHERE intent_id = intent;
    PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
      integration,merchant,customer,goal,intent,'synthetic-one',token,'wallet-six','synthetic-one','NGN','active') = 'stale',
      'snapshot fingerprint must equal exact acknowledged intent');
    RAISE EXCEPTION 'rollback synthetic snapshot tamper' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  BEGIN
    UPDATE piggyvest_staging.provisioning_integrations SET enabled = false WHERE integration_id = integration;
    PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
      integration,merchant,customer,goal,intent,'synthetic-one',token,'wallet-six','synthetic-one','NGN','active') = 'stale',
      'disabled merchant binding invalidates verification');
    RAISE EXCEPTION 'rollback disable' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  BEGIN
    INSERT INTO piggyvest_staging.wallet_goal_mappings(
      integration_id,provider_wallet_id,provider_customer_id,merchant_id,customer_id,goal_id)
      VALUES(integration,'different-existing-wallet','customer-one',merchant,customer,goal);
    PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
      integration,merchant,customer,goal,intent,'synthetic-one',token,'wallet-six','synthetic-one','NGN','active') = 'mapping_conflict',
      'conflicting goal mapping never overwritten');
    PERFORM provisioning_test.assert_true((SELECT completed_at IS NULL FROM piggyvest_staging.provisioning_recovery_verifications
      WHERE intent_id = intent), 'conflict leaves no completed receipt');
    RAISE EXCEPTION 'rollback conflicting fixture mapping' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  BEGIN
    PERFORM provisioning_test.assert_true(piggyvest_staging.confirm_provisioning_recovery(
      integration,merchant,customer,goal,intent,'synthetic-one',token,'wallet-six','synthetic-one','NGN','active') = 'completed',
      'confirmation inside transaction');
    RAISE EXCEPTION 'rollback complete transaction' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings
    WHERE goal_id = goal), 'rollback removes plan mapping');
  PERFORM provisioning_test.assert_true((SELECT completed_at IS NULL FROM piggyvest_staging.provisioning_recovery_verifications
    WHERE intent_id = intent), 'rollback removes completed receipt atomically');
  PERFORM provisioning_test.expect_error(format(
    'SELECT piggyvest_staging.observe_provisioning_recovery(%L,%L,%L,%L,%L,%L,%L,NULL,NULL,NULL)',
    integration,merchant,customer,goal,intent,'synthetic-one','wallet-six'), '22023');
END $$;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT provisioning_test.expect_error($query$
  SELECT piggyvest_staging.begin_provisioning_verification(
    '40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',NULL,'40000000-0000-4000-8000-000000000001','synthetic-one')
$query$, '22023');
ROLLBACK;
