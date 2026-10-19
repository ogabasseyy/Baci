\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  reserved record;
  claimed record;
  unsafe_reference text;
BEGIN
  SELECT intent_id INTO STRICT reserved FROM piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000004', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'));
  SELECT intent_id, claim_token INTO STRICT claimed FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', reserved.intent_id,
    300, 'synthetic-one', NULL);
  FOREACH unsafe_reference IN ARRAY ARRAY['', repeat('x', 513), repeat(chr(233), 257)] LOOP
    PERFORM provisioning_test.expect_error(format(
      'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''accepted'',%L,''wallet-four'')',
      '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
      claimed.claim_token, unsafe_reference), '22023');
    PERFORM provisioning_test.expect_error(format(
      'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''accepted'',''customer-four'',%L)',
      '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
      claimed.claim_token, unsafe_reference), '22023');
  END LOOP;
  PERFORM provisioning_test.expect_error(format(
    'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''arbitrary provider message'',NULL,NULL)',
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
    claimed.claim_token), '22023');
  PERFORM provisioning_test.expect_error(format(
    'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''accepted'',''customer-four'',NULL)',
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
    claimed.claim_token), '22023');
  PERFORM provisioning_test.expect_error(format(
    'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''accepted'',''customer-one'',''wallet-four'')',
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
    claimed.claim_token), '23514');
  PERFORM provisioning_test.expect_error(format(
    'SELECT piggyvest_staging.record_provisioning_result(%L,%L,%L,%L,''accepted'',''customer-four'',''wallet-one'')',
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
    claimed.claim_token), '23514');
  PERFORM provisioning_test.assert_true((SELECT status = 'dispatched' AND provider_customer_id IS NULL
    AND provider_wallet_id IS NULL FROM piggyvest_staging.provisioning_intents WHERE id = claimed.intent_id),
    'invalid result never overwrites durable state or stores raw input');
  PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', claimed.intent_id,
    claimed.claim_token, 'accepted', repeat(chr(233), 256), repeat('x', 512)) = 'awaiting_confirmation',
    'opaque references accept exact byte boundary');
END $$;
ROLLBACK;

DO $$
DECLARE
  result_code text;
  reserved record;
  claimed record;
BEGIN
  FOREACH result_code IN ARRAY ARRAY['transport_error', 'rejected', 'ambiguous'] LOOP
    BEGIN
      SELECT intent_id INTO STRICT reserved FROM piggyvest_staging.prepare_provisioning_intent(
        '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000003', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'));
      SELECT intent_id, claim_token INTO STRICT claimed FROM piggyvest_staging.claim_provisioning_intent(
        '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', reserved.intent_id,
        300, 'synthetic-two', NULL);
      PERFORM provisioning_test.assert_true(piggyvest_staging.record_provisioning_result(
        '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', claimed.intent_id,
        claimed.claim_token, result_code, NULL, NULL) = 'unknown', 'non-acknowledgement stays unknown');
      PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
        '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', claimed.intent_id,
        300, 'synthetic-two', NULL)), 'non-acknowledgement never resends');
      RAISE SQLSTATE 'P7777';
    EXCEPTION WHEN SQLSTATE 'P7777' THEN NULL;
    END;
  END LOOP;
END $$;
