\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
ALTER TABLE public.customer_savings_goals ADD COLUMN completed_at timestamptz;
ALTER TABLE public.customer_savings_goals ADD COLUMN goal_kind text NOT NULL DEFAULT 'legacy';
CREATE TABLE public.customer_savings_contributions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),goal_id uuid,merchant_id uuid,customer_id uuid,
  wallet_transaction_id uuid,amount numeric,source_type text,status text,processed_at timestamptz,
  idempotency_key text UNIQUE,metadata jsonb DEFAULT '{}'
);
\ir ../../../../../supabase/migrations/20261007150000_piggyvest_primary_savings_settlement.sql
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,expected_provider_account_id text UNIQUE,enabled boolean);
\ir ../../../../../supabase/migrations/20260912120000_piggyvest_savings_ledger_tables.sql
\ir ../../../../../supabase/migrations/20260912120100_piggyvest_savings_ledger_guards.sql
\ir ../../../../../supabase/migrations/20260912120200_piggyvest_savings_ledger_apply.sql
\ir ../../../../../supabase/migrations/20260912120300_piggyvest_savings_ledger_snapshot.sql
\ir ../../../../../supabase/migrations/20260912120400_piggyvest_savings_ledger_registry_gate.sql
\ir ../../../../../supabase/migrations/20260912120500_piggyvest_savings_ledger_numeric_reference_casts.sql
\ir ../../../../../supabase/migrations/tests/fixtures/legacy-interest-capacity-drafts/20261004200000_customer_savings_paid_interest_completion.sql

CREATE ROLE primary_interest_fixture LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO primary_interest_fixture;
GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) TO primary_interest_fixture;
INSERT INTO piggyvest_staging.integrations VALUES
  ('10000000-0000-4000-8000-000000000001','fixture-business',true),
  ('10000000-0000-4000-8000-000000000002','foreign-business',true);

CREATE FUNCTION pg_temp.assert_true(condition boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.goal_id(number integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('20000000-0000-4000-8000-'||lpad(number::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.command(number integer,kind text,amount bigint,reference uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('operationId',pg_temp.goal_id(number),'kind',kind,'principalKobo',0,
    'interestKobo',amount,'evidenceId','primary-interest-fixture:'||number,'referenceId',reference);
$$;
CREATE FUNCTION pg_temp.apply_interest(goal_number integer,command jsonb,integration uuid DEFAULT '10000000-0000-4000-8000-000000000001')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_savings_ledger.apply(integration,'00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',pg_temp.goal_id(goal_number),command);
$$;
CREATE FUNCTION pg_temp.primary_scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}'::jsonb;
$$;
CREATE FUNCTION pg_temp.proof(operation_number integer,goal_number integer,amount bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('operationId',pg_temp.goal_id(operation_number),'providerTransactionId','confirmed-'||operation_number,
    'reference','pvb-save-'||pg_temp.goal_id(operation_number),'amountKobo',amount,'sourceWalletId','wallet',
    'destinationWalletId','interest-goal-'||goal_number,'businessId','fixture-business');
$$;

INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount)
SELECT pg_temp.goal_id(number),'00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','active',130,100 FROM generate_series(11,19) number;
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
SELECT intent.integration_id,pg_temp.goal_id(number),intent.id,'interest-goal-'||number,true
FROM piggyvest_primary.onboarding_intents intent CROSS JOIN generate_series(11,18) number;
INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
SELECT pg_temp.goal_id(number),CASE WHEN number=15 THEN '10000000-0000-4000-8000-000000000002'::uuid
  ELSE '10000000-0000-4000-8000-000000000001'::uuid END,
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','primary_interest_fixture',true
FROM generate_series(11,19) number;
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount)
VALUES(pg_temp.goal_id(20),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',130,130);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
SELECT integration_id,pg_temp.goal_id(20),id,'backfill-principal-goal',true FROM piggyvest_primary.onboarding_intents;

\if :{?without_primary_completion}
\else
\ir ../../../../../supabase/migrations/20261007181000_piggyvest_primary_paid_interest_completion.sql
\endif
\if :{?without_primary_capacity}
ALTER FUNCTION piggyvest_primary.reserve_savings(jsonb,jsonb) RENAME TO reserve_savings_capacity_wrapper_unused;
ALTER FUNCTION piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb) RENAME TO reserve_savings;
GRANT EXECUTE ON FUNCTION piggyvest_primary.reserve_savings(jsonb,jsonb) TO piggyvest_primary_authorizer;
\endif

UPDATE public.customer_savings_goals SET target_amount=20 WHERE id='00000000-0000-4000-8000-000000000006';
SET SESSION AUTHORIZATION primary_evidence_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',
  '{"operationId":"00000000-0000-4000-8000-000000000008","providerTransactionId":"principal-only-proof","reference":"pvb-save-00000000-0000-4000-8000-000000000008","amountKobo":2000,"sourceWalletId":"wallet","destinationWalletId":"destination","businessId":"fixture-business"}')='confirmed',
  'Verified principal-only settlement succeeds');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT status='completed' AND completed_at IS NOT NULL AND current_amount=20
  FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-000000000006'),
  'Regression: PRIMARY principal-only provider settlement must complete the goal');
SELECT pg_temp.assert_true((SELECT status='completed' AND completed_at IS NOT NULL AND current_amount=130
  FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(20)),
  'Migration backfills funded PRIMARY principal-only goal without adding principal');

SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(11,pg_temp.command(101,'credit_eligible_paid_interest',700));
SELECT pg_temp.apply_interest(13,pg_temp.command(103,'record_pending_interest',50000));
SELECT pg_temp.apply_interest(15,pg_temp.command(105,'credit_eligible_paid_interest',3000),'10000000-0000-4000-8000-000000000002');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT status='active' AND current_amount=100 FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(13)),
  'Daily accrual never completes the goal');
SELECT pg_temp.assert_true((SELECT status='active' AND current_amount=100 FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(15)),
  'Foreign-business ledger binding cannot complete PRIMARY goal');
SELECT pg_temp.assert_true((SELECT paid_interest_kobo=700 FROM piggyvest_primary.completion_totals(
  pg_temp.goal_id(11),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),
  'Authoritative interest is scoped by goal and business, not merchant aggregate');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM piggyvest_primary.completion_totals(pg_temp.goal_id(11),
  '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002')),
  'Foreign merchant cannot resolve completion totals');
UPDATE piggyvest_primary.integrations SET environment='production';
SELECT pg_temp.assert_true((SELECT paid_interest_kobo=0 FROM piggyvest_primary.completion_totals(
  pg_temp.goal_id(11),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),
  'A staging ledger binding never authorizes production interest attribution');
UPDATE piggyvest_primary.integrations SET environment='staging';

CREATE TEMP TABLE cash_before_reservation AS SELECT available_balance FROM public.customer_wallets;
SET SESSION AUTHORIZATION primary_authorizer_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.reserve_savings(pg_temp.primary_scope(),jsonb_build_object(
  'goalId',pg_temp.goal_id(11),'operationId',pg_temp.goal_id(203),'amountKobo',2301))->>'status'='insufficient',
  'Regression: partial paid interest rejects a primary reservation one kobo above actual remaining target');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT wallet.available_balance=saved.available_balance
  FROM public.customer_wallets wallet CROSS JOIN cash_before_reservation saved),
  'Rejected near-target reservation rolls back the wallet hold');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM piggyvest_primary.savings_operations WHERE id=pg_temp.goal_id(203))
  AND NOT EXISTS(SELECT 1 FROM public.customer_wallet_transactions WHERE source_id=pg_temp.goal_id(203))
  AND NOT EXISTS(SELECT 1 FROM piggyvest_primary.savings_completion_reviews WHERE goal_id=pg_temp.goal_id(11)),
  'Rejected reservation leaves no operation, wallet transaction or spurious overshoot review');
SET SESSION AUTHORIZATION primary_authorizer_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.reserve_savings(pg_temp.primary_scope(),jsonb_build_object(
  'goalId',pg_temp.goal_id(11),'operationId',pg_temp.goal_id(201),'amountKobo',2300))->>'status'='claimed','Exact remaining principal reserved');
SELECT pg_temp.assert_true(piggyvest_primary.manage_savings(pg_temp.primary_scope(),pg_temp.goal_id(201),'dispatch'),'Transfer dispatched');
SELECT pg_temp.assert_true(piggyvest_primary.reserve_savings(pg_temp.primary_scope(),jsonb_build_object(
  'goalId',pg_temp.goal_id(11),'operationId',pg_temp.goal_id(201),'amountKobo',2300))->>'status'='pending',
  'Exact remaining reservation replay does not debit or dispatch twice');
SELECT pg_temp.assert_true(piggyvest_primary.reserve_savings(pg_temp.primary_scope(),jsonb_build_object(
  'goalId',pg_temp.goal_id(12),'operationId',pg_temp.goal_id(202),'amountKobo',3000))->>'status'='claimed','Pre-payout transfer reserved');
SELECT pg_temp.assert_true(piggyvest_primary.manage_savings(pg_temp.primary_scope(),pg_temp.goal_id(202),'dispatch'),'Pre-payout transfer dispatched');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT status='active' AND current_amount=100 FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(11)),
  'Accepted/dispatched transfer never counted as funded principal');
SET SESSION AUTHORIZATION primary_evidence_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',pg_temp.proof(201,11,2300))='confirmed',
  'Exact principal settlement after partial net payout succeeds');
SELECT pg_temp.assert_true(piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',pg_temp.proof(201,11,2300))='duplicate',
  'Repeated provider proof never duplicates principal');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT current_amount=123 AND status='completed' AND completed_at IS NOT NULL
  FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(11)),'Principal 123 plus paid interest 7 completes target 130');

CREATE TEMP TABLE cash_before_payout AS SELECT available_balance,total_earned FROM public.customer_wallets;
SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(12,pg_temp.command(102,'credit_eligible_paid_interest',3000));
RESET SESSION AUTHORIZATION;
CREATE TEMP TABLE completion_before_replay AS SELECT completed_at FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(12);
SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(12,pg_temp.command(102,'credit_eligible_paid_interest',3000));
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT current_amount=100 AND status='completed' AND completed_at IS NOT NULL
  FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(12)),'Payout-only completion preserves principal');
SELECT pg_temp.assert_true((SELECT goal.completed_at=saved.completed_at FROM public.customer_savings_goals goal
  CROSS JOIN completion_before_replay saved WHERE goal.id=pg_temp.goal_id(12)),'Redelivery preserves completion time');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM piggyvest_savings_ledger.operations WHERE id=pg_temp.goal_id(102)),
  'Redelivery preserves one authoritative operation');
SELECT pg_temp.assert_true((SELECT state='open' AND overshoot_kobo=3000 AND pending_operation_ids=ARRAY[pg_temp.goal_id(202)]
  FROM piggyvest_primary.savings_completion_reviews WHERE goal_id=pg_temp.goal_id(12)),
  'Concurrent dispatched overshoot has a durable exact-operation review flag');
SELECT pg_temp.assert_true((SELECT state='dispatched' AND provider_transaction_id IS NULL
  FROM piggyvest_primary.savings_operations WHERE id=pg_temp.goal_id(202)),
  'Interest receipt does not discard, settle or refund the dispatched transfer');
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$ BEGIN
  BEGIN
    PERFORM piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','production',pg_temp.proof(202,12,3000));
    RAISE EXCEPTION 'Wrong environment accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.assert_true(piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',pg_temp.proof(202,12,3000))='conflict',
  'Verified excess transfer is retained for review instead of losing provider proof');
SELECT pg_temp.assert_true(piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',pg_temp.proof(202,12,3000))='conflict',
  'Repeated excess proof stays pending without duplicate principal');
SELECT pg_temp.assert_true(piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',
  jsonb_set(pg_temp.proof(202,12,3000),'{amountKobo}','2999'))='conflict','Wrong-amount proof cannot replace retained evidence');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(proof=pg_temp.proof(202,12,3000))
  FROM piggyvest_primary.savings_completion_evidence WHERE operation_id=pg_temp.goal_id(202)),
  'Exact original verified proof is durable and idempotent');
SELECT pg_temp.assert_true((SELECT current_amount=100 AND status='completed'
  FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(12)),
  'Excess-transfer review does not invent principal allocation');
SELECT pg_temp.assert_true((SELECT wallet.available_balance=saved.available_balance AND wallet.total_earned=saved.total_earned
  FROM public.customer_wallets wallet CROSS JOIN cash_before_payout saved),'Interest completion never credits ordinary wallet cash');
SET SESSION AUTHORIZATION primary_authorizer_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.reserve_savings(pg_temp.primary_scope(),jsonb_build_object(
  'goalId',pg_temp.goal_id(12),'operationId',pg_temp.goal_id(202),'amountKobo',3000))->>'status'='pending',
  'Payout-after-dispatch preserves pre-existing overtarget operation on reservation replay');
SELECT pg_temp.assert_true(NOT piggyvest_primary.manage_savings(pg_temp.primary_scope(),pg_temp.goal_id(202),'cancel'),
  'Uncertain dispatched transfer cannot be silently refunded');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(12,pg_temp.command(112,'reverse_credit',0,pg_temp.goal_id(102)));
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT current_amount=100 AND status='paused' AND completed_at IS NULL
  FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(12)),'Reversal pauses completion without resuming funding');
SELECT pg_temp.assert_true((SELECT state='cleared' AND overshoot_kobo=0
  FROM piggyvest_primary.savings_completion_reviews WHERE goal_id=pg_temp.goal_id(12)),
  'Reversal clears capacity flag without deleting audit row or pending transfer');
SET SESSION AUTHORIZATION primary_evidence_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',
  jsonb_set(pg_temp.proof(202,12,3000),'{providerTransactionId}','"changed-provider-proof"'))='conflict',
  'Restored capacity cannot overwrite retained first-writer provider evidence');
SELECT pg_temp.assert_true(piggyvest_primary.settle_savings('00000000-0000-4000-8000-000000000004','staging',pg_temp.proof(202,12,3000))='confirmed',
  'Retained transfer can settle once verified reversal restores exact capacity');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT current_amount=130 AND status='completed'
  FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(12)),
  'Later valid settlement credits principal exactly once');

UPDATE public.customer_savings_goals SET status=CASE id WHEN pg_temp.goal_id(14) THEN 'cancelled'
  WHEN pg_temp.goal_id(16) THEN 'spent' WHEN pg_temp.goal_id(17) THEN 'purchase_pending' ELSE 'cancellation_pending' END
WHERE id IN (pg_temp.goal_id(14),pg_temp.goal_id(16),pg_temp.goal_id(17),pg_temp.goal_id(18));
SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(14,pg_temp.command(114,'credit_eligible_paid_interest',3000));
SELECT pg_temp.apply_interest(16,pg_temp.command(116,'credit_eligible_paid_interest',3000));
SELECT pg_temp.apply_interest(17,pg_temp.command(117,'credit_eligible_paid_interest',3000));
SELECT pg_temp.apply_interest(18,pg_temp.command(118,'credit_eligible_paid_interest',3000));
SELECT pg_temp.apply_interest(19,pg_temp.command(119,'credit_eligible_paid_interest',700));
DO $$ BEGIN
  BEGIN
    PERFORM piggyvest_savings_ledger.apply('10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003',pg_temp.goal_id(11),pg_temp.command(120,'credit_eligible_paid_interest',999));
    RAISE EXCEPTION 'Foreign customer accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT array_agg(status ORDER BY id)=ARRAY['cancelled','spent','purchase_pending','cancellation_pending']
  AND bool_and(current_amount=100) FROM public.customer_savings_goals
  WHERE id IN (pg_temp.goal_id(14),pg_temp.goal_id(16),pg_temp.goal_id(17),pg_temp.goal_id(18))),
  'Payout never resurrects special terminal or pending lifecycle states');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM piggyvest_primary.completion_totals(pg_temp.goal_id(19),
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),'Non-primary goals stay outside new scope');
SELECT pg_temp.assert_true((SELECT status='active' FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(19)),
  'Non-primary legacy behavior remains unchanged');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','piggyvest_primary.completion_totals(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','piggyvest_primary.completion_totals(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_table_privilege('primary_interest_fixture','piggyvest_primary.savings_completion_reviews','SELECT')
  AND NOT has_table_privilege('authenticated','piggyvest_primary.savings_completion_reviews','SELECT')
  AND NOT has_table_privilege('service_role','piggyvest_primary.savings_completion_evidence','SELECT')
  AND NOT has_function_privilege('primary_evidence_fixture','piggyvest_primary.settle_savings_before_completion(uuid,text,jsonb)','EXECUTE')
  AND NOT has_function_privilege('primary_authorizer_fixture','piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb)','EXECUTE'),
  'No customer, service-role or ledger-worker access to private completion projections/reviews');
SELECT 'PRIMARY paid-interest completion regressions passed' AS result;
