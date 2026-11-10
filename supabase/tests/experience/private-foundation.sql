-- Structural assertions supplement normal-role journeys in tools/experience-sql.
DO $$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['experience_artifacts','experience_source_files','experience_jobs','experience_builds','experience_assets','experience_evidence','experience_approvals','experience_draft_heads','experience_published_heads','experience_catalog_generations','experience_build_files','experience_uploads','experience_chunks'] LOOP
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||n)::regclass) THEN RAISE EXCEPTION 'RLS missing: %',n; END IF;
 IF has_table_privilege('authenticated','public.'||n,'INSERT') OR has_table_privilege('anon','public.'||n,'SELECT') OR has_table_privilege('service_role','public.'||n,'SELECT') THEN RAISE EXCEPTION 'unsafe direct grants: %',n; END IF;
 END LOOP;
END $$;
