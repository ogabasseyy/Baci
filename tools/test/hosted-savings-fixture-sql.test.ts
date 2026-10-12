import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHostedSavingsFixtureSql } from './hosted-savings-fixture-sql';

const destination = {
  version: 1,
  project: 'baci-isolated-savings',
  service: 'postgres',
  containerId: 'a'.repeat(64),
  imageId: `sha256:${'b'.repeat(64)}`,
  dockerSocket: '/var/run/docker.sock',
  postgresSocket: '/tmp',
  database: 'postgres',
  serverVersion: 170006,
  manifestSha256: 'c'.repeat(64),
  parentReviewed: true,
  maintenance: true,
  noApplicationActivity: true,
  noExternalCredentials: true,
};
const input = {
  destination,
  systemIdentifier: '7685172624138473505',
  fixtureReviewed: true,
  installed: {
    status: 'installed',
    completed: 1,
    claimed: true,
    containerId: destination.containerId,
    imageId: destination.imageId,
    manifestSha256: destination.manifestSha256,
  },
  ownerId: '11111111-1111-4111-8111-111111111111',
  customerActorId: '22222222-2222-4222-8222-222222222222',
};
const journal = [
  [1, 'supabase/migrations/20260418000000_baseline.sql', 'd'.repeat(64)],
] as const;

test('defaults to rollback with exact identity, installed journal, collisions and official Auth preconditions', () => {
  const sql = buildHostedSavingsFixtureSql(input, journal);
  assert.ok(sql.startsWith('BEGIN;'));
  assert.ok(sql.endsWith('ROLLBACK;'));
  for (const guard of [
    'pg_control_system()',
    input.systemIdentifier,
    'session_replication_role',
    'Installed journal mismatch',
    'Fixture collision',
    'Official synthetic Auth accounts required',
    'fixture_auth_before',
    'fixture_auth_after',
    'Pending external requests',
    'cron.launch_active_jobs',
  ])
    assert.ok(sql.includes(guard), guard);
  assert.ok(
    sql.indexOf('Fixture collision') <
      sql.indexOf('INSERT INTO public.merchants')
  );
  assert.ok(
    sql.indexOf('Fixture preservation failed') < sql.lastIndexOf('ROLLBACK;')
  );
});

test('commit uses identical transaction guards and never inserts accounts, wallets, savings or enables finance', () => {
  const sql = buildHostedSavingsFixtureSql(input, journal);
  assert.equal(
    buildHostedSavingsFixtureSql(input, journal, true),
    sql.replace(/ROLLBACK;$/, 'COMMIT;')
  );
  assert.match(sql, /format\('%I=false',attname\)/);
  assert.match(sql, /entry.value='true'::jsonb/);
  assert.doesNotMatch(
    sql,
    /INSERT INTO (?:auth\.|piggyvest_|savings_draft_private|public\.(?:customer_wallets|customer_savings))/
  );
  assert.doesNotMatch(
    sql,
    /ON CONFLICT|DISABLE TRIGGER|SET ROLE|local_test|ALTER ROLE|net\.http_post/
  );
});

test('rejects incomplete journal, invalid ordering and SQL injection before rendering', () => {
  assert.throws(() => buildHostedSavingsFixtureSql(input, []));
  assert.throws(() =>
    buildHostedSavingsFixtureSql(input, [[2, journal[0][1], journal[0][2]]])
  );
  assert.throws(() =>
    buildHostedSavingsFixtureSql(input, [[1, "x'); COMMIT;", journal[0][2]]])
  );
  assert.throws(() =>
    buildHostedSavingsFixtureSql(
      { ...input, systemIdentifier: "1';COMMIT;" },
      journal
    )
  );
});

test('rejects wrong container, image, manifest, failed installation and identity collision', () => {
  for (const installed of [
    { ...input.installed, status: 'failed' },
    { ...input.installed, claimed: false },
    { ...input.installed, containerId: 'e'.repeat(64) },
    { ...input.installed, imageId: `sha256:${'e'.repeat(64)}` },
    { ...input.installed, manifestSha256: 'e'.repeat(64) },
  ])
    assert.throws(() =>
      buildHostedSavingsFixtureSql({ ...input, installed }, journal)
    );
  assert.throws(() =>
    buildHostedSavingsFixtureSql(
      { ...input, customerActorId: input.ownerId },
      journal
    )
  );
});

test('rejects remote destinations, numeric cluster identity and omitted maintenance on otherwise valid input', () => {
  assert.throws(() =>
    buildHostedSavingsFixtureSql({ ...input, systemIdentifier: 10 }, journal)
  );
  for (const patch of [
    { dockerSocket: 'ssh://staging' },
    { maintenance: false },
    { project: 'production' },
    { databaseUrl: 'postgres://remote/db' },
  ])
    assert.throws(() =>
      buildHostedSavingsFixtureSql(
        { ...input, destination: { ...destination, ...patch } },
        journal
      )
    );
});
