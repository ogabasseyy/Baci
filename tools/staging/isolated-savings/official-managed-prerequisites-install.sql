DO $fresh$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL OR to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Existing managed objects require verify or explicit recovery review';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace IN (to_regnamespace('realtime'),to_regnamespace('graphql_public')))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace IN (to_regnamespace('realtime'),to_regnamespace('graphql_public'))) THEN
    RAISE EXCEPTION 'Nonempty managed schemas cannot be adopted';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['uuid-ossp','pgcrypto','pg_trgm','vector','pg_net','pg_cron','supabase_vault','pg_stat_statements']) required(name)
             WHERE NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = required.name))
     OR EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'supabase_vault' AND default_version = '0.2.8') THEN
    RAISE EXCEPTION 'Required official image extension packages unavailable';
  END IF;
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM vault.secrets) THEN RAISE EXCEPTION 'Vault must be empty'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_realtime_admin'
             AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Existing Realtime role requires review';
  END IF;
END
$fresh$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE SCHEMA IF NOT EXISTS graphql_public;
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_realtime_admin') THEN
    CREATE ROLE supabase_realtime_admin WITH NOINHERIT NOLOGIN NOREPLICATION;
  END IF;
END
$role$;
CREATE SCHEMA IF NOT EXISTS realtime AUTHORIZATION supabase_realtime_admin;
GRANT USAGE ON SCHEMA realtime TO postgres, anon, authenticated, service_role;
DO $publication$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');
  END IF;
END
$publication$;
