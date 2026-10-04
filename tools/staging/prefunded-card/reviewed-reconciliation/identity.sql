DO $identity$ BEGIN
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
    OR current_database() IS DISTINCT FROM 'postgres' OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR current_setting('transaction_isolation')<>'read committed'
    OR current_setting('session_replication_role')<>'origin' THEN
    RAISE EXCEPTION 'reviewed physical owner identity refused' USING ERRCODE='42501';
  END IF;
END $identity$;
DO $locks$ DECLARE entry record; BEGIN
  FOR entry IN SELECT namespace.nspname,relation.relname FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE relation.relkind IN ('r','p') AND namespace.nspname<>'information_schema'
      AND namespace.nspname !~ '^pg_' ORDER BY namespace.nspname,relation.relname LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',entry.nspname,entry.relname);
  END LOOP;
END $locks$;
