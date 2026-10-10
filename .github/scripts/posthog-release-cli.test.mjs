import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const wrapper = new URL('./posthog-release-cli.sh', import.meta.url);
function run({ mode, args = ['hermes', 'upload', '--skip-on-conflict'] }) {
  const root = mkdtempSync(join(tmpdir(), 'posthog-cli-test-'));
  try {
    const cli = join(root, 'cli');
    const calls = join(root, 'calls');
    writeFileSync(cli, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
count=$(wc -l < "$CALLS")
if [[ "$MODE" == transient && "$count" == 3 ]]; then exit 0; fi
if [[ "$MODE" == auth ]]; then echo 'HTTP 401 unauthorized'; exit 7; fi
echo 'failed to get release from hash: Request error: error sending request for url (https://synthetic.example/api/projects/1/error_tracking/releases/hash/test)'
exit 8
`);
    writeFileSync(join(root, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(cli, 0o755);
    chmodSync(join(root, 'sleep'), 0o755);
    const result = spawnSync('bash', [wrapper.pathname, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, POSTHOG_RELEASE_CLI: cli, MODE: mode, CALLS: calls },
    });
    return { ...result, calls: readFileSync(calls, 'utf8').trim().split('\n') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('recovers transient PostHog Hermes upload network failures without rerunning bundling', () => {
  const result = run({ mode: 'transient' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, Array(3).fill('hermes upload --skip-on-conflict'));
});
test('persistent upload transport failure still blocks release after bounded retries', () => {
  const result = run({ mode: 'network' });
  assert.equal(result.status, 8);
  assert.equal(result.calls.length, 3);
});
test('authentication failures fail immediately', () => {
  const result = run({ mode: 'auth' });
  assert.equal(result.status, 7);
  assert.equal(result.calls.length, 1);
});
test('Hermes clone failures are never swallowed or retried', () => {
  const result = run({ mode: 'network', args: ['hermes', 'clone'] });
  assert.equal(result.status, 8);
  assert.equal(result.calls.length, 1);
});
