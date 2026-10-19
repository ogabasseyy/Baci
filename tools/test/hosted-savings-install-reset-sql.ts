import { hostedSavingsResetChecksSql } from './hosted-savings-install-reset-checks';
import { hostedSavingsResetDropSql } from './hosted-savings-install-reset-drop';
import { hostedSavingsResetPrefix } from './hosted-savings-install-reset-prefix';
import { hostedSavingsResetSnapshotSql } from './hosted-savings-install-reset-snapshot';
import { hostedSavingsInstallSql } from './hosted-savings-install-sql';

export function buildHostedSavingsResetSql(baseline: string, publicComment: string | null, commit = false) {
  const prefix = hostedSavingsResetPrefix(baseline);
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const expected = prefix.functions.map((entry) => `(${literal(entry.signature)},'${entry.bodyMd5}')`).join(',\n');
  const comment = publicComment === null ? 'NULL' : literal(publicComment);
  return `BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='240s';
SET LOCAL lock_timeout='5s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL client_min_messages=error;
${hostedSavingsInstallSql.maintenance}
DO $identity$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>'7685172624138473505'
   OR current_setting('session_replication_role')<>'origin'
   OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend')
 THEN RAISE EXCEPTION 'Recovery cluster or maintenance mismatch' USING ERRCODE='P7230'; END IF;
 IF obj_description('public'::regnamespace,'pg_namespace') IS DISTINCT FROM ${comment}
 THEN RAISE EXCEPTION 'Public comment review mismatch' USING ERRCODE='P7231'; END IF;
 IF NOT pg_try_advisory_xact_lock(7230,1) THEN RAISE EXCEPTION 'Recovery lock held' USING ERRCODE='P7232'; END IF;
END $identity$;
${prefix.orders}
CREATE TEMP TABLE recovery_expected_functions(signature text PRIMARY KEY,body_md5 text NOT NULL);
INSERT INTO recovery_expected_functions VALUES ${expected};
${hostedSavingsResetChecksSql}
${hostedSavingsResetSnapshotSql}
CREATE TEMP TABLE recovery_before AS SELECT pg_temp.recovery_snapshot() AS value;
${hostedSavingsResetDropSql}
CREATE TEMP TABLE recovery_after AS SELECT pg_temp.recovery_snapshot() AS value;
DO $preserve$ BEGIN
 IF (SELECT value FROM pg_temp.recovery_before) IS DISTINCT FROM (SELECT value FROM pg_temp.recovery_after)
 THEN RAISE EXCEPTION 'Current managed state changed; reset rejected' USING ERRCODE='P7233'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace)
   OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace)
   OR EXISTS(SELECT 1 FROM pg_type WHERE typnamespace='public'::regnamespace)
   OR to_regnamespace('hosted_savings_install_private') IS NOT NULL OR to_regnamespace('supabase_migrations') IS NOT NULL
 THEN RAISE EXCEPTION 'Incomplete owned reset' USING ERRCODE='P7234'; END IF;
END $preserve$;
${hostedSavingsInstallSql.maintenance}
SELECT jsonb_build_object('currentManagedSha256',encode(sha256(convert_to((SELECT value::text FROM pg_temp.recovery_before),'UTF8')),'hex'),'preserved',true);
${commit ? 'COMMIT' : 'ROLLBACK'};
SELECT jsonb_build_object('status','${commit ? 'reset-committed' : 'reset-rehearsed-rolled-back'}');
`;
}
