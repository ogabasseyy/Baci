import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { routingFixture } from './private-routing.test-support.mjs';

const script = fileURLToPath(
  new URL('./private-routing-cli.mjs', import.meta.url)
);

test('CLI renders synthetic current evidence without network, Docker or environment configuration', () => {
  const { receipt, inventory } = routingFixture();
  receipt.verifiedAt = inventory.observedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [script, '--unprivileged-test'], {
    input: JSON.stringify({ receipt, inventory }),
    encoding: 'utf8',
    env: { DATABASE_URL: 'must-not-be-read', PATH: '/nonexistent' },
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.receipt.deploymentStatus, 'not-deployed');
  assert.doesNotMatch(result.stdout, /must-not-be-read/);
});

test('CLI rejects malformed, stale and oversized input without echoing payloads', () => {
  for (const input of [
    'sensitive-invalid-json',
    'x'.repeat(262145),
    JSON.stringify(routingFixture()),
    '{}',
  ]) {
    const result = spawnSync(
      process.execPath,
      [script, '--unprivileged-test'],
      { input, encoding: 'utf8', env: {} }
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'Private routing rejected; verify sanitized inventory and fresh ownership receipt.\n'
    );
  }
});

test('CLI rejects deploy and public modes', () => {
  for (const flag of ['--deploy', '--public-tls']) {
    const result = spawnSync(process.execPath, [script, flag], {
      encoding: 'utf8',
      env: {},
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});
