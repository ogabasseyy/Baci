export const PIGGYVEST_ACCRUAL_OBSERVER_STATEMENTS = {
  session: `SELECT session_user AS login, current_user AS role, current_database() AS database,
    current_setting('transaction_read_only') AS "readOnly",
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
    (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication
      OR rolinherit OR NOT rolcanlogin FROM pg_roles WHERE rolname=current_user) AS unsafe,
    (SELECT rolvaliduntil>clock_timestamp() AND rolvaliduntil<=$1::timestamptz
      FROM pg_roles WHERE rolname=current_user) AS "expiresValid",
    NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(
      SELECT oid FROM pg_roles WHERE rolname=current_user)) AS "noMembership"`,
  identity: 'SELECT prefunded_card.executor_system_identity() AS result',
  authority: `WITH routines AS (
    SELECT to_regprocedure('piggyvest_staging.record_interest_accrual_scoped(uuid,text,text,uuid,text,json)') AS wrapper,
      to_regprocedure('piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)') AS original,
      to_regprocedure('prefunded_card.executor_system_identity()') AS identity
  ) SELECT coalesce(wrapper.oid IS NOT NULL AND original.oid IS NOT NULL
    AND has_schema_privilege(current_user,'piggyvest_staging','USAGE')
    AND has_function_privilege(current_user,wrapper.oid,'EXECUTE')
    AND NOT has_function_privilege('public',wrapper.oid,'EXECUTE')
    AND pg_get_userbyid(wrapper.proowner)='postgres' AND pg_get_userbyid(original.proowner)='postgres'
    AND wrapper.prosecdef AND original.prosecdef
    AND wrapper.proconfig=ARRAY['search_path=pg_catalog']
    AND original.proconfig=ARRAY['search_path=pg_catalog']
    AND wrapper.prokind='f' AND wrapper.prorettype='text'::regtype
    AND (SELECT lanname FROM pg_language WHERE oid=wrapper.prolang)='plpgsql',false) AS authorized,
    NOT EXISTS(SELECT 1 FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
      WHERE namespace.nspname IN ('prefunded_card','piggyvest_savings_ledger','piggyvest_staging')
      AND routine.oid NOT IN (routines.wrapper,routines.identity)
      AND has_function_privilege(current_user,routine.oid,'EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE relation.relkind IN ('r','p') AND (namespace.nspname IN (
        'prefunded_card','piggyvest_savings_ledger','savings_notifications')
        OR (namespace.nspname='public' AND relation.relname IN ('customer_savings_goals','customer_savings_contributions'))
        OR (namespace.nspname='piggyvest_staging' AND relation.relname IN ('interest_accrual_observations','interest_accrual_receipts')))
      AND (has_table_privilege(current_user,relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
        OR has_any_column_privilege(current_user,relation.oid,'INSERT,UPDATE'))) AS restricted,
    encode(sha256(convert_to(pg_get_functiondef(wrapper.oid),'UTF8')),'hex') AS "wrapperDefinitionSha256",
    encode(sha256(convert_to(pg_get_functiondef(original.oid),'UTF8')),'hex') AS "originalDefinitionSha256"
    FROM routines LEFT JOIN pg_proc wrapper ON wrapper.oid=routines.wrapper
      LEFT JOIN pg_proc original ON original.oid=routines.original`,
  apply:
    'SELECT piggyvest_staging.record_interest_accrual_scoped($1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::json) AS result',
} as const;
