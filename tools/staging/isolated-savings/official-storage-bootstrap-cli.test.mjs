import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./official-storage-bootstrap-cli.mjs', import.meta.url));

test('CLI refuses missing evidence and deploy commands without echoing input', () => {
  for (const flag of ['--template', '--deploy']) {
    const result = spawnSync(process.execPath, [script, flag], { input: '{"password":"must-not-echo"}', env: {}, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /must-not-echo/);
  }
});

test('CLI emits a credential-free template from reviewed synthetic evidence', () => {
  const networkId = 'b'.repeat(64);
  const evidence = {
    observedAt: new Date().toISOString(), reviewed: true,
    db: { id: 'a'.repeat(64), image: 'supabase/postgres:17.6.1.136', project: 'baci-isolated-savings', service: 'db', healthy: true, networkId },
    network: { id: networkId, name: 'baci-isolated-savings_database', project: 'baci-isolated-savings', internal: true, bridge: 'baci-stg-db' },
  };
  const result = spawnSync(process.execPath, [script, '--template'], { input: JSON.stringify(evidence), env: { PATH: '/nonexistent' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).services['storage-bootstrap'].restart, 'no');
});
