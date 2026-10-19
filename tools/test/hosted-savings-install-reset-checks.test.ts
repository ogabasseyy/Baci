import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hostedSavingsResetChecksSql } from './hosted-savings-install-reset-checks';
import { hostedSavingsResetDropSql } from './hosted-savings-install-reset-drop';
import { hostedSavingsResetSnapshotSql } from './hosted-savings-install-reset-snapshot';
import { buildHostedSavingsResetSql } from './hosted-savings-install-reset-sql';

test('reset does not require the missing stats extension that fresh replay will install later', () => {
  assert.doesNotMatch(
    hostedSavingsResetChecksSql,
    /extension\.extname='pg_stat_statements'|to_regclass\('extensions\.pg_stat_statements'\)|P7211/
  );
  assert.match(
    hostedSavingsResetChecksSql,
    /pg_stat_statements\.track.*IS DISTINCT FROM 'none'/
  );
});

test('accepts six reviewed public default ACL rows while keeping discarded schemas empty', () => {
  assert.match(
    hostedSavingsResetChecksSql,
    /count\(\*\) FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace\)<>6/
  );
  assert.doesNotMatch(
    hostedSavingsResetChecksSql,
    /pg_default_acl WHERE defaclnamespace IN \('public'/
  );
  assert.match(
    hostedSavingsResetChecksSql,
    /pg_default_acl WHERE defaclnamespace IN \('hosted_savings_install_private'::regnamespace,'supabase_migrations'::regnamespace\)/
  );
  assert.match(hostedSavingsResetSnapshotSql, /\('pg_default_acl','true'\)/);
  assert.match(hostedSavingsResetSnapshotSql, /to_jsonb\(row\)::text/);
});

test('both modes preserve exact default ACL catalog snapshot and retain public namespace', () => {
  const baseline = readFileSync(
    new URL(
      '../../supabase/migrations/20260418000000_baseline.sql',
      import.meta.url
    ),
    'utf8'
  );
  const rollback = buildHostedSavingsResetSql(
    baseline,
    'standard public schema'
  );
  const commit = buildHostedSavingsResetSql(
    baseline,
    'standard public schema',
    true
  );
  assert.equal(
    rollback
      .replace('ROLLBACK;', 'COMMIT;')
      .replace('reset-rehearsed-rolled-back', 'reset-committed'),
    commit
  );
  assert.doesNotMatch(rollback, /DROP SCHEMA public|ALTER DEFAULT PRIVILEGES/);
  assert.match(
    rollback,
    /recovery_before\) IS DISTINCT FROM \(SELECT value FROM pg_temp\.recovery_after/
  );
  assert.ok(rollback.indexOf('P7233') < rollback.lastIndexOf('ROLLBACK;'));
  assert.doesNotMatch(rollback, /P7211/);
});

test('retained public default ACL dependencies are recognized but never authorized for dropping', () => {
  const ownership = /DO \$ownership\$([\s\S]*?)END \$ownership\$;/.exec(
    hostedSavingsResetDropSql
  )?.[1];
  assert.ok(ownership);
  assert.match(ownership, /dependency.classid='pg_default_acl'::regclass/);
  assert.match(ownership, /dependency.refobjid='public'::regnamespace/);
  assert.match(ownership, /dependency.objsubid=0 AND dependency.refobjsubid=0/);
  assert.match(
    ownership,
    /retained.oid=dependency.objid AND retained.defaclnamespace='public'::regnamespace/
  );
  assert.match(
    ownership,
    /retained.defaclrole IN \('postgres'::regrole,'supabase_admin'::regrole\)/
  );
  assert.match(ownership, /retained.defaclobjtype IN \('S','f','r'\)/);
  assert.match(ownership, /P7204/);
  const inserts =
    hostedSavingsResetDropSql.match(/INSERT INTO recovery_owned[^;]+;/g) ?? [];
  assert.ok(inserts.length > 0);
  for (const insert of inserts) assert.doesNotMatch(insert, /pg_default_acl/);
  assert.match(
    hostedSavingsResetDropSql,
    /NOT EXISTS\(SELECT 1 FROM pg_temp.recovery_owned owned WHERE owned.classid=dropped.classid/
  );
  assert.match(hostedSavingsResetDropSql, /P7203/);
});
