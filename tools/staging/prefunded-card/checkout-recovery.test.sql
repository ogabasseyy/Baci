BEGIN;

CREATE SCHEMA IF NOT EXISTS prefunded_first_card_recovery_test;
CREATE OR REPLACE FUNCTION prefunded_first_card_recovery_test.assert(p_condition boolean,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%',p_message; END IF;
END $$;

CREATE OR REPLACE FUNCTION prefunded_first_card_recovery_test.assert_denied(p_statement text,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_statement;
  RAISE EXCEPTION '%',p_message;
EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '22023' THEN NULL;
END $$;

SELECT prefunded_first_card_recovery_test.assert(
  has_function_privilege('prefunded_authorizer','prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)','EXECUTE')
  AND NOT has_function_privilege('prefunded_treasury_operator','prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)','EXECUTE')
  AND NOT has_function_privilege('service_role','prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)','EXECUTE')
  AND NOT has_table_privilege('prefunded_authorizer','prefunded_card.checkout_intents','SELECT'),
  'first-card recovery reader is not authorizer-only'
);

SET SESSION AUTHORIZATION prefunded_authorizer;

SELECT prefunded_first_card_recovery_test.assert(
  (prefunded_card.checkout_recovery_candidates(
    prefunded_first_card_recovery_test.scope(),NULL,2)->'candidates')::jsonb
    = jsonb_build_array(
      prefunded_first_card_recovery_test.candidate('80000000-0000-4000-8000-000000000001'),
      prefunded_first_card_recovery_test.candidate('80000000-0000-4000-8000-000000000002')
    ),
  'first-card recovery did not return the first bounded unresolved page'
);

SELECT prefunded_first_card_recovery_test.assert(
  prefunded_card.checkout_recovery_candidates(
    prefunded_first_card_recovery_test.scope(),
    prefunded_first_card_recovery_test.cursor('80000000-0000-4000-8000-000000000002'),2
  )->'candidates' = jsonb_build_array(
    prefunded_first_card_recovery_test.candidate('80000000-0000-4000-8000-000000000003'),
    prefunded_first_card_recovery_test.candidate('80000000-0000-4000-8000-000000000001')
  ),
  'first-card recovery did not wrap its durable keyset cursor'
);

SELECT prefunded_first_card_recovery_test.assert(
  prefunded_card.checkout_recovery_candidates(
    prefunded_first_card_recovery_test.scope(),NULL,2
  )->'nextCursor' = prefunded_first_card_recovery_test.cursor('80000000-0000-4000-8000-000000000002'),
  'first-card recovery did not persist the last returned cursor'
);

SELECT prefunded_first_card_recovery_test.assert_denied(
  $sql$SELECT prefunded_card.checkout_recovery_candidates(
    jsonb_set(prefunded_first_card_recovery_test.scope(),'{systemIdentifier}','"1"'::jsonb),NULL,1)$sql$,
  'first-card recovery accepted a different physical database system identifier'
);
SELECT prefunded_first_card_recovery_test.assert_denied(
  $sql$SELECT prefunded_card.checkout_recovery_candidates(
    prefunded_first_card_recovery_test.scope(),jsonb_build_object('createdAt','2026-09-26T12:00:00.000Z','intentId','not-a-uuid'),1)$sql$,
  'first-card recovery accepted an invalid cursor'
);
SELECT prefunded_first_card_recovery_test.assert(
  pg_get_functiondef('prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)'::regprocedure)
    !~* '\\m(INSERT|UPDATE|DELETE|MERGE)\\M',
  'first-card recovery reader contains a mutation statement'
);

RESET SESSION AUTHORIZATION;
UPDATE prefunded_card.checkout_intents SET created_at='2026-09-26T12:00:00.000123Z'
  WHERE id IN ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000003');
SET SESSION AUTHORIZATION prefunded_authorizer;
SELECT prefunded_first_card_recovery_test.assert(
  prefunded_card.checkout_recovery_candidates(
    prefunded_first_card_recovery_test.scope(),
    prefunded_first_card_recovery_test.cursor('80000000-0000-4000-8000-000000000002'),2
  )->'candidates' = jsonb_build_array(
    prefunded_first_card_recovery_test.candidate('80000000-0000-4000-8000-000000000003'),
    prefunded_first_card_recovery_test.candidate('80000000-0000-4000-8000-000000000001')
  ),
  'sub-millisecond timestamps must not repeatedly return the first page'
);

ROLLBACK;
