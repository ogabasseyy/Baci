DO $$
DECLARE namespace record; relation record; routine record; caller text;
  total_schemas integer := 0; total_tables integer := 0; total_functions integer := 0;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='piggyvest_full_probe'
    AND (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole OR rolcreatedb))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='piggyvest_full_probe'::regrole)
    THEN RAISE EXCEPTION 'probe role has elevated authority'; END IF;
  FOR namespace IN SELECT oid,nspname,nspacl,nspowner FROM pg_namespace
    WHERE nspname ~ '^piggyvest_' LOOP
    total_schemas := total_schemas+1;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce(namespace.nspacl,acldefault('n',namespace.nspowner))) WHERE grantee=0)
      THEN RAISE EXCEPTION 'PUBLIC schema grant: %',namespace.nspname; END IF;
    FOREACH caller IN ARRAY ARRAY['anon','authenticated','service_role','piggyvest_full_probe'] LOOP
      IF has_schema_privilege(caller,namespace.oid,'USAGE,CREATE') THEN
        RAISE EXCEPTION 'unexpected schema privilege: % %',caller,namespace.nspname;
      END IF;
    END LOOP;
    FOR relation IN SELECT oid,relname,relrowsecurity,relacl,relowner FROM pg_class
      WHERE relnamespace=namespace.oid AND relkind IN ('r','p') LOOP
      total_tables := total_tables+1;
      IF NOT relation.relrowsecurity THEN RAISE EXCEPTION 'missing RLS: %',relation.relname; END IF;
      IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=relation.oid
        AND (pg_get_expr(polqual,polrelid) IS DISTINCT FROM 'false'
          OR pg_get_expr(polwithcheck,polrelid) IS DISTINCT FROM 'false')) THEN
        RAISE EXCEPTION 'unexpected RLS policy requires review: %',relation.relname;
      END IF;
      IF EXISTS(SELECT 1 FROM aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) WHERE grantee=0)
        THEN RAISE EXCEPTION 'PUBLIC table grant: %',relation.relname; END IF;
      FOREACH caller IN ARRAY ARRAY['anon','authenticated','service_role','piggyvest_full_probe'] LOOP
        IF has_table_privilege(caller,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
          RAISE EXCEPTION 'unexpected table privilege: % %',caller,relation.relname;
        END IF;
      END LOOP;
    END LOOP;
    FOR routine IN SELECT oid,proname,proacl,proowner,prosecdef,proconfig FROM pg_proc WHERE pronamespace=namespace.oid LOOP
      total_functions := total_functions+1;
      IF routine.prosecdef AND NOT coalesce(routine.proconfig @> ARRAY['search_path=pg_catalog'],false)
        THEN RAISE EXCEPTION 'unsafe definer search_path: %',routine.proname; END IF;
      IF EXISTS(SELECT 1 FROM aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) WHERE grantee=0)
        THEN RAISE EXCEPTION 'PUBLIC routine grant: %',routine.proname; END IF;
      FOREACH caller IN ARRAY ARRAY['anon','authenticated','service_role','piggyvest_full_probe'] LOOP
        IF has_function_privilege(caller,routine.oid,'EXECUTE') THEN
          RAISE EXCEPTION 'unexpected routine privilege: % %',caller,routine.proname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('piggyvest_staging','piggyvest_savings_ledger','piggyvest_goal_policy'))<>3
    OR total_tables=0 OR total_functions=0 THEN RAISE EXCEPTION 'incomplete replay'; END IF;
  RAISE NOTICE 'PASS private schemas=% tables=% routines=%; RLS and denied PUBLIC/anon/authenticated/service_role/probe ACLs',total_schemas,total_tables,total_functions;
END $$;
INSERT INTO piggyvest_staging.integrations(id,expected_provider_account_id)
  VALUES('40000000-0000-4000-8000-000000000001','synthetic-full-replay');
DO $$ BEGIN
  IF (SELECT enabled FROM piggyvest_staging.integrations WHERE id='40000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'registry enabled by default';
  END IF;
END $$;
SET LOCAL ROLE piggyvest_full_probe;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM piggyvest_staging.integrations;
    RAISE EXCEPTION 'ungranted probe read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_savings_ledger.snapshot(NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid);
    RAISE EXCEPTION 'ungranted probe RPC succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
GRANT USAGE ON SCHEMA piggyvest_staging TO piggyvest_full_probe;
GRANT SELECT ON piggyvest_staging.integrations TO piggyvest_full_probe;
SET LOCAL ROLE piggyvest_full_probe;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM piggyvest_staging.integrations) THEN RAISE EXCEPTION 'RLS leaked fixture row'; END IF;
END $$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION piggyvest_staging.enqueue_inbox(uuid,text,bytea) TO piggyvest_full_probe;
SET LOCAL ROLE piggyvest_full_probe;
DO $$ BEGIN
  BEGIN
    PERFORM piggyvest_staging.enqueue_inbox('40000000-0000-4000-8000-000000000001','synthetic-event',decode('7b7d','hex'));
    RAISE EXCEPTION 'disabled integration enqueue succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'inactive staging integration' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
UPDATE piggyvest_staging.integrations SET enabled=true WHERE id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE piggyvest_full_probe;
DO $$
DECLARE outcome text;
BEGIN
  SELECT entry.outcome INTO outcome FROM piggyvest_staging.enqueue_inbox(
    '40000000-0000-4000-8000-000000000001','synthetic-event',decode('7b7d','hex')) entry;
  IF outcome<>'accepted' THEN RAISE EXCEPTION 'synthetic enqueue failed'; END IF;
  SELECT entry.outcome INTO outcome FROM piggyvest_staging.enqueue_inbox(
    '40000000-0000-4000-8000-000000000001','synthetic-event',decode('7b7d','hex')) entry;
  IF outcome<>'duplicate' THEN RAISE EXCEPTION 'synthetic replay failed'; END IF;
END $$;
RESET ROLE;
