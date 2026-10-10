SELECT system_identifier::text AS system FROM pg_control_system() \gset
SET SESSION AUTHORIZATION reversal_worker;
SELECT reversal_test.assert(
  prefunded_card.record_collection_reversal(:'system',reversal_test.event(1))->>'exposure'='transfer_not_started',
  'reversal before transfer records scoped obligation'
);
SELECT reversal_test.assert(
  prefunded_card.claim_transfer(reversal_test.operation(1),0)->>'outcome'='stale_or_reconciliation_required',
  'reversal before transfer prevents new dispatch'
);
SELECT reversal_test.assert(
  prefunded_card.record_collection(reversal_test.operation(1),1,'verified_failed',reversal_test.collection(1))='stale',
  'late collection failure cannot release held float'
);
SELECT reversal_test.assert(
  prefunded_card.record_collection_reversal(:'system',reversal_test.event(1))->>'outcome'='duplicate',
  'exact delivery replay is idempotent'
);
SELECT prefunded_card.record_collection_reversal(:'system',reversal_test.event(1)||'{"eventId":"second-delivery-1"}');
RESET SESSION AUTHORIZATION;
SELECT reversal_test.assert((SELECT reserved_kobo=80000 AND consumed_kobo=0 FROM prefunded_card.treasury_bindings),
  'reversal and duplicates retain reservation without refund or float release');
SELECT reversal_test.assert((SELECT count(*)=1 FROM prefunded_card.collection_reversal_obligations),
  'different delivery keys create only one durable obligation per operation');

SET SESSION AUTHORIZATION reversal_worker;
SELECT prefunded_card.claim_transfer(reversal_test.operation(2),0);
SELECT prefunded_card.record_transfer(reversal_test.operation(2),1,'verified_success',reversal_test.transfer(2));
SELECT prefunded_card.project(reversal_test.operation(2),:'system');
SELECT reversal_test.assert(
  prefunded_card.record_collection_reversal(:'system',reversal_test.event(2))->>'exposure'='transfer_completed',
  'reversal after completed transfer records exposure instead of deducting savings'
);
SELECT reversal_test.assert(prefunded_card.project(reversal_test.operation(2),:'system')='deferred',
  'reversed collection cannot create another projection');
RESET SESSION AUTHORIZATION;
SELECT reversal_test.assert((SELECT current_amount=100 FROM public.customer_savings_goals),
  'already credited savings survive collection reversal');
SELECT reversal_test.assert((SELECT count(*)=1 AND sum(amount)=100 FROM public.customer_savings_contributions),
  'historical completed contribution remains intact');
SELECT reversal_test.assert((SELECT sum(amount_kobo)=10000 FROM piggyvest_savings_ledger.postings WHERE account='principal'),
  'canonical principal is not silently deducted');
SELECT reversal_test.assert((SELECT reserved_kobo=70000 AND consumed_kobo=10000 FROM prefunded_card.treasury_bindings),
  'completed transfer consumption is never replenished by reversal');
SET SESSION AUTHORIZATION treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot('50000000-0000-4000-8000-000000000001','after-transfer-2',2,clock_timestamp(),90000);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION reversal_worker;
SELECT prefunded_card.claim_transfer(reversal_test.operation(3),0);
SELECT reversal_test.assert(
  prefunded_card.record_collection_reversal(:'system',reversal_test.event(3))->>'exposure'='transfer_in_flight',
  'dispatch winning the race leaves explicit transfer exposure'
);
SELECT reversal_test.assert(
  prefunded_card.record_transfer(reversal_test.operation(3),1,'verified_success',reversal_test.transfer(3))='verified_success',
  'provider transfer may still settle after collection reversal'
);
SELECT reversal_test.assert(
  prefunded_card.record_transfer(reversal_test.operation(3),1,'verified_success',reversal_test.transfer(3))='stale',
  'late transfer success consumes float at most once'
);
SELECT reversal_test.assert(prefunded_card.project(reversal_test.operation(3),:'system')='deferred',
  'post-reversal transfer settlement does not mint a savings contribution');
SELECT prefunded_card.record_collection_reversal(:'system',reversal_test.event(8));
SELECT reversal_test.assert(
  prefunded_card.record_collection(reversal_test.operation(8),1,'verified_success',reversal_test.collection(8))='stale',
  'reversal preceding collection success cannot be overwritten by the old claim'
);
RESET SESSION AUTHORIZATION;
SELECT reversal_test.assert((SELECT reserved_kobo=60000 AND consumed_kobo=20000 FROM prefunded_card.treasury_bindings),
  'in-flight success consumes only the existing reservation');
SELECT reversal_test.assert((SELECT collection_status='reversed' AND transfer_status='verified_success'
  AND projection_status='reconciliation_required' FROM prefunded_card.operations WHERE id=reversal_test.operation(3)),
  'post-reversal settlement remains explicitly unresolved');
