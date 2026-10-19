\set ON_ERROR_STOP on
DO $$
DECLARE
  previous_claim record;
  replay record;
BEGIN
  SELECT intent_id, claim_token INTO STRICT previous_claim FROM provisioning_test.claims WHERE label = 'concurrent';
  PERFORM provisioning_test.assert_true((SELECT attempts = 1 AND status = 'dispatched'
    AND claim_token = previous_claim.claim_token FROM piggyvest_staging.provisioning_intents
    WHERE id = previous_claim.intent_id), 'single committed claim survives restart');
  SELECT intent_id, outcome, status INTO STRICT replay FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000004', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'));
  PERFORM provisioning_test.assert_true(replay.intent_id = previous_claim.intent_id AND replay.outcome = 'duplicate'
    AND replay.status = 'dispatched', 'restart retains request identity and attempt');
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', previous_claim.intent_id,
    300, 'synthetic-one', NULL)), 'restart cannot resend after lost POST outcome');
  PERFORM provisioning_test.assert_true((SELECT provider_customer_id = 'customer-one'
    AND provider_wallet_id = 'customer-wallet-one' AND status = 'awaiting_confirmation'
    FROM piggyvest_staging.provisioning_intents WHERE customer_id = '20000000-0000-4000-8000-000000000001'
      AND operation = 'create_customer'), 'raw opaque recovery references survive restart');
END $$;
ALTER TABLE piggyvest_staging.provisioning_intents DISABLE TRIGGER guard_provisioning_intent_rows;
UPDATE piggyvest_staging.provisioning_intents SET lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE id = (SELECT intent_id FROM provisioning_test.claims WHERE label = 'concurrent');
ALTER TABLE piggyvest_staging.provisioning_intents ENABLE TRIGGER guard_provisioning_intent_rows;
UPDATE piggyvest_staging.integrations SET enabled = false WHERE id = '40000000-0000-4000-8000-000000000001';
SELECT provisioning_test.assert_true(piggyvest_staging.expire_provisioning_claim(
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  (SELECT intent_id FROM provisioning_test.claims WHERE label = 'concurrent')) = 'unknown', 'disabled expired claim becomes unknown');
UPDATE piggyvest_staging.integrations SET enabled = true WHERE id = '40000000-0000-4000-8000-000000000001';
SELECT provisioning_test.assert_true(NOT EXISTS (
  SELECT 1 FROM piggyvest_staging.provisioning_intents AS entry,
    LATERAL piggyvest_staging.claim_provisioning_intent(entry.integration_id, entry.merchant_id, entry.id, 300,
      'synthetic-one', NULL) AS claim), 'no completed or uncertain intent can ever reclaim');
SELECT provisioning_test.assert_true((SELECT bool_and(attempts = 1) FROM piggyvest_staging.provisioning_intents), 'all attempts remain exactly one');
