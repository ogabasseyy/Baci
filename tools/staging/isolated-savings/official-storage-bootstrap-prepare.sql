\set ON_ERROR_STOP on
\getenv storage_password ISOLATED_STORAGE_DB_PASSWORD
BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL log_parameter_max_length_on_error = 0;
SET LOCAL statement_timeout = '15s';
SELECT set_config('baci.storage_password', :'storage_password', true) IS NOT NULL AS secret_supplied;
DO $bootstrap$
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version_num')::int <> 170006 THEN
    RAISE EXCEPTION 'Unexpected staging database version';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('baci-official-storage-bootstrap', 0)) THEN
    RAISE EXCEPTION 'Storage bootstrap already in progress';
  END IF;
  IF current_setting('baci.storage_password') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Distinct secure Storage password required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baci_storage_initializer') THEN
    RAISE EXCEPTION 'Initializer already exists; explicit recovery review required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin' AND rolcanlogin) THEN
    RAISE EXCEPTION 'Existing Storage role guard differs';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = to_regnamespace('storage'))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = to_regnamespace('storage'))
     OR EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = to_regnamespace('storage')) THEN
    RAISE EXCEPTION 'Storage schema is not empty; refusing adoption';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres')) <> 4 THEN
    RAISE EXCEPTION 'Official base roles missing';
  END IF;
  CREATE ROLE baci_storage_initializer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
  EXECUTE format('ALTER ROLE baci_storage_initializer PASSWORD %L', current_setting('baci.storage_password'));
  GRANT CONNECT ON DATABASE postgres TO baci_storage_initializer;
  IF to_regnamespace('storage') IS NULL THEN
    CREATE SCHEMA storage AUTHORIZATION baci_storage_initializer;
  ELSE
    ALTER SCHEMA storage OWNER TO baci_storage_initializer;
  END IF;
  ALTER ROLE baci_storage_initializer SET search_path = storage, pg_catalog;
  IF has_database_privilege('baci_storage_initializer', 'postgres', 'CREATE') THEN
    RAISE EXCEPTION 'Initializer unexpectedly has database CREATE permission';
  END IF;
END
$bootstrap$;
COMMIT;
