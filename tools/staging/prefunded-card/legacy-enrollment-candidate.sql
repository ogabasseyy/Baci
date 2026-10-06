\set ON_ERROR_STOP on
\if :{?legacy_enrollment_test}
\else
  \set legacy_enrollment_test off
\endif
\if :{?legacy_enrollment_system}
\else
  \set legacy_enrollment_system 7685292944002592802
\endif
\if :{?legacy_enrollment_integration}
\else
  \set legacy_enrollment_integration d91d9e87-8e0d-44de-9b84-1e1d709633d2
\endif
\if :{?legacy_enrollment_business}
\else
  \set legacy_enrollment_business 01M2381RG34HQJMHQKE7DWDACR
\endif
\if :{?legacy_enrollment_merchant}
\else
  \set legacy_enrollment_merchant 10000000-0000-4000-8000-000000000001
\endif
\if :{?legacy_enrollment_customer}
\else
  \set legacy_enrollment_customer 10000000-0000-4000-8000-000000000002
\endif
\if :{?legacy_enrollment_goal}
\else
  \set legacy_enrollment_goal 430314fd-cd8b-4579-98d4-e9f345713dd6
\endif
\if :{?legacy_enrollment_wallet}
\else
  \set legacy_enrollment_wallet 01M3CQX27G9687EFSF1TKYMPR9
\endif
\if :{?legacy_enrollment_provider_customer}
\else
  \set legacy_enrollment_provider_customer c096507d-dc32-45d2-9c01-871a27abfd10
\endif
\if :{?legacy_enrollment_fail_after_seed}
\else
  \set legacy_enrollment_fail_after_seed off
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL baci.legacy_enrollment_test = :'legacy_enrollment_test';
SELECT set_config('legacy_enrollment.integration', :'legacy_enrollment_integration', true),
  set_config('legacy_enrollment.business', :'legacy_enrollment_business', true),
  set_config('legacy_enrollment.merchant', :'legacy_enrollment_merchant', true),
  set_config('legacy_enrollment.customer', :'legacy_enrollment_customer', true),
  set_config('legacy_enrollment.goal', :'legacy_enrollment_goal', true),
  set_config('legacy_enrollment.wallet', :'legacy_enrollment_wallet', true),
  set_config('legacy_enrollment.provider_customer', :'legacy_enrollment_provider_customer', true),
  set_config('legacy_enrollment.system', :'legacy_enrollment_system', true),
  set_config('baci.legacy_enrollment_fail_after_seed', :'legacy_enrollment_fail_after_seed', true);
CREATE TEMP TABLE legacy_enrollment_proof(payload jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO legacy_enrollment_proof VALUES (:'owner_sealed_json'::jsonb);
GRANT SELECT ON legacy_enrollment_proof TO prefunded_evidence,prefunded_treasury_operator;
CREATE TEMP TABLE legacy_enrollment_scope_context(proof jsonb,scope jsonb,observed text) ON COMMIT DROP;
\ir legacy-enrollment-scope-preflight.sql

\ir legacy-enrollment-preflight.sql

SELECT coalesce(current_setting('legacy_enrollment.already_complete',true)='on',false)
  AS legacy_enrollment_already_complete \gset
\if :legacy_enrollment_already_complete
  SELECT 'already_complete' AS legacy_enrollment_result;
\else
  INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
  VALUES (:'legacy_enrollment_goal',:'legacy_enrollment_integration',:'legacy_enrollment_merchant',
    :'legacy_enrollment_customer','prefunded_treasury_operator',true);
  INSERT INTO prefunded_card.evidence_authorities(integration_id,business_id,system_identifier,
    ingestion_login,reader_login,currency,enabled)
  VALUES (:'legacy_enrollment_integration'::uuid,:'legacy_enrollment_business',:'legacy_enrollment_system',
    'prefunded_evidence','prefunded_treasury_operator','NGN',true);
  INSERT INTO prefunded_card.provider_evidence(integration_id,event_id,fingerprint,observation,business_id,ingestion_login)
  SELECT :'legacy_enrollment_integration'::uuid,item->'observation'->>'eventId',item->>'payloadSha256',
    item->'observation',:'legacy_enrollment_business',session_user
  FROM legacy_enrollment_proof proof,LATERAL jsonb_array_elements(proof.payload->'credits') item
  ORDER BY item->'observation'->>'eventId';

  SELECT NOT has_function_privilege('prefunded_treasury_operator',
    'piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)','EXECUTE') AS legacy_enrollment_added_apply_grant \gset
  SELECT NOT has_schema_privilege('prefunded_treasury_operator','piggyvest_savings_ledger','USAGE')
    AS legacy_enrollment_added_ledger_schema_usage \gset
  \if :legacy_enrollment_added_ledger_schema_usage
    GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;
  \endif
  \if :legacy_enrollment_added_apply_grant
    GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
      TO prefunded_treasury_operator;
  \endif
  SET SESSION AUTHORIZATION prefunded_treasury_operator;
  SELECT piggyvest_savings_ledger.apply(:'legacy_enrollment_integration'::uuid,
    :'legacy_enrollment_merchant'::uuid,:'legacy_enrollment_customer'::uuid,:'legacy_enrollment_goal'::uuid,
    jsonb_build_object('operationId',md5('legacy-opening-v1:'||:'legacy_enrollment_integration'||':'||
      (item->>'legacyProviderTransactionId'))::uuid,'kind','credit_principal',
      'principalKobo',(item->'observation'->>'amountKobo')::bigint,'interestKobo',0,
      'evidenceId','legacy-opening-v1:'||md5('legacy-opening-v1:'||:'legacy_enrollment_integration'||':'||
        (item->>'legacyProviderTransactionId'))::uuid::text,'referenceId',NULL))
    FROM legacy_enrollment_proof proof, LATERAL jsonb_array_elements(proof.payload->'credits') item
    ORDER BY item->>'legacyProviderTransactionId';
  RESET SESSION AUTHORIZATION;
  \if :legacy_enrollment_added_apply_grant
    REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
      FROM prefunded_treasury_operator;
  \endif
  \if :legacy_enrollment_added_ledger_schema_usage
    REVOKE USAGE ON SCHEMA piggyvest_savings_ledger FROM prefunded_treasury_operator;
  \endif

  INSERT INTO prefunded_card.bank_projections(integration_id,provider_transaction_id,event_id,operation_id,
    contribution_id,merchant_id,customer_id,goal_id,amount_kobo)
  SELECT :'legacy_enrollment_integration'::uuid,item->'observation'->>'providerTransactionId',
    item->'observation'->>'eventId',md5('legacy-opening-v1:'||:'legacy_enrollment_integration'||':'||
      (item->>'legacyProviderTransactionId'))::uuid,(item->>'contributionId')::uuid,
    :'legacy_enrollment_merchant'::uuid,:'legacy_enrollment_customer'::uuid,:'legacy_enrollment_goal'::uuid,
    (item->'observation'->>'amountKobo')::bigint
  FROM legacy_enrollment_proof proof,LATERAL jsonb_array_elements(proof.payload->'credits') item;
  DO $$ BEGIN
    IF current_setting('baci.legacy_enrollment_fail_after_seed')='on' THEN
      RAISE EXCEPTION 'legacy enrollment rehearsal rollback';
    END IF;
  END $$;
  DO $$ BEGIN
    IF (SELECT current_amount FROM public.customer_savings_goals WHERE id=current_setting('legacy_enrollment.goal')::uuid)<>100
      OR (SELECT coalesce(sum(amount*100),0) FROM public.customer_savings_contributions
        WHERE goal_id=current_setting('legacy_enrollment.goal')::uuid)<>10000
      OR (SELECT count(*) FROM public.customer_savings_contributions
        WHERE goal_id=current_setting('legacy_enrollment.goal')::uuid)<>
          (SELECT count(*) FROM legacy_enrollment_proof,LATERAL jsonb_array_elements(payload->'credits')) THEN
      RAISE EXCEPTION 'legacy public balance or contribution history changed';
    END IF;
  END $$;
  -- A later credit-route cutover must re-reconcile all legacy inflows since this snapshot.
  SELECT 'migrated' AS legacy_enrollment_result;
\endif
DO $$ BEGIN
  IF current_setting('baci.legacy_enrollment_test',true) IS DISTINCT FROM 'on'
    AND clock_timestamp()>=to_timestamp(1790697550) THEN
    RAISE EXCEPTION 'legacy enrollment owner lease expired before commit' USING ERRCODE='55000';
  END IF;
END $$;
COMMIT;
