import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('./background-step.sh', import.meta.url).pathname;

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'bg-step-'));
  try {
    return fn((...args) =>
      spawnSync('bash', [script, ...args], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, RUNNER_TEMP: dir },
      })
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('wait prints the output and succeeds when the background command succeeds', () => {
  withTemp((run) => {
    assert.equal(run('start', 'ok-step', 'bash', '-c', 'echo pulled image').status, 0);
    const result = run('wait', 'ok-step', '30');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pulled image/);
  });
});

test('wait fails with the command exit status when the background command fails', () => {
  withTemp((run) => {
    run('start', 'bad-step', 'bash', '-c', 'echo registry down >&2; exit 7');
    const result = run('wait', 'bad-step', '30');
    assert.equal(result.status, 7);
    assert.match(result.stdout, /registry down/);
  });
});

test('wait fails when the step was never started, so a renamed start cannot pass silently', () => {
  withTemp((run) => {
    const result = run('wait', 'never-started', '1');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /never started/);
  });
});

test('wait fails at the timeout while the command is still running', () => {
  withTemp((run) => {
    run('start', 'slow-step', 'sleep', '3');
    const result = run('wait', 'slow-step', '1');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /still running after 1s/);
    // Let the sleep finish before the temp folder is removed, so no process outlives the test.
    assert.equal(run('wait', 'slow-step', '30').status, 0);
  });
});

test('rejects names that could escape the background-steps folder', () => {
  withTemp((run) => {
    assert.equal(run('start', '../x', 'true').status, 2);
    assert.equal(run('wait', 'a/b').status, 2);
  });
});
