import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
