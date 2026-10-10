INSERT INTO legacy_enrollment_scope_context(proof,scope,observed)
SELECT payload,payload->'scope',(SELECT system_identifier::text FROM pg_catalog.pg_control_system())
FROM legacy_enrollment_proof;
DO $scope$
DECLARE proof jsonb; scope jsonb; observed text; public_function oid;
BEGIN
  SELECT context.proof,context.scope,context.observed INTO STRICT proof,scope,observed
    FROM legacy_enrollment_scope_context context;
  IF jsonb_typeof(proof->'verifiedAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'legacy enrollment verifiedAt must be a string' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(proof->'credits') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'legacy enrollment credits must be an array' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'credits') item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR jsonb_typeof(item->'payloadSha256') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'originalPayloadIntegrity') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'provenance') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'providerReconciliation') IS DISTINCT FROM 'object'
        OR jsonb_typeof(item->'providerReconciliation'->'transactionId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'providerReconciliation'->'responseSha256') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'providerReconciliation'->'retrievedAt') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'observation') IS DISTINCT FROM 'object'
        OR jsonb_typeof(item->'observation'->'creditedAt') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'observation'->'eventCategory') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'observation'->'envelopeWalletId') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'legacy enrollment proof fields must be non-null strings or objects' USING ERRCODE='22023';
  END IF;
  IF (current_setting('baci.legacy_enrollment_test',true)='on'
      AND (session_user<>current_user OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper)))
    OR (current_setting('baci.legacy_enrollment_test',true)<>'on'
      AND (session_user<>'postgres' OR current_user<>'postgres' OR inet_client_addr() IS NOT NULL))
    OR current_setting('transaction_isolation')<>'read committed' OR current_setting('transaction_read_only')<>'off'
    OR proof->>'schemaVersion' IS DISTINCT FROM '1'
    OR (SELECT count(*) FROM jsonb_object_keys(proof))<>4 OR NOT proof ?& ARRAY['schemaVersion','verifiedAt','scope','credits']
    OR jsonb_array_length(proof->'credits')=0 OR jsonb_typeof(scope) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(scope))<>9
    OR NOT scope ?& ARRAY['systemIdentifier','integrationId','businessId','merchantId','customerId','goalId','providerWalletId','providerCustomerId','currency']
    OR scope->>'currency' IS DISTINCT FROM 'NGN' OR scope->>'systemIdentifier' IS DISTINCT FROM current_setting('legacy_enrollment.system')
    OR scope->>'integrationId' IS DISTINCT FROM current_setting('legacy_enrollment.integration')
    OR scope->>'businessId' IS DISTINCT FROM current_setting('legacy_enrollment.business')
    OR scope->>'merchantId' IS DISTINCT FROM current_setting('legacy_enrollment.merchant')
    OR scope->>'customerId' IS DISTINCT FROM current_setting('legacy_enrollment.customer')
    OR scope->>'goalId' IS DISTINCT FROM current_setting('legacy_enrollment.goal')
    OR scope->>'providerWalletId' IS DISTINCT FROM current_setting('legacy_enrollment.wallet')
    OR scope->>'providerCustomerId' IS DISTINCT FROM current_setting('legacy_enrollment.provider_customer')
    OR current_setting('baci.legacy_enrollment_fail_after_seed',true) NOT IN ('on','off')
    OR (proof->>'verifiedAt')::timestamptz>clock_timestamp()
    OR (proof->>'verifiedAt')::timestamptz<clock_timestamp()-interval '15 minutes' THEN
    RAISE EXCEPTION 'legacy enrollment authority or proof scope refused' USING ERRCODE='42501';
  END IF;
  IF current_setting('baci.legacy_enrollment_test',true)='on' THEN
    IF current_database() NOT LIKE 'piggyvest_legacy_enrollment_scratch%'
      OR observed='7685292944002592802' OR current_setting('legacy_enrollment.system')<>observed THEN
      RAISE EXCEPTION 'legacy enrollment disposable identity refused' USING ERRCODE='55000';
    END IF;
  ELSE
    SELECT to_regprocedure('public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)')::oid
      INTO public_function;
    IF current_database()<>'postgres' OR observed<>'7685292944002592802'
      OR current_setting('legacy_enrollment.system')<>observed OR clock_timestamp()>=to_timestamp(1790697550)
      OR current_setting('legacy_enrollment.integration')<>'d91d9e87-8e0d-44de-9b84-1e1d709633d2'
      OR current_setting('legacy_enrollment.business')<>'01M2381RG34HQJMHQKE7DWDACR'
      OR current_setting('legacy_enrollment.merchant')<>'10000000-0000-4000-8000-000000000001'
      OR current_setting('legacy_enrollment.customer')<>'10000000-0000-4000-8000-000000000002'
      OR current_setting('legacy_enrollment.goal')<>'430314fd-cd8b-4579-98d4-e9f345713dd6'
      OR current_setting('legacy_enrollment.wallet')<>'01M3CQX27G9687EFSF1TKYMPR9'
      OR current_setting('legacy_enrollment.provider_customer')<>'c096507d-dc32-45d2-9c01-871a27abfd10'
      OR current_setting('baci.legacy_enrollment_fail_after_seed')<>'off'
      OR public_function IS NULL
      OR encode(pg_catalog.sha256(convert_to(pg_catalog.pg_get_functiondef(public_function),'UTF8')),'hex')<>
        'b660d1dde7fb988add26cd93d65f7b3a366d6e0850f0e1e33d807f44ba289804' THEN
      RAISE EXCEPTION 'legacy enrollment production identity, lease, or replay contract refused' USING ERRCODE='55000';
    END IF;
  END IF;
END
$scope$;
