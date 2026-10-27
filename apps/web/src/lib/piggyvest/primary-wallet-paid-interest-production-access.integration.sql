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
LEFT JOIN piggyvest_savings_ledger.operations original
  ON original.id=operation.reference_id AND original.integration_id=operation.integration_id
  AND original.merchant_id=operation.merchant_id AND original.customer_id=operation.customer_id
  AND original.goal_id=operation.goal_id
WHERE operation.merchant_id='00000000-0000-4000-8000-000000000001'
  AND operation.customer_id='00000000-0000-4000-8000-000000000002'
  AND ((operation.command->>'kind'='credit_eligible_paid_interest' AND posting.amount_kobo>0)
    OR (operation.command->>'kind'='reverse_credit'
      AND original.command->>'kind'='credit_eligible_paid_interest' AND posting.amount_kobo<0));
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
