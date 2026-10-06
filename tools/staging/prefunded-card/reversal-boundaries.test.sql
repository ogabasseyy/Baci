SELECT system_identifier::text AS system FROM pg_control_system() \gset
SET SESSION AUTHORIZATION reversal_worker;
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(1)||'{"collectionAmountKobo":9999}'),'mismatched amount is denied');
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(1)||'{"collectionTransactionId":"999"}'),'mismatched provider transaction is denied');
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(4)||'{"eventId":"delivery-1"}'),'same event cannot reverse another operation');
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(4)||'{"merchantId":"11111111-1111-4111-8111-111111111112"}'),'cross merchant evidence is denied');
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(4)||'{"customerId":"22222222-2222-4222-8222-222222222223"}'),'cross customer evidence is denied');
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(4)||'{"domain":"live"}'),'live evidence is denied');
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(4)||'{"collectionAmountKobo":null}'),'null amount is denied');
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(4)||'{"collectionAmountKobo":9007199254740992}'),'unsafe amount is denied');
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)','1',
  reversal_test.event(4)),'wrong physical database pin is denied');
SELECT reversal_test.denied('SELECT * FROM prefunded_card.collection_reversal_events','worker has no raw table read');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION other_worker;
SELECT reversal_test.denied(format('SELECT prefunded_card.record_collection_reversal(%L,%L::jsonb)',:'system',
  reversal_test.event(4)),'other login cannot attest a reversal even with execute grants');
RESET SESSION AUTHORIZATION;
SELECT reversal_test.denied('DELETE FROM prefunded_card.collection_reversal_events','events cannot be deleted');
SELECT reversal_test.denied('TRUNCATE prefunded_card.collection_reversal_events CASCADE','events cannot be truncated');
SELECT reversal_test.denied('UPDATE prefunded_card.collection_reversal_obligations SET obligation=''review_required''',
  'obligations cannot be rewritten');
SELECT reversal_test.denied('TRUNCATE prefunded_card.collection_reversal_obligations','obligations cannot be truncated');
SELECT reversal_test.assert((SELECT count(*)=5 FROM prefunded_card.collection_reversal_events),
  'rejected evidence never mutates durable events');
SELECT reversal_test.assert((SELECT count(*)=4 FROM prefunded_card.collection_reversal_obligations),
  'one obligation per reversed collection');
