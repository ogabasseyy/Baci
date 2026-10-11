\set ON_ERROR_STOP on
\set QUIET on
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'captured_at',clock_timestamp(),
  'session_is_fixed_login',SESSION_USER='baci_primary_card_evidence' AND CURRENT_USER=SESSION_USER,
  'tls',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),
  'login_restricted',NOT login.rolsuper AND NOT login.rolbypassrls AND NOT login.rolcreaterole AND NOT login.rolcreatedb AND NOT login.rolreplication,
  'login_valid_until',login.rolvaliduntil,
  'sole_capability_membership',(SELECT count(*)=1 AND bool_and(parent.rolname='primary_card_evidence')
    FROM pg_catalog.pg_auth_members member JOIN pg_catalog.pg_roles parent ON parent.oid=member.roleid WHERE member.member=login.oid),
  'capability_restricted',NOT capability.rolcanlogin AND NOT capability.rolsuper AND NOT capability.rolbypassrls
    AND NOT capability.rolcreaterole AND NOT capability.rolcreatedb AND NOT capability.rolreplication,
  'capability_parent_memberships',(SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member=capability.oid),
  'schema_usage',has_schema_privilege(SESSION_USER,'piggyvest_primary_card','USAGE'),
  'effective_primary_rpcs',(SELECT coalesce(jsonb_agg(routine.proname||'('||pg_catalog.pg_get_function_identity_arguments(routine.oid)||')' ORDER BY routine.proname),'[]'::jsonb)
    FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='piggyvest_primary_card' AND has_function_privilege(SESSION_USER,routine.oid,'EXECUTE')),
  'direct_private_table_privileges',(SELECT count(*) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='piggyvest_primary_card' AND relation.relkind IN ('r','p') AND (
      has_table_privilege(SESSION_USER,relation.oid,'SELECT') OR has_table_privilege(SESSION_USER,relation.oid,'INSERT')
      OR has_table_privilege(SESSION_USER,relation.oid,'UPDATE') OR has_table_privilege(SESSION_USER,relation.oid,'DELETE')
      OR has_table_privilege(SESSION_USER,relation.oid,'TRUNCATE'))),
  'public_abandonment_rpcs',(SELECT count(*) FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) grant_item
    WHERE namespace.nspname='piggyvest_primary_card' AND routine.proname IN ('select_stale_ready_checkouts','record_abandonment',
      'record_collection','flag_reconciliation')
      AND grant_item.grantee=0 AND grant_item.privilege_type='EXECUTE'),
  'abandonment_rpcs_present',(SELECT count(*)=4 FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='piggyvest_primary_card'
      AND ((routine.proname='select_stale_ready_checkouts' AND routine.proargtypes='3802 1184 23'::oidvector)
        OR (routine.proname='record_abandonment' AND routine.proargtypes='3802 2950'::oidvector)
        OR (routine.proname='record_collection' AND routine.proargtypes='3802 2950 3802'::oidvector)
        OR (routine.proname='flag_reconciliation' AND routine.proargtypes='3802 2950'::oidvector))
      AND has_function_privilege(SESSION_USER,routine.oid,'EXECUTE')),
  'customer_or_service_abandonment_execution',(SELECT count(*) FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='piggyvest_primary_card' AND routine.proname IN ('select_stale_ready_checkouts','record_abandonment',
      'record_collection','flag_reconciliation')
      AND (has_function_privilege('anon',routine.oid,'EXECUTE') OR has_function_privilege('authenticated',routine.oid,'EXECUTE')
        OR has_function_privilege('service_role',routine.oid,'EXECUTE')))) AS restricted_inventory
  FROM pg_catalog.pg_roles login JOIN pg_catalog.pg_roles capability ON capability.rolname='primary_card_evidence'
  WHERE login.rolname=SESSION_USER;
COMMIT;
