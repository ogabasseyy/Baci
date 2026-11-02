import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const group = [
  '20261102060000_probe_pod_order_idempotency_hash',
  '20261102061500_align_pod_whitespace_classification',
  '20261102063000_harden_pod_replay_bounds',
  '20261102064500_scope_pod_replay_probe',
];
const predecessor = { version: '20261101071733', name: 'enforce_merchant_pay_on_delivery_policy' };
const correction = { version: '20261101071734', name: 'harden_initial_pod_trigger' };

function run(script, history = '') {
  return spawnSync('bash', ['-e', '-c', script], {
    cwd: root, encoding: 'utf8', env: { ...process.env, POD_TEST_HISTORY: history },
  });
}

test('POD probe creation and scoping are one atomic migration group', () => {
  const result = run(`source .github/scripts/deferred-production-migrations.sh
    cursor='${group[0]}'
    printf '%s\n' "$cursor"
    while next="$(atomic_migration_group_next_base "$cursor")"; do printf '%s\n' "$next"; cursor="$next"; done`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), group);
});

test('POD migration preflight rejects partial history', () => {
  const script = `source .github/scripts/deferred-production-migrations.sh
    verify_pod_replay_migration_history "$POD_TEST_HISTORY" supabase/migrations`;
  assert.equal(run(script).status, 0);
  const partial = `${group[0].slice(0,14)}\t${group[0].slice(15)}`;
  const partialResult = run(script, partial);
  assert.notEqual(partialResult.status, 0);
  assert.match(partialResult.stderr, /incomplete POD replay migration files or history/);
  const complete = [ `${predecessor.version}\t${predecessor.name}`, ...group.map((name) => `${name.slice(0,14)}\t${name.slice(15)}`) ].join('\n');
  assert.equal(run(script, complete).status, 0);
  const wrongName = run(script, `${group[0].slice(0,14)}\twrong_name`);
  assert.notEqual(wrongName.status, 0);
  assert.match(wrongName.stderr, /POD migration identity mismatch/);
});

test('POD migration preflight rejects an incomplete checkout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pod-migration-group-'));
  try {
    copyFileSync(join(root, 'supabase/migrations', `${group[0]}.sql`), join(directory, `${group[0]}.sql`));
    const result = spawnSync('bash', ['-e', '-c', 'source .github/scripts/deferred-production-migrations.sh; verify_pod_replay_migration_history "" "$1"', 'test', directory], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /incomplete POD replay migration files or history/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the production group helper encloses the broad grant and revocation in one transaction', () => {
  const files = group.map((name) => `supabase/migrations/${name}.sql`).join(' ');
  const result = run(`source .github/scripts/apply-atomic-migration-group.sh
    applied_count=0; applied_migrations=''
    build_register_migration_query() { printf 'SELECT 1;'; }
    api_query_payload() { printf '%s\n' "$1" | jq -c .; }
    apply_atomic_migration_group ${files}`);
  assert.equal(result.status, 0, result.stderr);
  const query = JSON.parse(result.stdout.split('\n')[0]).query;
  assert.ok(query.startsWith('BEGIN;'));
  assert.ok(query.endsWith('COMMIT;'));
  const grant = query.indexOf('TO anon, authenticated');
  const revoke = query.lastIndexOf('FROM PUBLIC, anon');
  assert.ok(grant >= 0 && revoke > grant);
});

function runApplier({ history = [], cap = '', phase = 'all', omit = '', extra = false, middle = false, failMutation = false, missingPredecessor = false, includePredecessor = false, includeCorrection = includePredecessor } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'pod-atomic-applier-'));
  try {
    const bin = join(temp, 'bin');
    const migrations = join(temp, 'migrations');
    const log = join(temp, 'queries.jsonl');
    mkdirSync(bin);
    mkdirSync(migrations);
    if (includePredecessor) {
      const name = `${predecessor.version}_${predecessor.name}.sql`;
      copyFileSync(join(root, 'supabase/migrations', name), join(migrations, name));
    }
    if (includeCorrection) {
      const name = `${correction.version}_${correction.name}.sql`;
      copyFileSync(join(root, 'supabase/migrations', name), join(migrations, name));
    }
    for (const name of group) {
      if (name !== omit) copyFileSync(join(root, 'supabase/migrations', `${name}.sql`), join(migrations, `${name}.sql`));
    }
    if (extra) writeFileSync(join(migrations, '20261102062000_unrelated.sql'), 'SELECT 42;');
    if (middle) writeFileSync(join(migrations, '20261101073101_bind_loyalty_checkout_replay_redemption.sql'), 'SELECT 42;');
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
payload="$(cat)"
jq -c . <<<"$payload" >> "$POD_TEST_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<<"$payload"; then
  printf '%s\\n' "$POD_TEST_RESPONSE"
elif [ "$POD_TEST_FAIL" = 1 ]; then
  exit 1
else
  printf '[]\\n'
fi
`, { mode: 0o700 });
    const result = spawnSync('bash', ['.github/scripts/apply-pending-migrations.sh'], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, MIGRATIONS_DIR: migrations,
        SUPABASE_ACCESS_TOKEN: 'synthetic', SUPABASE_PROJECT_REF: 'synthetic',
        POD_TEST_LOG: log, POD_TEST_RESPONSE: JSON.stringify(missingPredecessor ? history : [predecessor, correction, ...history]), POD_TEST_FAIL: failMutation ? '1' : '0',
        MIGRATION_MAX_VERSION: cap, MIGRATION_PHASE: phase,
      },
    });
    const requests = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    return { ...result, requests };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('production applier never commits a partial POD group under caps or invalid history', () => {
  for (const cap of group.slice(0, -1).map((name) => name.slice(0, 14))) {
    const result = runApplier({ cap, phase: 'predeploy' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.requests.length, 1);
  }
  for (let count = 1; count < group.length; count++) {
    const history = group.slice(0, count).map((name) => ({ version: name.slice(0,14), name: name.slice(15) }));
    const result = runApplier({ history });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /incomplete POD replay migration files or history/);
    assert.equal(result.requests.length, 1);
  }
  for (const [options, reason] of [
    [{ omit: group[2] }, /incomplete POD replay migration files or history/],
    [{ extra: true }, /unexpected migration within POD atomic group/],
    [{ missingPredecessor: true }, /POD enforcement predecessor is missing/],
    [{ missingPredecessor: true, history: [{ version: predecessor.version, name: 'wrong' }] }, /POD enforcement migration identity mismatch/],
    [{ missingPredecessor: true, includePredecessor: true, history: group.map((name) => ({ version: name.slice(0,14), name: name.slice(15) })) }, /POD enforcement predecessor is missing/],
    [{ missingPredecessor: true, includePredecessor: true, history: [correction] }, /initial POD hardening is recorded without its predecessor/],
    [{ missingPredecessor: true, history: [predecessor] }, /initial POD hardening migration is missing/],
    [{ missingPredecessor: true, includePredecessor: true, includeCorrection: false }, /initial POD hardening migration is missing/],
  ]) {
    const result = runApplier(options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, reason);
    assert.equal(result.requests.length, 1);
  }
});

test('production applier submits complete POD group in one transaction and fails on API error', () => {
  for (const failMutation of [false, true]) {
    const result = runApplier({ cap: group.at(-1).slice(0,14), phase: 'predeploy', failMutation });
    assert.equal(result.status === 0, !failMutation, result.stderr);
    assert.equal(result.requests.length, 2);
    const query = result.requests[1].query;
    assert.ok(query.startsWith('BEGIN;') && query.endsWith('COMMIT;'));
    assert.ok(query.indexOf('TO anon, authenticated') < query.lastIndexOf('FROM PUBLIC, anon'));
    for (const name of group) assert.ok(query.includes(name.slice(0,14)));
  }
});

test('production applier installs an unrecorded predecessor before the atomic POD group', () => {
  const result = runApplier({ missingPredecessor: true, includePredecessor: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests.length, 3);
  assert.match(result.requests[1].query, /CREATE TRIGGER orders_enforce_pay_on_delivery_policy/);
  assert.match(result.requests[1].query, /harden_initial_pod_trigger/);
  assert.match(result.requests[2].query, /is_storefront_pod_order_idempotency_hash/);
});

test('the initial POD trigger and whitespace hardening are never split by a version cap', () => {
  const below = runApplier({ missingPredecessor: true, includePredecessor: true, cap: predecessor.version });
  assert.equal(below.status, 0, below.stderr);
  assert.equal(below.requests.length, 1);
  const atPair = runApplier({ missingPredecessor: true, includePredecessor: true, cap: correction.version });
  assert.equal(atPair.status, 0, atPair.stderr);
  assert.equal(atPair.requests.length, 2);
  assert.match(atPair.requests[1].query, /CREATE TRIGGER orders_enforce_pay_on_delivery_policy/);
  assert.match(atPair.requests[1].query, /harden_initial_pod_trigger/);
});

test('a previously recorded predecessor receives the adjacent hardening without reapplying it', () => {
  const result = runApplier({ missingPredecessor: true, includeCorrection: true, history: [predecessor] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests.length, 3);
  assert.doesNotMatch(result.requests[1].query, /CREATE TRIGGER orders_enforce_pay_on_delivery_policy/);
  assert.match(result.requests[1].query, /harden_initial_pod_trigger/);
});

test('retroactive initial hardening remains applicable after later POD migrations', () => {
  const history = [predecessor, { version: '20261101073101', name: 'bind_loyalty_checkout_replay_redemption' }, ...group.map((name) => ({ version: name.slice(0,14), name: name.slice(15) }))];
  const result = runApplier({ missingPredecessor: true, includeCorrection: true, history });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests.length, 2);
  assert.match(result.requests[1].query, /harden_initial_pod_trigger/);
  assert.doesNotMatch(result.requests[1].query, /CREATE TRIGGER orders_enforce_pay_on_delivery_policy/);
});

test('unrelated intervening migrations retain their chronological order', () => {
  const result = runApplier({ missingPredecessor: true, includePredecessor: true, middle: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests.length, 4);
  assert.match(result.requests[1].query, /harden_initial_pod_trigger/);
  assert.match(result.requests[2].query, /SELECT 42;/);
  assert.match(result.requests[3].query, /is_storefront_pod_order_idempotency_hash/);
});
