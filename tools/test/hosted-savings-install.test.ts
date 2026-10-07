import assert from 'node:assert/strict';
import test from 'node:test';
import { installHostedSavings } from './hosted-savings-install';
import { hostedSavingsInstallSql } from './hosted-savings-install-sql';

const snapshot = (value = 'stable') =>
  JSON.stringify({
    data: { users: value },
    roles: 'stable',
    schema: 'stable',
    principals: [],
    memberships: [],
  });

function fixture() {
  const entries = [1, 2, 3].map((ordinal) => ({
    ordinal,
    stage: ordinal < 3 ? ('bootstrap' as const) : ('current-tree' as const),
    source: `supabase/migrations/2026091400000${ordinal}_fixture.sql`,
    file: `sql/${ordinal}-2026091400000${ordinal}_fixture.sql`,
    sha256: 'a'.repeat(64),
    sourceSha256: 'a'.repeat(64),
    transform: null,
    bytes: 9,
    sql: `SELECT ${ordinal};`,
  }));
  const commands: string[] = [];
  const runtime = {
    verify: async () => {},
    sql: async (sql: string) => {
      commands.push(sql);
      if (sql === hostedSavingsInstallSql.snapshot) return snapshot();
      if (
        sql.startsWith('SELECT COALESCE(jsonb_agg') &&
        sql.includes('hosted_savings_install_private.journal')
      )
        return JSON.stringify(
          entries.map((entry) => [entry.ordinal, entry.source, entry.sha256])
        );
      if (sql.startsWith('SELECT COALESCE(jsonb_agg'))
        return JSON.stringify(
          entries.slice(0, 2).map((entry) => ({
            version: /\/(\d{14})_/.exec(entry.source)?.[1],
            name: 'fixture',
          }))
        );
      return '';
    },
  };
  return {
    bundle: { manifestSha256: 'b'.repeat(64), entries },
    runtime,
    commands,
  };
}

test('preflight does not claim ledger or apply SQL', async () => {
  const { bundle, runtime, commands } = fixture();
  assert.equal(
    (await installHostedSavings(bundle, runtime)).status,
    'preflight-passed'
  );
  assert.equal(commands.length, 2);
  assert.ok(
    commands.every(
      (sql) => !sql.includes('CREATE SCHEMA hosted_savings_install_private')
    )
  );
});

test('rejects malformed baseline fingerprint before claiming fresh ledger', async () => {
  const { bundle, runtime } = fixture();
  runtime.sql = async () => '{}';
  const result = await installHostedSavings(bundle, runtime, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.claimed, false);
  assert.equal(result.completed, 0);
});

test('journals only successful files and records only bootstrap rows in Supabase ledger', async () => {
  const { bundle, runtime, commands } = fixture();
  const result = await installHostedSavings(bundle, runtime, true);
  assert.equal(result.status, 'installed');
  assert.equal(result.completed, 3);
  const journals = commands.filter(
    (sql) =>
      sql.startsWith('BEGIN; ') &&
      sql.includes('INSERT INTO hosted_savings_install_private')
  );
  assert.equal(journals.length, 3);
  assert.equal(
    journals.filter((sql) => sql.includes('INSERT INTO supabase_migrations'))
      .length,
    2
  );
  assert.ok(journals[0].includes('SELECT 1;'));
  assert.ok(commands.indexOf('SELECT 1;') < commands.indexOf(journals[0]));
});

test('stops at first SQL error with no retry, later file, successful journal or data cleanup', async () => {
  const { bundle, runtime, commands } = fixture();
  const original = runtime.sql;
  runtime.sql = async (sql) => {
    if (sql === 'SELECT 2;') throw new Error('sensitive provider text');
    return original(sql);
  };
  const result = await installHostedSavings(bundle, runtime, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.completed, 1);
  assert.equal('attemptedOrdinal' in result && result.attemptedOrdinal, 2);
  assert.ok(!commands.includes('SELECT 3;'));
  assert.doesNotMatch(JSON.stringify(result), /sensitive provider/);
});

test('preserves first baseline SQLSTATE and line across shared applier redaction without payload logs', async () => {
  const { bundle, runtime, commands } = fixture();
  const original = runtime.sql;
  runtime.sql = async (sql) => {
    if (sql === 'SELECT 1;')
      throw new Error(
        'Installer command failed SQLSTATE=42704 LINE=123 EXIT=3; output redacted'
      );
    return original(sql);
  };
  const result = await installHostedSavings(bundle, runtime, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.completed, 0);
  assert.equal(result.claimed, true);
  assert.equal('sqlstate' in result && result.sqlstate, '42704');
  assert.equal('line' in result && result.line, 123);
  assert.equal('exitCode' in result && result.exitCode, 3);
  assert.ok(!commands.includes('SELECT 2;'));
});

test('preserves SQLSTATE without a psql line and termination signal without inventing SQLSTATE', async () => {
  for (const message of [
    'Installer command failed SQLSTATE=42809 EXIT=3; output redacted',
    'Installer command failed SIGNAL=SIGTERM; output redacted',
  ]) {
    const { bundle, runtime, commands } = fixture();
    const original = runtime.sql;
    runtime.sql = async (sql) => {
      if (sql === 'SELECT 1;') throw new Error(message);
      return original(sql);
    };
    const result = await installHostedSavings(bundle, runtime, true);
    assert.equal(result.status, 'failed');
    assert.equal(result.completed, 0);
    assert.equal(result.claimed, true);
    assert.equal('resumeAllowed' in result && result.resumeAllowed, false);
    assert.ok(!commands.includes('SELECT 2;'));
    assert.ok(!('line' in result));
    if (message.includes('SQLSTATE')) {
      assert.equal('sqlstate' in result && result.sqlstate, '42809');
      assert.equal('exitCode' in result && result.exitCode, 3);
    } else {
      assert.equal('signal' in result && result.signal, 'SIGTERM');
      assert.ok(!('sqlstate' in result));
    }
  }
});

test('denies failed maintenance before writes and stops on Auth fingerprint drift', async () => {
  const first = fixture();
  first.runtime.sql = async () => {
    throw new Error('background worker active');
  };
  assert.equal(
    (await installHostedSavings(first.bundle, first.runtime, true)).claimed,
    false
  );
  const second = fixture();
  const original = second.runtime.sql;
  let snapshots = 0;
  second.runtime.sql = async (sql) =>
    sql === hostedSavingsInstallSql.snapshot
      ? snapshot(String(snapshots++))
      : original(sql);
  const result = await installHostedSavings(
    second.bundle,
    second.runtime,
    true
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.completed, 0);
  assert.equal('phase' in result && result.phase, 'auth-preservation');
});
