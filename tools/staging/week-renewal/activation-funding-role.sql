BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;
DO $pin$ BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) <> '7685292944002592802' THEN
    RAISE EXCEPTION 'staging database identity differs' USING ERRCODE = '42501';
  END IF;
END $pin$;
SELECT jsonb_build_object(
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'role', (SELECT jsonb_build_object('name', expected.name, 'present', worker.oid IS NOT NULL,
    'login', worker.rolcanlogin, 'superuser', worker.rolsuper, 'bypassRls', worker.rolbypassrls,
    'createRole', worker.rolcreaterole, 'createDb', worker.rolcreatedb, 'replication', worker.rolreplication,
    'inherits', worker.rolinherit, 'expiresAtEpoch', CASE
      WHEN worker.rolvaliduntil IN ('infinity'::timestamptz, '-infinity'::timestamptz) THEN NULL
      ELSE extract(epoch FROM worker.rolvaliduntil)::bigint END,
    'unsafeMembership', EXISTS (SELECT 1 FROM pg_roles parent
      WHERE worker.oid IS NOT NULL AND parent.oid <> worker.oid
        AND pg_has_role(worker.oid, parent.oid, 'MEMBER')),
    'memberships', (SELECT jsonb_agg(parent.rolname ORDER BY parent.rolname) FROM pg_roles parent
      WHERE worker.oid IS NOT NULL AND parent.oid <> worker.oid
        AND pg_has_role(worker.oid, parent.oid, 'MEMBER')))
    FROM (VALUES ('piggyvest_staging_provisioner')) expected(name)
    LEFT JOIN pg_roles worker ON worker.rolname=expected.name),
  'functions', (SELECT jsonb_agg(jsonb_build_object('schema', namespace.nspname,
    'name', routine.proname, 'arguments', pg_get_function_identity_arguments(routine.oid),
    'owner', pg_get_userbyid(routine.proowner), 'securityDefiner', routine.prosecdef,
    'definitionSha256', encode(sha256(convert_to(pg_get_functiondef(routine.oid), 'UTF8')), 'hex'))
    ORDER BY namespace.nspname, routine.proname, routine.oid)
    FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
    JOIN pg_roles worker ON worker.rolname='piggyvest_staging_provisioner'
    WHERE namespace.nspname IN ('piggyvest_staging', 'piggyvest_savings_ledger')
      AND routine.prokind='f' AND has_function_privilege(worker.oid, routine.oid, 'EXECUTE'))
);
ROLLBACK;
