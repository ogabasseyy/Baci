import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { officialManagedPrerequisites } from './official-managed-prerequisites.mjs';

const options = {
  systemIdentifier: '7685278991450460171',
  schemaOnlyReviewed: true,
};

test('renders one atomic schema-only transaction with guards before all persistent DDL', () => {
  const result = officialManagedPrerequisites(options);
  assert.equal(result.launchReady, false);
  assert.equal(result.realtimeOperational, false);
  assert.ok(
    result.sql.indexOf('DO $boundary$') <
      result.sql.indexOf('ALTER EVENT TRIGGER')
  );
  assert.ok(
    result.sql.indexOf('ALTER EVENT TRIGGER') <
      result.sql.indexOf('\nCREATE EXTENSION')
  );
  assert.ok(
    result.sql.indexOf('Auth, Storage or existing roles changed') <
      result.sql.indexOf('COMMIT;')
  );
  assert.doesNotMatch(
    result.sql,
    /CREATE (?:OR REPLACE )?FUNCTION auth\.|CREATE (?:OR REPLACE )?FUNCTION realtime\.send/i
  );
  assert.doesNotMatch(
    result.sql,
    /ALTER SYSTEM|SET(?: LOCAL)? (?:cron\.|pg_net\.)|CREATE EXTENSION.*pg_graphql/
  );
  assert.match(result.sql, /source = 'command line'/);
  assert.match(
    result.sql,
    /pg_database WHERE datname = 'baci_disabled_background'/
  );
  assert.match(
    result.sql,
    /ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY/
  );
  assert.match(result.sql, /pg_graphql extension is not enabled/);
});

test('rejects missing review and malformed cluster identities', () => {
  for (const input of [
    undefined,
    {},
    { ...options, schemaOnlyReviewed: false },
    { ...options, systemIdentifier: "1'; COMMIT;--" },
    {
      ...options,
      systemIdentifier:
        'd1415bfab2fe6c830132e59cfea013acb3d612ce63736259fcf712e806ce8013',
    },
  ]) {
    assert.throws(() => officialManagedPrerequisites(input));
  }
});

test('CLI render ignores ambient PG secrets and disallows TCP and unknown options', () => {
  const cli = new URL(
    './official-managed-prerequisites-cli.mjs',
    import.meta.url
  );
  const base = [
    '--system-identifier',
    options.systemIdentifier,
    '--schema-only-reviewed',
  ];
  const result = spawnSync(process.execPath, [cli.pathname, '--sql', ...base], {
    encoding: 'utf8',
    env: {
      PGHOST: 'production.invalid',
      PGPASSWORD: 'synthetic-secret',
      PGOPTIONS: '-c cron.launch_active_jobs=on',
    },
  });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /production.invalid|synthetic-secret/);
  for (const args of [
    ['--apply', ...base, '--socket', 'production.invalid'],
    ['--sql', ...base, '--force'],
  ]) {
    assert.equal(
      spawnSync(process.execPath, [cli.pathname, ...args]).status,
      1
    );
  }
});

test('both reviewed official triggers require exact definitions and only named disables', () => {
  const body = readFileSync(
    new URL('./official-managed-prerequisites-triggers.sql', import.meta.url),
    'utf8'
  );
  assert.match(body, /5636ee89b1f4b7407f1712359246679f/);
  assert.match(body, /bc1b71101065a4eb19818ad9cd71a8bd/);
  assert.match(body, /Unreviewed event trigger definition/);
  assert.match(body, /proconfig IS NOT NULL/);
});
