const maintenance = `
DO $guard$ BEGIN
 IF current_database() <> 'postgres' OR session_user <> 'postgres' OR inet_client_addr() IS NOT NULL
   OR current_setting('server_version_num') <> '170006' THEN RAISE EXCEPTION 'Installer database boundary denied' USING ERRCODE='P7101'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
   AND backend_type='client backend') THEN RAISE EXCEPTION 'Application activity present' USING ERRCODE='P7102'; END IF;
 IF current_setting('cron.launch_active_jobs',true) IS DISTINCT FROM 'off'
   OR current_setting('pg_net.database_name',true) IS NULL
   OR current_setting('pg_net.database_name',true)=current_database()
   OR EXISTS(SELECT 1 FROM pg_database WHERE datname=current_setting('pg_net.database_name',true))
   THEN RAISE EXCEPTION 'Background execution is not contained' USING ERRCODE='P7103'; END IF;
 IF to_regclass('vault.secrets') IS NULL THEN RAISE EXCEPTION 'Vault prerequisite missing' USING ERRCODE='P7104'; END IF;
 IF EXISTS(SELECT 1 FROM vault.secrets) THEN RAISE EXCEPTION 'Vault must be empty' USING ERRCODE='P7105'; END IF;
 IF EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') THEN RAISE EXCEPTION 'Event triggers require review' USING ERRCODE='P7106'; END IF;
END $guard$;
`;
const snapshot = `
CREATE TEMP TABLE install_auth_snapshot(value jsonb);
DO $snapshot$ DECLARE item record; row_hash text; rows jsonb='{}'; BEGIN
 FOR item IN SELECT relname FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace
   WHERE nspname='auth' AND relkind IN ('r','p') ORDER BY relname LOOP
   EXECUTE format('SELECT md5(COALESCE(string_agg(row_to_json(source)::text,chr(10) ORDER BY row_to_json(source)::text),'''')) FROM auth.%I source',item.relname) INTO row_hash;
   rows:=rows || jsonb_build_object(item.relname,row_hash);
 END LOOP;
 INSERT INTO install_auth_snapshot SELECT jsonb_build_object('data',rows,
   'roles',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(role_row) ORDER BY rolname)::text,'')) FROM pg_roles role_row
     WHERE rolname IN ('postgres','anon','authenticated','service_role','authenticator') OR rolname LIKE 'supabase_%'),
   'principals',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',rolname,'oid',oid::bigint,'superuser',rolsuper,'bypassRls',rolbypassrls,
      'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'login',rolcanlogin) ORDER BY rolname),'[]') FROM pg_roles),
   'memberships',(SELECT COALESCE(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),
      'grantor',pg_get_userbyid(grantor),'adminOption',admin_option,'inheritOption',inherit_option,'setOption',set_option)
      ORDER BY roleid,member),'[]') FROM pg_auth_members),
   'schema',(SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(relname,relowner,relacl) ORDER BY relname)::text,''))
      FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace WHERE nspname='auth'));
END $snapshot$;
SELECT value::text FROM install_auth_snapshot;
`;
const fresh = `
DO $fresh$ BEGIN
 IF to_regnamespace('hosted_savings_install_private') IS NOT NULL OR to_regnamespace('supabase_migrations') IS NOT NULL
   THEN RAISE EXCEPTION 'Existing installer or migration ledger; resume forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
   WHERE namespace.nspname='public' AND relation.relkind IN ('r','p','v','m','S')
   AND NOT EXISTS(SELECT 1 FROM pg_depend WHERE classid='pg_class'::regclass AND objid=relation.oid AND deptype='e'))
   THEN RAISE EXCEPTION 'Public Baci schema is not empty'; END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname LIKE 'piggyvest_%' OR nspname='savings_draft_private')
   THEN RAISE EXCEPTION 'Canonical schema already present'; END IF;
 IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL
   OR to_regprocedure('auth.jwt()') IS NULL OR to_regclass('storage.objects') IS NULL
   OR to_regclass('storage.buckets') IS NULL OR to_regprocedure('storage.foldername(text)') IS NULL
   OR to_regclass('realtime.messages') IS NULL OR to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') IS NULL
   THEN RAISE EXCEPTION 'Managed schema prerequisites missing'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['uuid-ossp','pgcrypto','pg_trgm','vector','pg_net','pg_cron']) required(name)
   WHERE NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname=required.name))
   THEN RAISE EXCEPTION 'Extension prerequisites missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_extension extension JOIN pg_depend dependency
   ON dependency.refclassid='pg_extension'::regclass AND dependency.refobjid=extension.oid
   AND dependency.classid='pg_class'::regclass AND dependency.deptype='e'
   WHERE extension.extname='pg_stat_statements' AND dependency.objid=to_regclass('extensions.pg_stat_statements'))
   THEN RAISE EXCEPTION 'Official extensions.pg_stat_statements prerequisite missing' USING ERRCODE='P7110'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['query','userid','calls','total_exec_time','mean_exec_time','max_exec_time',
   'min_exec_time','stddev_exec_time','rows','shared_blks_hit','shared_blks_read']) required(name)
   WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('extensions.pg_stat_statements')
   AND attname=required.name AND attnum>0 AND NOT attisdropped))
   THEN RAISE EXCEPTION 'Statement statistics prerequisite columns missing' USING ERRCODE='P7111'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin']) required(name)
   WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=required.name)) THEN RAISE EXCEPTION 'Role prerequisite missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='payment_control_plane') THEN RAISE EXCEPTION 'Control-plane role conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN RAISE EXCEPTION 'Realtime publication missing'; END IF;
END $fresh$;
`;
const initialize = `
BEGIN;
CREATE SCHEMA hosted_savings_install_private;
REVOKE ALL ON SCHEMA hosted_savings_install_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE hosted_savings_install_private.journal(ordinal integer PRIMARY KEY, source text NOT NULL, sha256 text NOT NULL, completed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE hosted_savings_install_private.journal ENABLE ROW LEVEL SECURITY;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[], name text);
REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
`;

export const hostedSavingsInstallSql = {
  maintenance,
  fresh,
  snapshot,
  initialize,
};
