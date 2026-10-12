CREATE SCHEMA prefunded_card_test;
CREATE FUNCTION prefunded_card_test.assert(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF; END $$;
CREATE FUNCTION prefunded_card_test.command3() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('operationId','70000000-0000-4000-8000-000000000003','integrationId','40000000-0000-4000-8000-000000000001',
  'merchantId','10000000-0000-4000-8000-000000000001','customerId','20000000-0000-4000-8000-000000000001',
  'goalId','30000000-0000-4000-8000-000000000002','treasuryBindingId','50000000-0000-4000-8000-000000000001',
  'requestFingerprint','3456789012345678','idempotencyKey','cdefghijklmnopqr','savedMethodId','60000000-0000-4000-8000-000000000001',
  'amountKobo',10000,'feeAllowanceKobo',0,'currency','NGN','collectionReference','collection-3','transferReference','transfer-3',
  'destinationWalletId','destination-wallet-2','destinationCustomerId','destination-customer-2');
$$;

SELECT prefunded_card.reserve(jsonb_build_object(
  'operationId','70000000-0000-4000-8000-000000000001','integrationId','40000000-0000-4000-8000-000000000001',
  'merchantId','10000000-0000-4000-8000-000000000001','customerId','20000000-0000-4000-8000-000000000001',
  'goalId','30000000-0000-4000-8000-000000000001','treasuryBindingId','50000000-0000-4000-8000-000000000001',
  'requestFingerprint','1234567890123456','idempotencyKey','abcdefghijklmnop','savedMethodId','60000000-0000-4000-8000-000000000001',
  'amountKobo',10000,'feeAllowanceKobo',0,'currency','NGN','collectionReference','collection-1','transferReference','transfer-1',
  'destinationWalletId','destination-wallet','destinationCustomerId','destination-customer')) AS first_reservation;
SELECT prefunded_card_test.assert((SELECT reserved_kobo=10000 FROM prefunded_card.treasury_bindings),'serialized float reservation');
SELECT prefunded_card_test.assert((prefunded_card.claim_collection('70000000-0000-4000-8000-000000000001',0)->>'outcome')='claimed','collection claimed once');
SELECT prefunded_card_test.assert(prefunded_card.record_collection('70000000-0000-4000-8000-000000000001',1,'unknown',NULL)='unknown','lost response becomes unknown');
SELECT prefunded_card_test.assert((prefunded_card.claim_collection('70000000-0000-4000-8000-000000000001',1)->>'outcome')='stale_or_reconciliation_required','lease/fence never resends unknown');
SELECT prefunded_card_test.assert((SELECT reserved_kobo=10000 FROM prefunded_card.treasury_bindings),'unknown retains float reservation');

SELECT prefunded_card.reserve(jsonb_build_object(
  'operationId','70000000-0000-4000-8000-000000000002','integrationId','40000000-0000-4000-8000-000000000001',
  'merchantId','10000000-0000-4000-8000-000000000001','customerId','20000000-0000-4000-8000-000000000001',
  'goalId','30000000-0000-4000-8000-000000000002','treasuryBindingId','50000000-0000-4000-8000-000000000001',
  'requestFingerprint','2345678901234567','idempotencyKey','bcdefghijklmnopq','savedMethodId','60000000-0000-4000-8000-000000000001',
  'amountKobo',10000,'feeAllowanceKobo',0,'currency','NGN','collectionReference','collection-2','transferReference','transfer-2',
  'destinationWalletId','destination-wallet-2','destinationCustomerId','destination-customer-2'));
SELECT prefunded_card_test.assert((prefunded_card.claim_collection('70000000-0000-4000-8000-000000000002',0)->>'outcome')='claimed','second collection claimed');
SELECT prefunded_card_test.assert(prefunded_card.record_collection('70000000-0000-4000-8000-000000000002',1,'verified_success',jsonb_build_object('reference','collection-2','amountKobo',10000,'currency','NGN','savedMethodId','60000000-0000-4000-8000-000000000001','providerTransactionId','charge-2'))='verified_success','full collection identity verified');
SELECT prefunded_card_test.assert((prefunded_card.claim_transfer('70000000-0000-4000-8000-000000000002',0)->>'outcome')='claimed','transfer claimed after collection');
SELECT prefunded_card_test.assert(prefunded_card.record_transfer('70000000-0000-4000-8000-000000000002',1,'verified_success',jsonb_build_object('reference','transfer-2','businessId','wrong-business','sourceWalletId','source-wallet','destinationWalletId','destination-wallet-2','destinationCustomerId','destination-customer-2','amountKobo',10000,'currency','NGN','providerTransactionId','transfer-provider-2'))='reconciliation_required','wrong scoped business quarantines transfer');
SELECT prefunded_card_test.assert((SELECT reserved_kobo=20000 AND consumed_kobo=0 FROM prefunded_card.treasury_bindings),'wrong scope cannot consume budget');
