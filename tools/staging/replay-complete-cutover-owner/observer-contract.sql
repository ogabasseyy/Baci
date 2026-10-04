BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL statement_timeout='10s';
DO $observer_identity$ BEGIN
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
    OR current_database() IS DISTINCT FROM 'postgres' OR inet_client_addr() IS NOT NULL
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'repeatable read'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'on'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin'
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'accrual_observer_contract_refused' USING ERRCODE='42501';
  END IF;
END $observer_identity$;
WITH observer AS MATERIALIZED (
  SELECT * FROM pg_roles WHERE rolname='piggyvest_staging_ledger_worker'
), routines AS MATERIALIZED (
  SELECT to_regprocedure('piggyvest_staging.record_interest_accrual_scoped(uuid,text,text,uuid,text,json)') AS wrapper,
    to_regprocedure('piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)') AS original,
    to_regprocedure('prefunded_card.executor_system_identity()') AS identity
), metadata AS MATERIALIZED (
  SELECT jsonb_object_agg(target.label,CASE WHEN routine.oid IS NULL THEN NULL ELSE jsonb_build_object(
    'oid',routine.oid::bigint,'owner',pg_get_userbyid(routine.proowner),'acl',routine.proacl,
    'searchPath',routine.proconfig,'language',language.lanname,'securityDefiner',routine.prosecdef,
    'publicExecute',has_function_privilege('public',routine.oid,'EXECUTE'),
    'observerExecute',coalesce(has_function_privilege((SELECT oid FROM observer),routine.oid,'EXECUTE'),false),
    'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(routine.oid),'UTF8')),'hex'),
    'bodySha256',encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex'),
    'catalogSha256',encode(sha256(convert_to((to_jsonb(routine)-'prosrc')::text,'UTF8')),'hex')) END) AS report
  FROM (VALUES
    ('original','piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)'),
    ('wrapper','piggyvest_staging.record_interest_accrual_scoped(uuid,text,text,uuid,text,json)')) target(label,name)
  LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure(target.name)
  LEFT JOIN pg_language language ON language.oid=routine.prolang
), authority AS MATERIALIZED (
  SELECT coalesce(wrapper.oid IS NOT NULL AND original.oid IS NOT NULL
    AND has_schema_privilege((SELECT oid FROM observer),'piggyvest_staging','USAGE')
    AND has_function_privilege((SELECT oid FROM observer),wrapper.oid,'EXECUTE')
    AND NOT has_function_privilege('public',wrapper.oid,'EXECUTE')
    AND pg_get_userbyid(wrapper.proowner)='postgres' AND pg_get_userbyid(original.proowner)='postgres'
    AND wrapper.prosecdef AND original.prosecdef
    AND wrapper.proconfig=ARRAY['search_path=pg_catalog'] AND original.proconfig=ARRAY['search_path=pg_catalog']
    AND wrapper.prokind='f' AND wrapper.prorettype='text'::regtype
    AND (SELECT lanname FROM pg_language WHERE oid=wrapper.prolang)='plpgsql'
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(wrapper.proacl,acldefault('f',wrapper.proowner))) privilege
      WHERE privilege.grantee<>wrapper.proowner
        AND privilege.grantee IS DISTINCT FROM (SELECT oid FROM observer)),false) AS authorized,
    NOT EXISTS(SELECT 1 FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
      WHERE namespace.nspname IN ('prefunded_card','piggyvest_savings_ledger','piggyvest_staging')
        AND routine.oid IS DISTINCT FROM routines.wrapper AND routine.oid IS DISTINCT FROM routines.identity
        AND has_function_privilege((SELECT oid FROM observer),routine.oid,'EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE relation.relkind IN ('r','p') AND (namespace.nspname IN (
        'prefunded_card','piggyvest_savings_ledger','savings_notifications')
        OR (namespace.nspname='public' AND relation.relname IN ('customer_savings_goals','customer_savings_contributions'))
        OR (namespace.nspname='piggyvest_staging' AND relation.relname IN ('interest_accrual_observations','interest_accrual_receipts')))
        AND (has_table_privilege((SELECT oid FROM observer),relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
          OR has_any_column_privilege((SELECT oid FROM observer),relation.oid,'INSERT,UPDATE'))) AS restricted
  FROM routines LEFT JOIN pg_proc wrapper ON wrapper.oid=routines.wrapper
    LEFT JOIN pg_proc original ON original.oid=routines.original
)
SELECT jsonb_build_object('status','accrual-observer-owner-readonly',
  'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'appIdentity',jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'database',current_database(),'sessionUser',session_user,'currentUser',current_user,
    'localSocket',inet_client_addr() IS NULL,'readOnly',current_setting('transaction_read_only')='on'),
  'scope',jsonb_build_object('integrationId','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'businessId','01M2381RG34HQJMHQKE7DWDACR','executionDeadline','2026-10-06T15:59:10Z'),
  'observerRole',(SELECT jsonb_build_object('oid',oid::bigint,'name',rolname,'canLogin',rolcanlogin,
    'noInherit',NOT rolinherit,'notElevated',NOT(rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication),
    'noMembership',NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=observer.oid),
    'expiresAt',rolvaliduntil,'expiryValid',coalesce(rolvaliduntil>clock_timestamp()
      AND rolvaliduntil<='2026-10-06T15:59:10Z'::timestamptz,false)) FROM observer),
  'authority',(SELECT to_jsonb(authority) FROM authority),'functions',(SELECT report FROM metadata),
  'originalMatchesSource',(SELECT coalesce(report->'original'->>'bodySha256'=
    'ded145ffbd571962691cb16fc520f3c2b8f93f015dc5583f295c69b66bfb4efb',false) FROM metadata));
ROLLBACK;
