import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./resolve-isolated-gigl-latch-identity.sh', import.meta.url));

function fixture(t, envText) {
  const root = mkdtempSync(join(tmpdir(), 'baci-isolated-gigl-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'runtime'));
  writeFileSync(join(root, 'runtime/worker.env'), envText);
  writeFileSync(join(root, '.env'), envText);
  return root;
}

test('fingerprints only the installed isolated GIGL credentials and reports scope', (t) => {
  const root = fixture(t, [
    'GIGL_ENABLED=TRUE',
    'NEXT_PUBLIC_SUPABASE_URL=https://database.example',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-fixture',
    'GIGL_BASE_URL=https://provider.example',
    'GIGL_EMAIL=worker@example.test',
    'GIGL_PASSWORD=provider-password-fixture',
    'GIGL_TRACKING_WORKER_TOKEN=tracking-token-fixture',
    'SUPABASE_SERVICE_ROLE_KEY=service-role-fixture',
  ].join('\n') + '\n');
  const result = spawnSync('bash', [script, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^enabled [0-9a-f]{64}\n$/);
  assert.doesNotMatch(result.stdout, /provider-password-fixture|tracking-token-fixture|service-role-fixture/);
  assert.equal(result.stderr, '');

  const changedRoot = fixture(t, [
    'GIGL_ENABLED=true',
    'NEXT_PUBLIC_SUPABASE_URL=https://database.example',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-fixture',
    'GIGL_BASE_URL=https://provider.example',
    'GIGL_EMAIL=worker@example.test',
    'GIGL_PASSWORD=rotated-password-fixture',
    'GIGL_TRACKING_WORKER_TOKEN=tracking-token-fixture',
    'SUPABASE_SERVICE_ROLE_KEY=service-role-fixture',
  ].join('\n') + '\n');
  const changed = spawnSync('bash', [script, changedRoot], { encoding: 'utf8' });
  assert.equal(changed.status, 0, changed.stderr);
  assert.notEqual(changed.stdout, result.stdout);
});

test('disabled mode has the empty-token fingerprint and rejects path traversal', (t) => {
  const root = fixture(t, 'GIGL_ENABLED= false\nGIGL_TRACKING_WORKER_TOKEN=\n');
  const result = spawnSync('bash', [script, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `disabled ${createHash('sha256').update('').digest('hex')}\n`);
  const invalid = spawnSync('bash', [script, `${root}/../escape`], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
});
