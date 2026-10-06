DO $boundary$
BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres' OR current_user <> 'postgres'
     OR inet_client_addr() IS NOT NULL OR current_setting('server_version_num') <> '170006'
     OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Managed prerequisites database boundary denied';
  END IF;
  IF (SELECT system_identifier::text FROM pg_control_system()) <> current_setting('baci.expected_system_identifier') THEN
    RAISE EXCEPTION 'Managed prerequisites cluster identity mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_settings WHERE name = 'cron.launch_active_jobs'
                 AND setting = 'off' AND source = 'command line' AND NOT pending_restart)
     OR NOT EXISTS (SELECT 1 FROM pg_settings WHERE name = 'pg_net.database_name'
                    AND setting = 'baci_disabled_background' AND source = 'command line' AND NOT pending_restart)
     OR EXISTS (SELECT 1 FROM pg_database WHERE datname = 'baci_disabled_background') THEN
    RAISE EXCEPTION 'Parent startup background containment is required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid()
             AND (backend_type = 'client backend' OR (backend_type ILIKE '%pg_net%' AND datname IS NOT NULL))) THEN
    RAISE EXCEPTION 'Stop application clients before managed prerequisites';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled <> 'D' AND evtname NOT IN ('issue_pg_cron_access','issue_pg_net_access')) THEN
    RAISE EXCEPTION 'Enabled event triggers require separate review';
  END IF;
  IF to_regnamespace('supabase_migrations') IS NOT NULL
     OR to_regnamespace('hosted_savings_install_private') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname LIKE 'piggyvest_%' OR nspname = 'savings_draft_private')
     OR EXISTS (SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'public' AND relation.relkind IN ('r','p','v','m','S')
                  AND NOT EXISTS (SELECT 1 FROM pg_depend WHERE classid = 'pg_class'::regclass AND objid = relation.oid AND deptype = 'e')) THEN
    RAISE EXCEPTION 'Baci schema must remain uninstalled';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.jwt()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'Official GoTrue Auth prerequisites must already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin']) required(name)
             WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = required.name)) THEN
    RAISE EXCEPTION 'Official base roles missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baci_storage_initializer' AND rolcanlogin) THEN
    RAISE EXCEPTION 'Storage initializer must be NOLOGIN';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('baci-official-managed-prerequisites', 0)) THEN
    RAISE EXCEPTION 'Managed prerequisite installation already in progress';
  END IF;
END
$boundary$;
