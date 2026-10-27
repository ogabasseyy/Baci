\set ON_ERROR_STOP on
\ir primary-wallet-paid-interest-production-setup.integration.sql
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
CREATE TEMP TABLE savings_environment_acl AS SELECT
  role_name,
  has_schema_privilege(role_name,'savings_interest_private','USAGE') AS schema_usage,
  has_table_privilege(role_name,'savings_interest_private.deployment_environment','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS table_access,
  has_function_privilege(role_name,'savings_interest_private.require_environment()','EXECUTE') AS marker_rpc_access
FROM unnest(ARRAY['anon','authenticated','service_role']) role_name;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM savings_environment_acl
    WHERE table_access OR marker_rpc_access
      OR (role_name <> 'authenticated' AND schema_usage)),
  'Only authenticated gets private-schema usage; runtime roles cannot access the marker table or marker reader');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class
  WHERE oid='savings_interest_private.deployment_environment'::regclass),
  'Private deployment environment marker has RLS enabled');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_policy
  WHERE polrelid='savings_interest_private.deployment_environment'::regclass),
  'Private deployment environment marker has no caller policies');
SET ROLE authenticated;
SELECT set_config('savings_interest_private.environment','production',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Unconfigured earnings projection returned mixed values';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    PERFORM public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Unconfigured history projection returned mixed values';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    INSERT INTO savings_interest_private.deployment_environment(singleton,environment) VALUES(true,'production');
    RAISE EXCEPTION 'Authenticated caller provisioned the marker';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM savings_interest_private.deployment_environment;
    RAISE EXCEPTION 'Authenticated caller read the marker';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO savings_interest_private.deployment_environment(singleton,environment) VALUES(true,'staging');
CREATE TEMP TABLE staging_ledger_expected AS SELECT
  coalesce(sum(posting.amount_kobo),0)::numeric AS amount_kobo,
  count(DISTINCT operation.id)::integer AS operation_count
FROM piggyvest_savings_ledger.operations operation
JOIN piggyvest_savings_ledger.postings posting
  ON posting.operation_id=operation.id AND posting.account='paid_interest'
WHERE operation.merchant_id='00000000-0000-4000-8000-000000000001'
  AND operation.customer_id='00000000-0000-4000-8000-000000000002';
GRANT SELECT ON staging_ledger_expected TO authenticated;
SET ROLE authenticated;
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric=
  (SELECT amount_kobo FROM pg_temp.staging_ledger_expected),
  'Staging earnings use only the legacy ledger, including reversals');
SELECT pg_temp.assert_true(jsonb_array_length(public.get_customer_savings_interest_history(
  '00000000-0000-4000-8000-000000000001')->'interest_history')=(SELECT operation_count FROM pg_temp.staging_ledger_expected)
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_customer_savings_interest_history(
    '00000000-0000-4000-8000-000000000001')->'interest_history') item
    WHERE item->>'id' NOT LIKE 'legacy:%' OR item->>'date_basis' <> 'ledger' OR item->>'created_at' IS NULL),
  'Staging history uses legacy ledger entries and preserves their recorded dates');
SELECT pg_temp.assert_true((public.get_customer_savings_interest_history(
  '00000000-0000-4000-8000-000000000001')->'interest_history')
  @> jsonb_build_array(jsonb_build_object('id','legacy:'||pg_temp.goal_id(302)::text,
    'amount',-30,'type','adjustment','date_basis','ledger')),
  'Staging history shows ledger credit reversals as negative recorded adjustments');
DO $$ BEGIN
  BEGIN
    UPDATE savings_interest_private.deployment_environment SET environment='production';
    RAISE EXCEPTION 'Authenticated caller changed the environment marker';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN
    UPDATE savings_interest_private.deployment_environment SET environment='production';
    RAISE EXCEPTION 'Owner changed the write-once environment marker';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    TRUNCATE savings_interest_private.deployment_environment;
    RAISE EXCEPTION 'Owner truncated the write-once environment marker';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
-- This privileged switch exists only in this disposable fixture so both
-- environment projections can be exercised in one isolated database.
ALTER TABLE savings_interest_private.deployment_environment
  DISABLE TRIGGER savings_interest_environment_write_once;
UPDATE savings_interest_private.deployment_environment SET environment='production';
ALTER TABLE savings_interest_private.deployment_environment
  ENABLE TRIGGER savings_interest_environment_write_once;
SET ROLE authenticated;
CREATE TEMP TABLE legacy_earnings_before AS
  SELECT public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001');
RESET ROLE;
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
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_customer_savings_interest_snapshot('00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Foreign authenticated user read interest snapshot';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
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
  'Production earnings use the primary ledger and exclude staging-bound legacy amounts');
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
SET ROLE authenticated;
SELECT pg_temp.assert_true((public.get_customer_savings_interest_snapshot(
  '00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric=1000
  AND jsonb_typeof(public.get_customer_savings_interest_snapshot(
    '00000000-0000-4000-8000-000000000001')->'interest_history')='array',
  'Combined authenticated snapshot returns the production earnings and history in one call');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.get_customer_savings_interest_history(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_customer_savings_interest_history(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.get_customer_savings_interest_history(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_customer_savings_interest_snapshot(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_customer_savings_interest_snapshot(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.get_customer_savings_interest_snapshot(uuid)','EXECUTE')
  AND NOT (SELECT prosecdef FROM pg_proc
    WHERE oid='public.get_customer_savings_interest_snapshot(uuid)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_customer_savings_interest_history(uuid)'::regprocedure)
  AND has_function_privilege('authenticated','savings_interest_private.get_customer_savings_interest_history(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','savings_interest_private.get_customer_savings_interest_history(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','savings_interest_private.get_customer_savings_interest_history(uuid)','EXECUTE'),
  'History wrapper is invoker-only and its tenant-checking private helper is callable only by authenticated users');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Foreign tenant history was returned';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_customer_savings_interest_snapshot('00000000-0000-4000-8000-000000000099');
    RAISE EXCEPTION 'Cross-merchant authenticated user read interest snapshot';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000099');
    RAISE EXCEPTION 'Cross-merchant history was returned';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  BEGIN
    INSERT INTO piggyvest_primary.paid_interest_reversals(integration_id,provider_reversal_id,payout_id,amount_kobo,provider_evidence_sha256,evidence_reference)
      VALUES('00000000-0000-4000-8000-000000000005','excess-reversal','production-payout',1,repeat('f',64),'synthetic');
    RAISE EXCEPTION 'Excess reversal accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
CREATE TEMP TABLE staging_earnings_after_primary AS SELECT
  coalesce(sum(posting.amount_kobo),0)::numeric AS amount_kobo
FROM piggyvest_savings_ledger.operations operation
JOIN piggyvest_savings_ledger.postings posting
  ON posting.operation_id=operation.id AND posting.account='paid_interest'
WHERE operation.merchant_id='00000000-0000-4000-8000-000000000001'
  AND operation.customer_id='00000000-0000-4000-8000-000000000002';
GRANT SELECT ON staging_earnings_after_primary TO authenticated;
ALTER TABLE savings_interest_private.deployment_environment
  DISABLE TRIGGER savings_interest_environment_write_once;
UPDATE savings_interest_private.deployment_environment SET environment='staging';
ALTER TABLE savings_interest_private.deployment_environment
  ENABLE TRIGGER savings_interest_environment_write_once;
SET ROLE authenticated;
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric=
  (SELECT amount_kobo FROM pg_temp.staging_earnings_after_primary),
  'Staging earnings remain ledger-only after primary production receipts exist');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
  public.get_customer_savings_interest_history('00000000-0000-4000-8000-000000000001')->'interest_history') item
  WHERE item->>'id' LIKE 'primary:%'),
  'Staging history excludes primary production receipts and reversals');
RESET ROLE;
ALTER TABLE savings_interest_private.deployment_environment
  DISABLE TRIGGER savings_interest_environment_write_once;
UPDATE savings_interest_private.deployment_environment SET environment='production';
ALTER TABLE savings_interest_private.deployment_environment
  ENABLE TRIGGER savings_interest_environment_write_once;
SELECT 'PRIMARY production paid-interest, capacity, earnings and notification regressions passed' AS result;
