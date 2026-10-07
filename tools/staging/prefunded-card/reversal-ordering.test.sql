SELECT system_identifier::text AS system FROM pg_control_system() \gset
BEGIN;
SET SESSION AUTHORIZATION treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot('50000000-0000-4000-8000-000000000001','ordering',3,clock_timestamp(),80000);
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reversal_worker;
SELECT prefunded_card.claim_transfer(reversal_test.operation(7),0);
SELECT prefunded_card.record_transfer(reversal_test.operation(7),1,'unknown',NULL);
SELECT prefunded_card.claim_reconciliation(reversal_test.operation(7),60) AS lease \gset
SELECT prefunded_card.record_collection_reversal(:'system',reversal_test.event(7));
SELECT reversal_test.assert(prefunded_card.complete_reconciliation(reversal_test.operation(7),
  (:'lease'::jsonb->>'token')::uuid,(:'lease'::jsonb->>'fence')::bigint,'transfer','verified_success',reversal_test.transfer(7))='verified_success',
  'preexisting transfer verification lease can record settlement after reversal');
SELECT reversal_test.assert(prefunded_card.complete_reconciliation(reversal_test.operation(7),
  (:'lease'::jsonb->>'token')::uuid,(:'lease'::jsonb->>'fence')::bigint,'transfer','verified_success',reversal_test.transfer(7))='stale',
  'transfer verification lease never consumes the float twice');
RESET SESSION AUTHORIZATION;
SELECT reversal_test.assert((SELECT reserved_kobo=50000 AND consumed_kobo=30000 FROM prefunded_card.treasury_bindings),
  'verified settlement converts one reservation to consumption');
ROLLBACK;

BEGIN;
UPDATE prefunded_card.operations SET collection_status='unknown',collection_provider_transaction_id=NULL
  WHERE id=reversal_test.operation(7);
SET SESSION AUTHORIZATION reversal_worker;
SELECT prefunded_card.claim_reconciliation(reversal_test.operation(7),60) AS lease \gset
SELECT prefunded_card.record_collection_reversal(:'system',reversal_test.event(7));
SELECT reversal_test.assert(prefunded_card.complete_reconciliation(reversal_test.operation(7),
  (:'lease'::jsonb->>'token')::uuid,(:'lease'::jsonb->>'fence')::bigint,'collection','verified_failed',reversal_test.collection(7))='reconciliation_required',
  'preexisting collection verification lease cannot turn reversal into failure and release float');
RESET SESSION AUTHORIZATION;
SELECT reversal_test.assert((SELECT reserved_kobo=60000 AND consumed_kobo=20000 FROM prefunded_card.treasury_bindings),
  'stale collection reconciliation retains all unresolved reservations');
SELECT reversal_test.assert((SELECT collection_status='reversed' FROM prefunded_card.operations WHERE id=reversal_test.operation(7)),
  'stale collection reconciliation never restores reversed state');
ROLLBACK;
