\set ON_ERROR_STOP on
\ir primary-wallet-paid-interest-production-setup.integration.sql
SET SESSION AUTHORIZATION production_primary_interest_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.read_paid_interest_crosswalk('00000000-0000-4000-8000-000000000005','production',pg_temp.production_selection())
  ->>'apiWalletId'='production-api-wallet-45','Exact provider crosswalk resolves API wallet without guessing IDs');
SELECT pg_temp.assert_true(piggyvest_primary.read_paid_interest_crosswalk('00000000-0000-4000-8000-000000000005','production',pg_temp.production_selection(46)) IS NULL,
  'Opt-out savings cannot earn interest');
SELECT pg_temp.assert_true(piggyvest_primary.read_paid_interest_crosswalk('00000000-0000-4000-8000-000000000005','production',pg_temp.production_selection(47)) IS NULL,
  'Crosswalk stays disabled until evidence and owner policy are approved');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(46))='prerequisite','Opt-out payout cannot create a receipt');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(47))='prerequisite','Disabled policy cannot create a receipt');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_proof()||'{"apiCustomerId":"foreign"}')='prerequisite','Foreign API customer cannot fund savings');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_proof()||'{"destinationWalletId":"prodinternaldestination45"}')='prerequisite','Hyphen removal is not an identity proof');
DO $$ BEGIN
  BEGIN
    PERFORM piggyvest_primary.read_paid_interest_crosswalk('00000000-0000-4000-8000-000000000005','staging',pg_temp.production_selection());
    RAISE EXCEPTION 'Cross-environment read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.production_apply(pg_temp.production_proof()||'{"taxKobo":0}');
    RAISE EXCEPTION 'Inconsistent gross tax net accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_proof())='credited','Signed and authenticated exact proof adds net interest to savings');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_proof()||jsonb_build_object('eventId','retry-alias','bodyDigest',repeat('c',64)))='duplicate',
  'New delivery ID cannot duplicate a financial payout');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_proof()||'{"grossKobo":4158,"netKobo":4000,"amountKobo":4000}')='conflict',
  'Changed net amount cannot overwrite first financial evidence');
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_proof()||'{"payoutId":"different-payout"}')='conflict',
  'Delivery ID cannot identify a second financial payout');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT current_amount=100 AND status='completed' FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(45)),
  'Production paid interest completes exact funded target without duplicate principal');
SELECT pg_temp.assert_true((SELECT paid_interest_kobo=3000 AND pending_kobo=3000 FROM piggyvest_primary.completion_totals(
  pg_temp.goal_id(45),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),
  'Production completion totals include only verified net receipts and retain pending transfers');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(net_kobo)=3000 FROM piggyvest_primary.paid_interest_receipts),'Replay has one immutable financial receipt');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM piggyvest_primary.paid_interest_delivery_ids),'Retries are immutable event aliases');
SELECT pg_temp.assert_true((SELECT state='dispatched' FROM piggyvest_primary.savings_operations WHERE id=pg_temp.goal_id(401)),'Payout does not erase an in-flight principal transfer');
SELECT pg_temp.assert_true((SELECT state='open' AND overshoot_kobo=3000 FROM piggyvest_primary.savings_completion_reviews WHERE goal_id=pg_temp.goal_id(45)),
  'Concurrent overshoot is explicitly flagged for external reconciliation');
SELECT pg_temp.assert_true((SELECT wallet.available_balance=saved.available_balance AND wallet.total_earned=saved.total_earned
  FROM public.customer_wallets wallet CROSS JOIN production_cash_before saved),'Paid interest is never ordinary wallet cash');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM savings_notifications.events WHERE goal_id=pg_temp.goal_id(45)
  AND type='goal_completed' AND voided_at IS NULL),'Production funded completion enqueues parent completion notice');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(body='Your savings grew by ₦30.00 in paid interest. Keep going!')
  FROM savings_notifications.events WHERE goal_id=pg_temp.goal_id(45) AND type='interest_credited' AND voided_at IS NULL),
  'Production net payout enqueues one savings-only interest notice');

SET ROLE authenticated;
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001',true)
  ->'goal_interest_kobo') @> jsonb_build_array(jsonb_build_object('goal_id',pg_temp.goal_id(45),'credited_interest_kobo',3000)),
  'Existing authenticated per-goal earnings RPC includes production net interest');
SELECT pg_temp.assert_true((public.get_customer_savings_notifications('00000000-0000-4000-8000-000000000001')->'notifications')
  @> jsonb_build_array(jsonb_build_object('goalId',pg_temp.goal_id(45),'type','interest_credited')),'Existing notification read RPC exposes the savings interest notice');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001',true);
    RAISE EXCEPTION 'Foreign customer read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric=
  (SELECT (get_customer_savings_earnings->>'credited_interest_kobo')::numeric+3000 FROM legacy_earnings_before),
  'Existing aggregate RPC adds production interest without changing legacy earnings');
INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
VALUES(pg_temp.goal_id(45),'10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','primary_interest_fixture',true);
SET SESSION AUTHORIZATION primary_interest_fixture;
DO $$ BEGIN
  BEGIN
    PERFORM pg_temp.apply_interest(45,pg_temp.command(501,'credit_eligible_paid_interest',3000));
    RAISE EXCEPTION 'Mixed legacy and production sources counted twice';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations WHERE id=pg_temp.goal_id(501)),
  'Mixed source ledger intake rolls back atomically rather than double-counting');
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001',true)->'goal_interest_kobo')
  @> jsonb_build_array(jsonb_build_object('goal_id',pg_temp.goal_id(45),'credited_interest_kobo',3000)),
  'A conflicting legacy binding cannot change the once-funded production earnings projection');
INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
VALUES(pg_temp.goal_id(47),'10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','primary_interest_fixture',true);
UPDATE piggyvest_primary.paid_interest_crosswalks SET enabled=true WHERE id=pg_temp.goal_id(47);
SET SESSION AUTHORIZATION production_primary_interest_fixture;
SELECT pg_temp.assert_true(pg_temp.production_apply(pg_temp.production_goal_proof(47))='prerequisite',
  'Existing legacy source prevents new production attribution even when the crosswalk is enabled');
RESET SESSION AUTHORIZATION;

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
INSERT INTO piggyvest_primary.paid_interest_reversals VALUES('00000000-0000-4000-8000-000000000005','synthetic-owner-reversal','production-payout',3000,
  repeat('f',64),'synthetic-provider-proof-only-no-runtime-reversal-handler');
SELECT pg_temp.assert_true((SELECT current_amount=100 AND status='paused' FROM public.customer_savings_goals WHERE id=pg_temp.goal_id(45)),
  'Verified reversal removes net funded interest without changing principal or terminal policy');
SELECT pg_temp.assert_true((SELECT bool_and(voided_at IS NOT NULL) FROM savings_notifications.events
  WHERE goal_id=pg_temp.goal_id(45) AND type IN ('interest_credited','goal_completed')),'Reversed savings interest and completion notices are no longer deliverable');
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001',true)->'goal_interest_kobo')
  @> jsonb_build_array(jsonb_build_object('goal_id',pg_temp.goal_id(45),'credited_interest_kobo',0)),
  'Authenticated earnings projection subtracts verified reversal');
DO $$ BEGIN
  BEGIN
    INSERT INTO piggyvest_primary.paid_interest_reversals VALUES('00000000-0000-4000-8000-000000000005','excess-reversal','production-payout',1,repeat('f',64),'synthetic');
    RAISE EXCEPTION 'Excess reversal accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PRIMARY production paid-interest, capacity, earnings and notification regressions passed' AS result;
