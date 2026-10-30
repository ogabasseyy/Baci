INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
VALUES(pg_temp.goal_id(47),'10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','primary_interest_fixture',true);
UPDATE piggyvest_primary.paid_interest_crosswalks SET enabled=true WHERE id=pg_temp.goal_id(47);
SET SESSION AUTHORIZATION production_primary_interest_fixture;
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(47))='prerequisite',
  'Existing legacy source prevents new production attribution even when the crosswalk is enabled');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(47,pg_temp.command(502,'credit_eligible_paid_interest',3000));
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id,payout_id,crosswalk_id,goal_id,merchant_id,customer_id,
  net_kobo,financial_identity,body_digest)
VALUES('00000000-0000-4000-8000-000000000005','legacy-transition-proof-47',pg_temp.goal_id(47),pg_temp.goal_id(47),
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',0,
  '{"source":"legacy-transition-test"}',repeat('a',64));
SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(47,pg_temp.command(503,'reverse_credit',0,pg_temp.goal_id(502)));
DO $$ BEGIN
  BEGIN
    PERFORM pg_temp.apply_interest(47,pg_temp.command(504,'credit_eligible_paid_interest',100));
    RAISE EXCEPTION 'Post-transition legacy credit accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM piggyvest_savings_ledger.operations WHERE id=pg_temp.goal_id(503)),
  'Reversal of pre-transition legacy interest is recorded after the source transition');
SELECT pg_temp.assert_true((SELECT coalesce(sum(posting.amount_kobo),0)=0 FROM piggyvest_savings_ledger.postings posting
  JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
  WHERE operation.goal_id=pg_temp.goal_id(47) AND posting.account='paid_interest'),
  'Reversed pre-transition interest no longer inflates the legacy earnings balance');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations WHERE id=pg_temp.goal_id(504)),
  'Post-transition legacy credit rolls back atomically while reversals stay permitted');

SET SESSION AUTHORIZATION production_primary_interest_fixture;
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(48)||'{"netKobo":1000,"grossKobo":1053,"taxKobo":53,"amountKobo":1000}')='credited',
  'Partial net payout is credited before target completion');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION production_primary_authorizer_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.reserve_savings(pg_temp.production_scope(),jsonb_build_object(
  'goalId',pg_temp.goal_id(48),'operationId',pg_temp.goal_id(402),'amountKobo',2001))->>'status'='insufficient',
  'One kobo beyond remaining primary capacity is rejected after partial paid interest');
SELECT pg_temp.assert_true(piggyvest_primary.reserve_savings(pg_temp.production_scope(),jsonb_build_object(
  'goalId',pg_temp.goal_id(48),'operationId',pg_temp.goal_id(402),'amountKobo',2000))->>'status'='claimed',
  'Exactly remaining funded capacity can be reserved under the same goal lock');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  BEGIN
    UPDATE piggyvest_primary.paid_interest_receipts SET net_kobo=1;
    RAISE EXCEPTION 'Financial receipt changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE piggyvest_primary.paid_interest_crosswalks SET api_customer_id='foreign';
    RAISE EXCEPTION 'Provider crosswalk changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT pg_temp.assert_true(NOT has_table_privilege('production_primary_interest_fixture','piggyvest_primary.paid_interest_reversals','INSERT'),
  'No worker can manufacture reversal evidence before a provider reversal contract exists');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','piggyvest_primary.paid_interest_receipts','SELECT'),
  'Customer earnings reads do not expose provider financial evidence');
INSERT INTO piggyvest_primary.paid_interest_reversals(integration_id,provider_reversal_id,payout_id,amount_kobo,provider_evidence_sha256,evidence_reference)
VALUES('00000000-0000-4000-8000-000000000005','synthetic-owner-reversal','production-payout',3000,
  repeat('f',64),'synthetic-provider-proof-only-no-runtime-reversal-handler');
SELECT pg_temp.assert_true((SELECT recorded_at IS NOT NULL FROM piggyvest_primary.paid_interest_reversals
  WHERE provider_reversal_id='synthetic-owner-reversal'),
  'New reversal records when it was observed without claiming provider event time');
SELECT pg_temp.assert_true((public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001')->'interest_history')
  @> jsonb_build_array(jsonb_build_object('id','primary-reversal:00000000-0000-4000-8000-000000000005:synthetic-owner-reversal',
    'date_basis','observed')),
  'New reversal history labels recorded_at as an observation time');
UPDATE piggyvest_primary.integrations SET environment='staging' WHERE id='00000000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
  public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001')->'interest_history') item
  WHERE item->>'id' LIKE 'primary:%'),
  'Receipts recorded under a staging integration are excluded from customer production history');
UPDATE piggyvest_primary.integrations SET environment='production' WHERE id='00000000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_true((SELECT current_amount=100 AND status='paused' FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(45)),
  'Verified reversal removes net funded interest without changing principal or terminal policy');
SELECT pg_temp.assert_true((SELECT bool_and(voided_at IS NOT NULL) FROM savings_notifications.events
  WHERE goal_id=pg_temp.goal_id(45) AND type IN ('interest_credited','goal_completed')),'Reversed savings interest and completion notices are no longer deliverable');
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001',true)->'goal_interest_kobo')
  @> jsonb_build_array(jsonb_build_object('goal_id',pg_temp.goal_id(45),'credited_interest_kobo',0)),
  'Authenticated earnings projection subtracts verified reversal');
ALTER TABLE piggyvest_primary.paid_interest_reversals DISABLE TRIGGER primary_interest_reversal_immutable;
UPDATE piggyvest_primary.paid_interest_reversals SET recorded_at=NULL WHERE provider_reversal_id='synthetic-owner-reversal';
ALTER TABLE piggyvest_primary.paid_interest_reversals ENABLE TRIGGER primary_interest_reversal_immutable;
CREATE TEMP TABLE earnings_before_integration_disable AS
  SELECT public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo' AS amount;
UPDATE piggyvest_primary.integrations SET enabled=false WHERE id='00000000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric=
  (SELECT amount::numeric FROM earnings_before_integration_disable),
  'Existing earnings projection retains recorded paid interest after integration disablement');
SELECT pg_temp.assert_true((public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001')->'interest_history')
  @> jsonb_build_array(jsonb_build_object('id','primary-reversal:00000000-0000-4000-8000-000000000005:synthetic-owner-reversal',
    'goal_id',pg_temp.goal_id(45),'amount',-30,'type','adjustment','source_type','savings_interest','date_basis','unknown','created_at',NULL)),
  'Disabled integration does not hide history, and the historical reversal has an honestly unknown timestamp');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
  public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001')->'interest_history') item
  WHERE item->>'id' IN ('legacy:'||pg_temp.goal_id(502)::text,'legacy:'||pg_temp.goal_id(503)::text)),
  'Staging-bound legacy ledger credits and reversals are not published as production paid-interest history');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM jsonb_array_elements(
  public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001')->'interest_history') item
  WHERE item->>'goal_id'=pg_temp.goal_id(45)::text AND item->>'type'='credit' AND item->>'id' LIKE 'primary:%')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
    public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001')->'interest_history') item
    WHERE item->>'goal_id'=pg_temp.goal_id(45)::text AND item->>'id' LIKE 'legacy:%'),
  'Exclusive primary source yields one credited activity and no duplicate legacy income');
UPDATE piggyvest_primary.integrations SET enabled=true WHERE id='00000000-0000-4000-8000-000000000005';
