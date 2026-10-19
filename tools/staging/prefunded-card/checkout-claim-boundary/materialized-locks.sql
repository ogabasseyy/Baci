DO $materialized_locks$
DECLARE entry record; expected jsonb; actual jsonb; row_pin jsonb;
BEGIN
  SELECT evidence INTO STRICT expected FROM pg_temp.cb_expected;
  SELECT evidence INTO STRICT actual FROM pg_temp.cb_snapshot;
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
    OR expected->'identity'->>'sessionUser' IS DISTINCT FROM session_user
    OR expected->'identity'->>'currentUser' IS DISTINCT FROM current_user
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR (expected->>'capturedAt')::timestamptz>clock_timestamp()
    OR clock_timestamp()-(expected->>'capturedAt')::timestamptz>interval '300 seconds'
    OR (actual-'capturedAt') IS DISTINCT FROM (expected-'capturedAt')
    OR actual->'unsupportedRelations' IS DISTINCT FROM '[]'::jsonb
    OR EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D')
    OR EXISTS (SELECT 1 FROM (VALUES ('pg_catalog.pg_class'::regclass),
      ('pg_catalog.pg_namespace'::regclass),('pg_catalog.pg_authid'::regclass)) catalog(relation)
      WHERE NOT EXISTS (SELECT 1 FROM pg_locks held WHERE held.pid=pg_backend_pid()
        AND held.locktype='relation' AND held.relation=catalog.relation
        AND held.mode='ShareRowExclusiveLock' AND held.granted)) THEN
    RAISE EXCEPTION 'claim boundary materialized preflight refused' USING ERRCODE='55000';
  END IF;
  FOR entry IN SELECT relation.oid,relation.relowner,relation.relispopulated,
    namespace.nspname,relation.relname,pg_get_userbyid(relation.relowner) owner_name
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE relation.relkind='m' AND relation.relpersistence<>'t'
      AND namespace.nspname<>'information_schema' AND namespace.nspname !~ '^pg_'
    ORDER BY namespace.nspname COLLATE "C",relation.relname COLLATE "C" LOOP
    row_pin:=expected->'tableRows'->format('%I.%I',entry.nspname,entry.relname);
    IF row_pin->>'kind' IS DISTINCT FROM 'm'
      OR (row_pin->>'oid')::oid IS DISTINCT FROM entry.oid
      OR (row_pin->>'ownerOid')::oid IS DISTINCT FROM entry.relowner
      OR row_pin->>'owner' IS DISTINCT FROM entry.owner_name
      OR (row_pin->>'populated')::boolean IS DISTINCT FROM entry.relispopulated THEN
      RAISE EXCEPTION 'claim boundary materialized owner or state differs' USING ERRCODE='55000';
    END IF;
    EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I',
      entry.nspname,entry.relname,entry.owner_name);
    IF NOT EXISTS (SELECT 1 FROM pg_locks held WHERE held.pid=pg_backend_pid()
      AND held.locktype='relation' AND held.relation=entry.oid
      AND held.mode='AccessExclusiveLock' AND held.granted) THEN
      RAISE EXCEPTION 'claim boundary materialized lock missing' USING ERRCODE='55000';
    END IF;
  END LOOP;
END $materialized_locks$;
