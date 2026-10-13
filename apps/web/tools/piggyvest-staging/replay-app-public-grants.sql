\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'supabase_admin' OR
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7685292944002592802' THEN
    RAISE EXCEPTION 'Wrong staging application database';
  END IF;
END
$guard$;
DO $permissions$
DECLARE
  grant_row record;
  existing_role record;
  object_type text;
BEGIN
  FOR grant_row IN
    SELECT namespace.nspname, relation.relname, relation.relkind,
      privilege.privilege_type
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) privilege
    WHERE privilege.grantee = 0
      AND (namespace.nspname, relation.relname) IN (
        ('net','http_request_queue_id_seq'), ('net','http_request_queue'),
        ('net','_http_response'), ('cron','job'), ('cron','job_run_details'),
        ('extensions','spatial_ref_sys'), ('extensions','geometry_columns'),
        ('extensions','geography_columns'), ('extensions','pg_stat_statements'),
        ('extensions','pg_stat_statements_info'))
  LOOP
    object_type := CASE WHEN grant_row.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END;
    FOR existing_role IN
      SELECT rolname FROM pg_catalog.pg_roles
      WHERE rolname NOT LIKE 'pg_%'
        AND rolname NOT IN ('pvb_staging_app_worker', 'pvb_staging_worker', 'pvb_staging_ingest')
    LOOP
      EXECUTE format('GRANT %s ON %s %I.%I TO %I', grant_row.privilege_type,
        object_type, grant_row.nspname, grant_row.relname, existing_role.rolname);
    END LOOP;
    EXECUTE format('REVOKE %s ON %s %I.%I FROM PUBLIC', grant_row.privilege_type,
      object_type, grant_row.nspname, grant_row.relname);
  END LOOP;
  FOR grant_row IN
    SELECT routine.oid::regprocedure AS identity
    FROM pg_catalog.pg_proc routine
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(routine.proacl,
      pg_catalog.acldefault('f',routine.proowner))) privilege
    WHERE namespace.nspname = 'public' AND routine.prosecdef
      AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
  LOOP
    FOR existing_role IN
      SELECT rolname FROM pg_catalog.pg_roles
      WHERE rolname NOT LIKE 'pg_%'
        AND rolname NOT IN ('pvb_staging_app_worker', 'pvb_staging_worker', 'pvb_staging_ingest')
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', grant_row.identity, existing_role.rolname);
    END LOOP;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', grant_row.identity);
  END LOOP;
END
$permissions$;
COMMIT;
