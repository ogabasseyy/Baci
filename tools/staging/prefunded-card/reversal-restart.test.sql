SELECT system_identifier::text AS system FROM pg_control_system() \gset
SET SESSION AUTHORIZATION reversal_worker;
SELECT reversal_test.assert(
  prefunded_card.record_collection_reversal(:'system',reversal_test.event(1))->>'outcome'='duplicate',
  'lost acknowledgement followed by restart is an exact replay'
);
SELECT reversal_test.assert(
  prefunded_card.read_reversal_context(reversal_test.operation(3),:'system')->>'collectionTransactionId'='3',
  'reversed collection identity remains durable after restart'
);
SELECT reversal_test.assert(
  prefunded_card.record_collection(reversal_test.operation(8),1,'verified_failed',reversal_test.collection(8))='stale',
  'old collection failure remains fenced after restart'
);
RESET SESSION AUTHORIZATION;
SELECT reversal_test.assert((SELECT reserved_kobo=60000 AND consumed_kobo=20000 FROM prefunded_card.treasury_bindings),
  'restart and replay preserve treasury budget');
SELECT reversal_test.assert((SELECT count(*)=4 FROM prefunded_card.collection_reversal_obligations),
  'reconciliation obligations survive restart');
