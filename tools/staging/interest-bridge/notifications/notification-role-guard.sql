DO $$
DECLARE worker_oid oid; allowed oid[];
BEGIN
  SELECT oid INTO STRICT worker_oid FROM pg_catalog.pg_roles WHERE rolname='baci_savings_notifications_worker';
  allowed := ARRAY[
    to_regprocedure('savings_notifications.enqueue_due()'),
    to_regprocedure('savings_notifications.claim_push(integer)'),
    to_regprocedure('savings_notifications.finish_push(uuid,text,uuid,text,text)'),
    to_regprocedure('savings_notifications.pending_receipts(integer)'),
    to_regprocedure('savings_notifications.record_receipt(text,text,text)')];
  IF array_position(allowed,NULL) IS NOT NULL
    OR NOT has_schema_privilege(worker_oid,'savings_notifications','USAGE')
    OR has_schema_privilege(worker_oid,'savings_notifications','CREATE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=worker_oid OR roleid=worker_oid)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=worker_oid
      AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
        OR rolreplication OR rolconfig IS NOT NULL))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace namespace
      CROSS JOIN LATERAL aclexplode(coalesce(namespace.nspacl,acldefault('n'::"char",namespace.nspowner))) grant_row
      WHERE grant_row.grantee=worker_oid AND (namespace.nspname<>'savings_notifications'
        OR grant_row.privilege_type<>'USAGE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc routine
      CROSS JOIN LATERAL aclexplode(coalesce(routine.proacl,acldefault('f'::"char",routine.proowner))) grant_row
      WHERE grant_row.grantee=worker_oid AND routine.oid<>ALL(allowed))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc routine WHERE routine.oid=ANY(allowed)
      AND NOT has_function_privilege(worker_oid,routine.oid,'EXECUTE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc routine
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
      WHERE routine.prosecdef AND routine.oid<>ALL(allowed)
        AND has_schema_privilege(worker_oid,namespace.oid,'USAGE')
        AND has_function_privilege(worker_oid,routine.oid,'EXECUTE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class relation
      CROSS JOIN LATERAL aclexplode(coalesce(relation.relacl,acldefault(
        CASE WHEN relation.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,relation.relowner))) grant_row
      WHERE relation.relkind IN ('r','p','v','m','f','S')
        AND (relation.relowner=worker_oid OR grant_row.grantee=worker_oid))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_database database
      CROSS JOIN LATERAL aclexplode(coalesce(database.datacl,acldefault('d'::"char",database.datdba))) grant_row
      WHERE grant_row.grantee=worker_oid AND grant_row.privilege_type<>'CONNECT') THEN
    RAISE EXCEPTION 'notification function-only role contract refused' USING ERRCODE='42501';
  END IF;
END $$;
