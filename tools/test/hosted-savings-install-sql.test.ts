import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHostedSavingsAuthPreserved } from './hosted-savings-install-auth';
import { hostedSavingsInstallSql } from './hosted-savings-install-sql';

test('requires explicit disabled cron and inert pg_net database even when services appear stopped', () => {
  assert.match(
    hostedSavingsInstallSql.maintenance,
    /cron.launch_active_jobs.*IS DISTINCT FROM 'off'/
  );
  assert.match(
    hostedSavingsInstallSql.maintenance,
    /pg_database WHERE datname=current_setting\('pg_net.database_name'/
  );
  assert.match(
    hostedSavingsInstallSql.maintenance,
    /EXISTS\(SELECT 1 FROM vault.secrets\)/
  );
  assert.match(
    hostedSavingsInstallSql.maintenance,
    /backend_type='client backend'/
  );
  assert.doesNotMatch(
    hostedSavingsInstallSql.maintenance,
    /ALTER SYSTEM|ALTER ROLE|cron.unschedule/
  );
  assert.match(
    hostedSavingsInstallSql.maintenance,
    /pg_event_trigger WHERE evtenabled<>'D'/
  );
  assert.match(hostedSavingsInstallSql.maintenance, /ERRCODE='P7106'/);
});

test('refuses existing ledger and schema and preserves Auth while journaling in private RLS table', () => {
  assert.match(
    hostedSavingsInstallSql.fresh,
    /supabase_migrations.*IS NOT NULL/
  );
  assert.match(
    hostedSavingsInstallSql.initialize,
    /journal ENABLE ROW LEVEL SECURITY/
  );
  assert.doesNotMatch(
    hostedSavingsInstallSql.initialize,
    /INSERT INTO supabase_migrations|DROP|ALTER ROLE|auth.users/
  );
  assert.match(hostedSavingsInstallSql.snapshot, /row_to_json\(source\)/);
  assert.match(hostedSavingsInstallSql.snapshot, /pg_roles/);
  assert.match(
    hostedSavingsInstallSql.snapshot,
    /'name',rolname,'oid',oid::bigint,'superuser',rolsuper/
  );
});

test('accepts numeric bootstrap OID JSON but rejects the PostgreSQL uncast string encoding', () => {
  const numeric =
    '{"data":{},"roles":"stable","schema":"stable","memberships":[],"principals":[{"name":"supabase_admin","oid":10,"superuser":true,"bypassRls":true,"createRole":true,"createDb":true,"replication":true,"login":true}]}';
  const uncast = numeric.replace('"oid":10', '"oid":"10"');
  assert.doesNotThrow(() => assertHostedSavingsAuthPreserved(numeric, numeric));
  assert.throws(() => assertHostedSavingsAuthPreserved(uncast, uncast));
  assert.throws(() => assertHostedSavingsAuthPreserved(numeric, uncast));
});

test('rejects missing or fake baseline pg_stat_statements dependency before ledger initialization', () => {
  assert.match(
    hostedSavingsInstallSql.fresh,
    /extension.extname='pg_stat_statements'/
  );
  assert.match(
    hostedSavingsInstallSql.fresh,
    /dependency.objid=to_regclass\('extensions.pg_stat_statements'\)/
  );
  assert.match(hostedSavingsInstallSql.fresh, /dependency.deptype='e'/);
  assert.match(hostedSavingsInstallSql.fresh, /ERRCODE='P7110'/);
  assert.match(hostedSavingsInstallSql.fresh, /attname=required.name/);
  assert.match(hostedSavingsInstallSql.fresh, /ERRCODE='P7111'/);
});
