DO $statistics$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_settings WHERE name = 'pg_stat_statements.track' AND setting = 'none'
                 AND reset_val = 'none' AND source IN ('command line','configuration file') AND NOT pending_restart)
     OR NOT EXISTS (SELECT 1 FROM pg_settings WHERE name = 'pg_stat_statements.track_utility' AND setting = 'off'
                    AND reset_val = 'off' AND source IN ('command line','configuration file') AND NOT pending_restart) THEN
    RAISE EXCEPTION 'Persistent pg_stat_statements tracking disablement required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements' AND default_version = '1.11') THEN
    RAISE EXCEPTION 'Pinned PG17 pg_stat_statements 1.11 package required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
             AND (extnamespace <> 'extensions'::regnamespace OR extversion <> '1.11')) THEN
    RAISE EXCEPTION 'Existing pg_stat_statements namespace or version mismatch';
  END IF;
END
$statistics$;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions VERSION '1.11';
DO $statistics_verify$
BEGIN
  IF to_regclass('extensions.pg_stat_statements') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_depend dependency JOIN pg_extension extension ON extension.oid = dependency.refobjid
     WHERE dependency.classid = 'pg_class'::regclass AND dependency.objid = 'extensions.pg_stat_statements'::regclass
       AND dependency.deptype = 'e' AND extension.extname = 'pg_stat_statements') THEN
    RAISE EXCEPTION 'Official extensions.pg_stat_statements view missing';
  END IF;
  PERFORM 1 FROM extensions.pg_stat_statements_info LIMIT 1;
END
$statistics_verify$;
