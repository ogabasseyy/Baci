import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./official-storage-bootstrap-run.mjs', import.meta.url));

test('runner cannot execute without explicit reviewed mode and evidence', () => {
  for (const args of [[], ['--execute-reviewed-private']]) {
    const result = spawnSync(process.execPath, [script, ...args], { input: '{}', encoding: 'utf8', env: {} });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});

test('runner uses admin only inside verified DB and detached status-only migration execution', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /'supabase_admin'/);
  assert.match(source, /storageBootstrapSequence/);
  assert.match(source, /'--pull', 'never'/);
  assert.match(source, /admin\('lockdown'\)/);
  assert.doesNotMatch(source, /'logs'|'sudo'|'ssh'|\.Config\.Env/);
});
