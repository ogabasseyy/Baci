-- Applied after upload, private preview and snapshot migrations in the full fixture.
DO $$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['experience_source_heads','experience_preview_bindings','experience_snapshots'] LOOP
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||n)::regclass) THEN RAISE EXCEPTION 'RLS missing: %',n; END IF;
 IF has_table_privilege('authenticated','public.'||n,'INSERT') OR has_table_privilege('anon','public.'||n,'SELECT') OR has_table_privilege('service_role','public.'||n,'SELECT') THEN RAISE EXCEPTION 'unsafe direct grants: %',n; END IF;
 END LOOP;
END $$;
