import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunner } from './release-subprocess.mjs';

// Split from release-production.test.mjs: bounded-child-execution
// cases live here so both suites stay under the 300-line limit.
const { command } = createRunner(process.cwd());

test('a timed-out child holds the lock and names the signal', () => {
  let error;
  try {
    command('sleep', ['30'], true, { timeoutMs: 50 });
  } catch (thrown) {
    error = thrown;
  }
  assert.match(error.message, /ETIMEDOUT/);
  assert.match(error.message, /SIGKILL/);
  assert.equal(error.indeterminateDispatch, true);
});

test('a SIGTERM-ignoring child still dies on the timeout', () => {
  const started = Date.now();
  let error;
  try {
    command(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 30000)'], true, { timeoutMs: 200 });
  } catch (thrown) {
    error = thrown;
  }
  assert.match(error.message, /ETIMEDOUT/);
  assert.match(error.message, /SIGKILL/);
  assert.equal(error.indeterminateDispatch, true);
  assert.ok(Date.now() - started < 10000, 'timed-out child must die promptly');
});

test('a signal-killed child names the signal without the timeout tag', () => {
  let error;
  try {
    command('sh', ['-c', 'kill -TERM $$'], true);
  } catch (thrown) {
    error = thrown;
  }
  assert.match(error.message, /signal SIGTERM/);
  assert.equal(error.indeterminateDispatch, undefined);
});
