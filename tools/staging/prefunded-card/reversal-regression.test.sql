BEGIN;
UPDATE prefunded_card.operations SET collection_status='reversed' WHERE id=reversal_test.operation(1);
SELECT reversal_test.denied(
  $$UPDATE prefunded_card.operations SET collection_status='verified_success' WHERE id=reversal_test.operation(1)$$,
  'late success must never restore reversed collection dispatch eligibility'
);
ROLLBACK;
