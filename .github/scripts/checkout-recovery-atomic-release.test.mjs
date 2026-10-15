import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const migrationNames = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.includes('_customer_checkout_shipping_recovery_'))
  .sort();
function orderedGroup() {
  const first = migrationNames[0].replace(/\.sql$/, '');
  const result = spawnSync(
    'bash',
    [
      '-e',
      '-c',
      `source .github/scripts/deferred-production-migrations.sh; cursor="$1"; printf '%s\\n' "$cursor"; while next="$(atomic_migration_group_next_base "$cursor")"; do printf '%s\\n' "$next"; cursor="$next"; done`,
      'test',
      first,
    ],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n');
}
test('all initial recovery RPC migrations and closed activation gate form one atomic group', () => {
  assert.deepEqual(
    orderedGroup(),
    migrationNames.map((name) => name.replace(/\.sql$/, ''))
  );
});
test('the production atomic-group helper commits RPC grants only together with the closed gate', () => {
  const temp = mkdtempSync(join(tmpdir(), 'baci-recovery-atomic-'));
  try {
    const files = orderedGroup().map((base) =>
      join(root, 'supabase/migrations', `${base}.sql`)
    );
    const result = spawnSync(
      'bash',
      [
        '-e',
        '-c',
        `source .github/scripts/apply-atomic-migration-group.sh; applied_count=0; applied_migrations=''; build_register_migration_query() { printf 'SELECT 1;'; }; api_query_payload() { printf '%s' "$1" > "$BACI_ATOMIC_PAYLOAD"; }; apply_atomic_migration_group "$@"`,
        'test',
        ...files,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          BACI_ATOMIC_PAYLOAD: join(temp, 'payload.json'),
        },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const { query } = JSON.parse(
      readFileSync(join(temp, 'payload.json'), 'utf8')
    );
    assert.ok(query.startsWith('BEGIN;'));
    assert.ok(query.endsWith('COMMIT;'));
    assert.ok(
      query.includes(
        'CREATE TABLE private.checkout_shipping_recovery_release_activation'
      )
    );
    assert.ok(
      query.includes("RAISE EXCEPTION 'shipping_recovery_not_activated'")
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function runApplier(history, { missingGate = false, cap } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'baci-recovery-preflight-'));
  try {
    const bin = join(temp, 'bin');
    const migrations = join(temp, 'migrations');
    const log = join(temp, 'queries.jsonl');
    mkdirSync(bin);
    mkdirSync(migrations);
    for (const name of migrationNames) {
      if (missingGate && name.includes('activation_gate')) continue;
      writeFileSync(
        join(migrations, name),
        readFileSync(join(root, 'supabase/migrations', name))
      );
    }
    writeFileSync(
      join(bin, 'curl'),
      `#!/usr/bin/env bash
set -euo pipefail
payload="$(cat)"
jq -c . <<<"$payload" >> "$FAKE_QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<<"$payload"; then
  printf '%s\\n' "$FAKE_INITIAL_RESPONSE"
else
  printf '[]\\n'
fi
`,
      { mode: 0o700 }
    );
    const result = spawnSync(
      'bash',
      ['.github/scripts/apply-pending-migrations.sh'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MIGRATIONS_DIR: migrations,
          SUPABASE_ACCESS_TOKEN: 'synthetic',
          SUPABASE_PROJECT_REF: 'synthetic',
          FAKE_INITIAL_RESPONSE: JSON.stringify(history),
          FAKE_QUERY_LOG: log,
          MIGRATION_MAX_VERSION: cap ?? '',
          MIGRATION_PHASE: 'all',
        },
      }
    );
    const requests = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { ...result, requests };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
const completeHistory = migrationNames.map((name) => ({
  version: name.split('_')[0],
  name: name.replace(/^\d+_|\.sql$/g, ''),
}));
for (const [label, history] of [
  ['old ten-migration prefix', completeHistory.slice(0, -1)],
  ['middle-only history', completeHistory.slice(4, 5)],
  ['history with a hole', completeHistory.filter((_, index) => index !== 3)],
]) {
  test(`production applier rejects ${label} before any migration mutation`, () => {
    const result = runApplier(history);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout + result.stderr,
      /partial recovery migration history/
    );
    assert.equal(result.requests.length, 1);
  });
}
test('production applier accepts all-pending recovery only as a single atomic request', () => {
  const result = runApplier([]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests.length, 2);
  assert.match(result.requests[1].query, /^BEGIN;/);
  assert.match(result.requests[1].query, /shipping_recovery_not_activated/);
  assert.match(result.requests[1].query, /COMMIT;$/);
});
test('production applier accepts a completely applied recovery history without writes', () => {
  const result = runApplier(completeHistory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests.length, 1);
});
test('production applier rejects a recorded recovery version with the wrong identity', () => {
  const result = runApplier(
    completeHistory.map((row, index) =>
      index === 0 ? { ...row, name: 'wrong' } : row
    )
  );
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout + result.stderr,
    /recovery migration identity mismatch/
  );
  assert.equal(result.requests.length, 1);
});
test('production applier rejects a null recorded recovery identity', () => {
  const result = runApplier(
    completeHistory.map((row, index) =>
      index === 0 ? { ...row, name: null } : row
    )
  );
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout + result.stderr,
    /recovery migration identity mismatch/
  );
  assert.equal(result.requests.length, 1);
});
test('production applier rejects a missing activation migration before granting RPCs', () => {
  const result = runApplier([], { missingGate: true });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout + result.stderr,
    /incomplete recovery migration files/
  );
  assert.equal(result.requests.length, 1);
});
test('a version cap cannot publish the ten RPC migrations without their gate', () => {
  const result = runApplier([], { cap: completeHistory.at(-2).version });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests.length, 1);
});
