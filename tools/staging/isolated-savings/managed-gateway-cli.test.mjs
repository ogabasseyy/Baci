import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('managed CLI rejects unapproved modes without secret output or helper invocation', () => {
  const script = fileURLToPath(
    new URL('./managed-gateway-cli.mjs', import.meta.url)
  );
  for (const args of [[], ['--foreground'], ['--managed', '/tmp/untrusted']]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { SECRET: 'never-echo', PATH: '/nonexistent' },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'Managed gateway withdrawn; operator review and fresh startup evidence required.\n'
    );
  }
});

test('managed launcher retains parent-death helper and uses fixed inspection capability only', () => {
  const source = readFileSync(
    new URL('./managed-gateway-cli.mjs', import.meta.url),
    'utf8'
  );
  assert.match(source, /private-routing-supervisor-child\.py/);
  assert.match(source, /managed-inventory-helper\.mjs/);
  assert.doesNotMatch(
    source,
    /collectSupervisorInventory|exec\(|shell:|nginx -s|127\.0\.0\.1:15440/
  );
  assert.match(source, /Existing socket refused/);
  assert.match(source, /current.fingerprint !== bindingFile.fingerprint/);
});
