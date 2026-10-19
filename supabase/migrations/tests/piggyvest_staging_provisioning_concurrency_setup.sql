\set ON_ERROR_STOP on
SELECT provisioning_test.assert_true((SELECT outcome = 'accepted' FROM piggyvest_staging.prepare_provisioning_intent(
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000004', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'))), 'prepare committed before concurrent claims');
