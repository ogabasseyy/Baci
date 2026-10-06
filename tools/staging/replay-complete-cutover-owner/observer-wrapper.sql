BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $observer_install$ BEGIN
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
    OR current_database() IS DISTINCT FROM 'postgres' OR inet_client_addr() IS NOT NULL
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'read committed'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin'
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR to_regprocedure('piggyvest_staging.record_interest_accrual_scoped(uuid,text,text,uuid,text,json)') IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM pg_proc routine JOIN pg_language language ON language.oid=routine.prolang
      WHERE routine.oid=to_regprocedure('piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)')
        AND pg_get_userbyid(routine.proowner)='postgres' AND routine.prosecdef
        AND routine.proconfig=ARRAY['search_path=pg_catalog'] AND routine.prokind='f'
        AND routine.prorettype='text'::regtype AND language.lanname='plpgsql'
        AND NOT has_function_privilege('public',routine.oid,'EXECUTE')
        AND encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')=
          'ded145ffbd571962691cb16fc520f3c2b8f93f015dc5583f295c69b66bfb4efb') THEN
    RAISE EXCEPTION 'accrual_observer_install_refused' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('baci.observer_original_catalog',(SELECT to_jsonb(routine)::text FROM pg_proc routine
    WHERE routine.oid='piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)'::regprocedure),true);
END $observer_install$;

CREATE FUNCTION piggyvest_staging.record_interest_accrual_scoped(
  p_integration uuid, p_business text, p_system_id text, p_receipt_id uuid,
  p_payload_sha256 text, p_payload json
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $observer_scoped$
DECLARE
  outcome text;
BEGIN
  IF session_user IS DISTINCT FROM 'piggyvest_staging_ledger_worker'
    OR current_database() IS DISTINCT FROM 'postgres'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'read committed'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin'
    OR p_integration IS DISTINCT FROM 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid
    OR p_business COLLATE "C" IS DISTINCT FROM '01M2381RG34HQJMHQKE7DWDACR' COLLATE "C"
    OR p_system_id IS DISTINCT FROM '7685292944002592802'
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'accrual_observer_scope_refused' USING ERRCODE='42501';
  END IF;
  outcome := piggyvest_staging.record_interest_accrual(
    p_integration,p_business,p_system_id,p_receipt_id,p_payload_sha256,p_payload);
  IF clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'accrual_observer_deadline_refused' USING ERRCODE='42501';
  END IF;
  RETURN outcome;
END $observer_scoped$;
REVOKE ALL ON FUNCTION piggyvest_staging.record_interest_accrual_scoped(uuid,text,text,uuid,text,json) FROM PUBLIC;

DO $observer_preserved$ BEGIN
  IF (SELECT to_jsonb(routine) FROM pg_proc routine
      WHERE routine.oid='piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)'::regprocedure)
      IS DISTINCT FROM current_setting('baci.observer_original_catalog')::jsonb
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR EXISTS(SELECT 1 FROM pg_proc routine CROSS JOIN LATERAL aclexplode(
        coalesce(routine.proacl,acldefault('f',routine.proowner))) privilege
      WHERE routine.oid='piggyvest_staging.record_interest_accrual_scoped(uuid,text,text,uuid,text,json)'::regprocedure
        AND privilege.grantee<>routine.proowner) THEN
    RAISE EXCEPTION 'accrual_observer_preservation_refused' USING ERRCODE='42501';
  END IF;
END $observer_preserved$;
SELECT jsonb_build_object('status','accrual-observer-rollback-rehearsal','definitions',
  (SELECT jsonb_object_agg(label,jsonb_build_object('oid',routine.oid::bigint,
    'owner',pg_get_userbyid(routine.proowner),'acl',routine.proacl,'searchPath',routine.proconfig,
    'language',language.lanname,'securityDefiner',routine.prosecdef,
    'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(routine.oid),'UTF8')),'hex'),
    'bodySha256',encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')))
   FROM (VALUES
     ('original','piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)'),
     ('wrapper','piggyvest_staging.record_interest_accrual_scoped(uuid,text,text,uuid,text,json)')) target(label,signature)
   JOIN pg_proc routine ON routine.oid=to_regprocedure(target.signature)
   JOIN pg_language language ON language.oid=routine.prolang));
ROLLBACK;
