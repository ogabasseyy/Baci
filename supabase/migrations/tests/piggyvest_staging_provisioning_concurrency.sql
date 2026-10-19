\set ON_ERROR_STOP on
SET statement_timeout = '2s';
SELECT provisioning_test.assert_true(NOT EXISTS (
  SELECT 1 FROM piggyvest_staging.claim_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    (SELECT id FROM piggyvest_staging.provisioning_intents WHERE customer_id = '20000000-0000-4000-8000-000000000004'),
    300, 'synthetic-one', NULL)), 'second session cannot claim first dispatch');
