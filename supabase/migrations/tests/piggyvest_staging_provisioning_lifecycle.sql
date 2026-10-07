\set ON_ERROR_STOP on
CREATE TABLE provisioning_test.claims (label text PRIMARY KEY, intent_id uuid NOT NULL, claim_token uuid NOT NULL);
DO $$
DECLARE
  customer_intent uuid;
  wallet_intent uuid;
  customer_claim record;
  wallet_claim record;
  replay record;
BEGIN
  SELECT id INTO STRICT customer_intent FROM piggyvest_staging.provisioning_intents WHERE operation = 'create_customer';
  SELECT id INTO STRICT wallet_intent FROM piggyvest_staging.provisioning_intents WHERE operation = 'create_plan_wallet';
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', customer_intent, 30,
    'synthetic-one', NULL)), 'wrong merchant cannot claim');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', customer_intent, 30,
    'synthetic-two', NULL)), 'wrong integration cannot claim');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', customer_intent, 30,
    'Synthetic-one', NULL)), 'provider account exact case required');
  UPDATE piggyvest_staging.provisioning_integrations SET enabled = false
    WHERE integration_id = '40000000-0000-4000-8000-000000000001';
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', customer_intent, 30,
    'synthetic-one', NULL)), 'disabled provisioning binding blocks claim');
  UPDATE piggyvest_staging.provisioning_integrations SET enabled = true
    WHERE integration_id = '40000000-0000-4000-8000-000000000001';
  SELECT intent_id, claim_token, attempts, lease_expires_at INTO STRICT customer_claim
    FROM piggyvest_staging.claim_provisioning_intent(
      '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', customer_intent, 300,
      'synthetic-one', NULL);
  PERFORM provisioning_test.assert_true(customer_claim.attempts = 1 AND customer_claim.claim_token IS NOT NULL
    AND customer_claim.lease_expires_at > clock_timestamp(), 'first claim fence');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', customer_intent, 300,
    'synthetic-one', NULL)), 'live claim cannot resend');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', customer_intent,
    customer_claim.claim_token, 'accepted', 'customer-one', 'customer-wallet-one') = 'stale', 'wrong tenant cannot finish');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', customer_intent,
    customer_claim.claim_token, 'accepted', 'customer-one', 'customer-wallet-one') = 'stale', 'wrong integration cannot finish');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', customer_intent,
    '99999999-9999-4999-8999-999999999999', 'accepted', 'customer-one', 'customer-wallet-one') = 'stale', 'wrong fence cannot finish');
  PERFORM provisioning_test.expect_error(format(
    'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''accepted'',NULL,''wallet'')',
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', customer_intent,
    customer_claim.claim_token), '22023');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', customer_intent,
    customer_claim.claim_token, 'accepted', 'customer-one', 'customer-wallet-one') = 'awaiting_confirmation', 'customer acknowledgement not completion');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', customer_intent,
    customer_claim.claim_token, 'ambiguous', NULL, NULL) = 'stale', 'replay cannot overwrite result');
  SELECT intent_id, claim_token INTO STRICT wallet_claim FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', wallet_intent, 300, 'synthetic-one', 'customer-one');
  PERFORM provisioning_test.expect_error(format(
    'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''accepted'',''other-customer'',''wallet-one'')',
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', wallet_intent,
    wallet_claim.claim_token), '23514');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', wallet_intent,
    wallet_claim.claim_token, 'accepted', 'customer-one', 'wallet-one') = 'awaiting_confirmation', 'wallet 200 acknowledgement awaits confirmation');
  SELECT intent_id, outcome, status INTO STRICT replay FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'));
  PERFORM provisioning_test.assert_true(replay.intent_id = customer_intent AND replay.outcome = 'duplicate'
    AND replay.status = 'awaiting_confirmation', 'replay retains acknowledgement');
END $$;
SELECT provisioning_test.expect_error($command$
  UPDATE piggyvest_staging.provisioning_intents SET status = 'completed'
$command$, '23514');
SELECT provisioning_test.expect_error($command$
  UPDATE piggyvest_staging.provisioning_intents SET status = 'pending', attempts = 0, result_code = NULL,
    provider_customer_id = NULL, provider_wallet_id = NULL
$command$, '23514');
SELECT provisioning_test.assert_true((SELECT count(*) = 0 FROM piggyvest_staging.wallet_goal_mappings), 'acknowledgements create no verified mappings');

INSERT INTO provisioning_test.claims (label, intent_id, claim_token)
SELECT 'expiry', claimed.intent_id, claimed.claim_token FROM piggyvest_staging.prepare_provisioning_intent(
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002', NULL, 'create_customer', decode(repeat('aa', 32), 'hex')) AS reserved,
  LATERAL piggyvest_staging.claim_provisioning_intent('40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001', reserved.intent_id, 300, 'synthetic-one', NULL) AS claimed;
ALTER TABLE piggyvest_staging.provisioning_intents DISABLE TRIGGER guard_provisioning_intent_rows;
UPDATE piggyvest_staging.provisioning_intents SET lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE id = (SELECT intent_id FROM provisioning_test.claims WHERE label = 'expiry');
ALTER TABLE piggyvest_staging.provisioning_intents ENABLE TRIGGER guard_provisioning_intent_rows;
DO $$
DECLARE
  expired record;
BEGIN
  SELECT intent_id, claim_token INTO STRICT expired FROM provisioning_test.claims WHERE label = 'expiry';
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', expired.intent_id, 300,
    'synthetic-one', NULL)), 'expired claim never resends before expiry marker');
  PERFORM provisioning_test.assert_true(piggyvest_staging.expire_provisioning_claim(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', expired.intent_id) = 'stale', 'tenant cannot expire others');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', expired.intent_id,
    expired.claim_token, 'accepted', 'late-customer', 'late-wallet') = 'stale', 'late acknowledged response fenced');
  PERFORM provisioning_test.assert_true((SELECT status = 'unknown' AND attempts = 1 AND result_code = 'lease_expired'
    AND claim_token IS NULL AND provider_customer_id IS NULL FROM piggyvest_staging.provisioning_intents
    WHERE id = expired.intent_id), 'expired uncertainty durable');
END $$;

DO $$
DECLARE
  reserved record;
  claimed record;
  replay record;
BEGIN
  SELECT intent_id INTO STRICT reserved FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
    'create_plan_wallet', decode(repeat('aa', 32), 'hex'));
  SELECT intent_id, claim_token INTO STRICT claimed FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', reserved.intent_id, 300, 'synthetic-one', 'customer-one');
  UPDATE piggyvest_staging.integrations SET enabled = false WHERE id = '40000000-0000-4000-8000-000000000001';
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
    claimed.claim_token, 'timeout', NULL, NULL) = 'unknown', 'timeout recorded even after disable');
  UPDATE piggyvest_staging.integrations SET enabled = true WHERE id = '40000000-0000-4000-8000-000000000001';
  SELECT intent_id, outcome, status INTO STRICT replay FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
    'create_plan_wallet', decode(repeat('aa', 32), 'hex'));
  PERFORM provisioning_test.assert_true(replay.intent_id = claimed.intent_id AND replay.outcome = 'duplicate'
    AND replay.status = 'unknown', 'timeout replay stays unknown');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id, 300,
    'synthetic-one', NULL)), 'timeout replay cannot POST again');
END $$;
