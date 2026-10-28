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
    PERFORM public.get_customer_savings_interest_snapshot('00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Unconfigured combined snapshot returned partial history';
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
SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(19,pg_temp.command(601,'reserve_purchase',200));
RESET SESSION AUTHORIZATION;
SET ROLE authenticated;
CREATE TEMP TABLE staging_earnings_before_eligible_reversal AS SELECT
  (public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric AS amount_kobo;
GRANT SELECT ON staging_earnings_before_eligible_reversal TO authenticated;
RESET ROLE;
SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(11,pg_temp.command(602,'reverse_credit',0,pg_temp.goal_id(101)));
RESET SESSION AUTHORIZATION;
CREATE TEMP TABLE staging_ledger_expected AS SELECT
  coalesce(sum(posting.amount_kobo),0)::numeric AS amount_kobo,
  count(DISTINCT operation.id)::integer AS operation_count
FROM piggyvest_savings_ledger.operations operation
JOIN piggyvest_savings_ledger.postings posting
  ON posting.operation_id=operation.id AND posting.account='paid_interest'
LEFT JOIN piggyvest_savings_ledger.operations original
  ON original.id=operation.reference_id AND original.integration_id=operation.integration_id
  AND original.merchant_id=operation.merchant_id AND original.customer_id=operation.customer_id
  AND original.goal_id=operation.goal_id
WHERE operation.merchant_id='00000000-0000-4000-8000-000000000001'
  AND operation.customer_id='00000000-0000-4000-8000-000000000002'
  AND ((operation.command->>'kind'='credit_eligible_paid_interest' AND posting.amount_kobo>0)
    OR (operation.command->>'kind'='reverse_credit'
      AND original.command->>'kind'='credit_eligible_paid_interest' AND posting.amount_kobo<0));
GRANT SELECT ON staging_ledger_expected TO authenticated;
CREATE TEMP TABLE staging_earnings_raw_postings AS SELECT
  coalesce(sum(posting.amount_kobo),0)::numeric AS amount_kobo
FROM piggyvest_savings_ledger.operations operation
JOIN piggyvest_savings_ledger.postings posting
  ON posting.operation_id=operation.id AND posting.account='paid_interest'
WHERE operation.merchant_id='00000000-0000-4000-8000-000000000001'
  AND operation.customer_id='00000000-0000-4000-8000-000000000002';
GRANT SELECT ON staging_earnings_raw_postings TO authenticated;
SET ROLE authenticated;
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric=
  (SELECT amount_kobo FROM pg_temp.staging_ledger_expected),
  'Staging earnings include eligible credits and linked reversals only');
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric<>
  (SELECT amount_kobo FROM pg_temp.staging_earnings_raw_postings),
  'Staging paid-interest purchase debits do not reduce credited earnings');
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001')->>'credited_interest_kobo')::numeric=
  (SELECT amount_kobo-700 FROM pg_temp.staging_earnings_before_eligible_reversal),
  'Reversal linked to eligible paid interest reduces credited earnings by its posted amount');
SELECT pg_temp.assert_true((public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001',true)->'goal_interest_kobo')
  @> jsonb_build_array(jsonb_build_object('goal_id',pg_temp.goal_id(19),'credited_interest_kobo',700)),
  'Per-goal earnings exclude the synthetic 200-kobo purchase reservation debit');
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
SELECT pg_temp.assert_true((public.get_customer_savings_interest_history(
  '00000000-0000-4000-8000-000000000001')->'interest_history')
  @> jsonb_build_array(jsonb_build_object('id','legacy:'||pg_temp.goal_id(602)::text,'amount',-7,
    'type','adjustment','date_basis','ledger')),
  'Eligible paid-interest reversal remains a negative history item');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_customer_savings_interest_history(
  '00000000-0000-4000-8000-000000000001')->'interest_history') item
  WHERE item->>'id'='legacy:'||pg_temp.goal_id(601)::text),
  'Purchase reservation debit is not presented as an earnings activity');
DO $$ BEGIN
  BEGIN
    PERFORM public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000099');
    RAISE EXCEPTION 'Cross-merchant earnings read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000099',true);
    RAISE EXCEPTION 'Cross-merchant per-goal earnings read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
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
