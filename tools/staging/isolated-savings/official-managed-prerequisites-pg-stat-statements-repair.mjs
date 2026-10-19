import { readFileSync } from 'node:fs';

export function officialManagedPgStatStatementsRepair(systemIdentifier) {
  if (typeof systemIdentifier !== 'string' || !/^[1-9][0-9]{15,19}$/.test(systemIdentifier))
    throw new Error('Explicit isolated PostgreSQL system identifier required');
  const read = (name) => readFileSync(new URL(`./official-managed-prerequisites-${name}.sql`, import.meta.url), 'utf8');
  return [
    '\\set ON_ERROR_STOP on', 'BEGIN;',
    "SET LOCAL statement_timeout = '60s';", "SET LOCAL lock_timeout = '5s';",
    `DO $repair$ BEGIN
      IF current_database() <> 'postgres' OR session_user <> 'postgres' OR current_user <> 'postgres'
        OR inet_client_addr() IS NOT NULL OR current_setting('server_version_num') <> '170006'
        OR (SELECT system_identifier::text FROM pg_control_system()) <> '${systemIdentifier}'
        OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
        RAISE EXCEPTION 'Statistics repair isolated database boundary denied';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_settings WHERE name='cron.launch_active_jobs' AND setting='off' AND source='command line' AND NOT pending_restart)
        OR NOT EXISTS (SELECT 1 FROM pg_settings WHERE name='pg_net.database_name' AND setting='baci_disabled_background' AND source='command line' AND NOT pending_restart)
        OR EXISTS (SELECT 1 FROM pg_database WHERE datname='baci_disabled_background') THEN
        RAISE EXCEPTION 'Statistics repair startup containment denied';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend')
        OR EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') THEN
        RAISE EXCEPTION 'Statistics repair requires stopped clients and disabled event triggers';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname='public' AND relation.relkind IN ('r','p','v','m','S')
          AND NOT EXISTS (SELECT 1 FROM pg_depend WHERE classid='pg_class'::regclass AND objid=relation.oid AND deptype='e')) THEN
        RAISE EXCEPTION 'Statistics repair requires rolled-back empty Baci schema';
      END IF;
      IF to_regclass('realtime.messages') IS NULL OR to_regclass('vault.secrets') IS NULL
        OR to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'Statistics repair requires completed managed bootstrap';
      END IF;
      IF EXISTS (SELECT 1 FROM vault.secrets) OR EXISTS (SELECT 1 FROM cron.job) OR EXISTS (SELECT 1 FROM net.http_request_queue) THEN
        RAISE EXCEPTION 'Statistics repair requires empty Vault and background queues';
      END IF;
      IF NOT pg_try_advisory_xact_lock(hashtextextended('baci-official-managed-prerequisites',0)) THEN
        RAISE EXCEPTION 'Managed prerequisite operation in progress';
      END IF;
    END $repair$;`,
    read('snapshot'), read('pg-stat-statements'),
    `DO $preserved$ BEGIN
      IF pg_temp.managed_preserved_state() IS DISTINCT FROM (SELECT value FROM managed_preserved_snapshot) THEN
        RAISE EXCEPTION 'Auth, Storage or existing roles changed';
      END IF;
    END $preserved$;`,
    'COMMIT;', "SELECT 'pg_stat_statements repair verified; tracking disabled' AS result;",
  ].join('\n');
}
