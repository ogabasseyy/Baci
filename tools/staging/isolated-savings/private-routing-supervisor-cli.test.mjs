import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('./private-routing-supervisor-cli.mjs', import.meta.url)
);

test('CLI rejects missing mode without executing tools or exposing payloads', () => {
  const result = spawnSync(process.execPath, [script], {
    env: {},
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'Private routing withdrawn or refused; fresh healthy evidence and explicit restart required.\n'
  );
});

test('process adapter retains no shell or secret environment and never signals PID files or shared services', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /stdio: 'ignore'/);
  assert.match(source, /O_NOFOLLOW/);
  assert.match(source, /timeout: 1500/);
  assert.match(source, /owned.kill\('SIGKILL'\)/);
  assert.doesNotMatch(
    source,
    /shell: true|process\.kill|nginx.*-s|systemctl|sudo|\.\.\.process\.env/
  );
});
