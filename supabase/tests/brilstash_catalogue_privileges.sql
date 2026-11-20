-- Run against the replayed schema. The disposable fixture also includes this
-- suite after applying the same migrations.
DO $$
DECLARE reader oid := 'public.read_brilstash_page(text,integer,integer,numeric)'::regprocedure;
DECLARE relation record;
DECLARE routine record;
DECLARE app_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = reader AND p.prosecdef AND r.rolname = 'baci_brilstash_reader'
      AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls
  ) THEN RAISE EXCEPTION 'BrilStash reader does not have a restricted owner'; END IF;

  IF has_schema_privilege('baci_brilstash_reader', 'public', 'CREATE')
    OR has_schema_privilege('baci_brilstash_reader', 'private', 'CREATE')
  THEN RAISE EXCEPTION 'BrilStash reader retained schema CREATE after migration replay'; END IF;

  FOR relation IN
    SELECT c.oid, c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private' AND c.relname LIKE 'brilstash_%' AND c.relkind = 'r'
  LOOP
    IF NOT relation.relrowsecurity THEN RAISE EXCEPTION 'Missing RLS on %', relation.relname; END IF;
    FOREACH app_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(app_role, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(app_role, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
      THEN RAISE EXCEPTION 'Unexpected table access for % on %', app_role, relation.relname; END IF;
    END LOOP;
  END LOOP;

  FOR routine IN
    SELECT p.oid, p.proname, p.proacl, p.proowner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%brilstash%'
  LOOP
    IF EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
      OR has_function_privilege('service_role', routine.oid, 'EXECUTE')
      OR has_function_privilege('anon', routine.oid, 'EXECUTE') IS DISTINCT FROM (routine.oid = reader)
      OR has_function_privilege('authenticated', routine.oid, 'EXECUTE') IS DISTINCT FROM (routine.oid <> reader)
    THEN RAISE EXCEPTION 'Unexpected EXECUTE exposure for %', routine.proname; END IF;
  END LOOP;

  IF public.read_brilstash_page(repeat('0', 43), 1, 100, 0) IS DISTINCT FROM '{"status":"ingress_unavailable"}'::jsonb
  THEN RAISE EXCEPTION 'An unrecognized credential received a catalogue verdict'; END IF;
END $$;
