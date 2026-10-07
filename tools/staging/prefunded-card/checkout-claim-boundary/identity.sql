DO $identity$ BEGIN
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
    OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR current_setting('transaction_isolation')<>'read committed'
    OR current_setting('session_replication_role')<>'origin'
    OR EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') THEN
    RAISE EXCEPTION 'claim boundary physical owner identity refused' USING ERRCODE='42501';
  END IF;
END $identity$;
DO $locks$
DECLARE entry record; expected jsonb; captured_at timestamptz;
BEGIN
  SELECT evidence->'identity' INTO STRICT expected FROM pg_temp.cb_expected;
  SELECT (evidence->>'capturedAt')::timestamptz INTO STRICT captured_at FROM pg_temp.cb_expected;
  IF current_database() IS DISTINCT FROM expected->>'database'
    OR (SELECT oid FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM (expected->>'databaseOid')::oid
    OR (SELECT oid FROM pg_roles WHERE rolname=current_user) IS DISTINCT FROM (expected->>'roleOid')::oid THEN
    RAISE EXCEPTION 'claim boundary database or role differs' USING ERRCODE='42501';
  END IF;
  IF captured_at>clock_timestamp() OR clock_timestamp()-captured_at>interval '300 seconds' THEN
    RAISE EXCEPTION 'claim boundary capture expired before locks' USING ERRCODE='55000';
  END IF;
  LOCK TABLE pg_catalog.pg_namespace,pg_catalog.pg_class,pg_catalog.pg_proc,pg_catalog.pg_language,
    pg_catalog.pg_authid,pg_catalog.pg_auth_members,pg_catalog.pg_default_acl,pg_catalog.pg_database,
    pg_catalog.pg_attribute,pg_catalog.pg_attrdef,pg_catalog.pg_index,pg_catalog.pg_constraint,
    pg_catalog.pg_trigger,pg_catalog.pg_policy,pg_catalog.pg_sequence,pg_catalog.pg_event_trigger,
    pg_catalog.pg_extension,pg_catalog.pg_rewrite,pg_catalog.pg_type,pg_catalog.pg_enum IN SHARE ROW EXCLUSIVE MODE;
  FOR entry IN SELECT namespace.nspname,relation.relname FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE relation.relkind IN ('r','p') AND relation.relpersistence<>'t'
      AND namespace.nspname<>'information_schema' AND namespace.nspname !~ '^pg_'
    ORDER BY namespace.nspname COLLATE "C",relation.relname COLLATE "C" LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',entry.nspname,entry.relname);
  END LOOP;
END $locks$;
