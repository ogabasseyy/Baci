import assert from 'node:assert/strict';
import test from 'node:test';
import { withManagedDiagnostics } from './managed-diagnostics.mjs';

test('records a timed-out inventory check without exposing subprocess secrets', async () => {
  const failure = Object.assign(new Error('secret command and token'), {
    killed: true,
    signal: 'SIGKILL',
    stderr: 'private provider data',
  });
  const entries = [];
  await assert.rejects(
    withManagedDiagnostics(
      'inventory',
      () => {
        throw failure;
      },
      (entry) => entries.push(entry)
    ),
    (error) => error === failure
  );
  const event = JSON.parse(entries[0]);
  assert.equal(event.stage, 'inventory');
  assert.equal(event.reason, 'subprocess-timeout');
  assert.equal(Number.isFinite(event.elapsedMs), true);
  assert.doesNotMatch(entries.join(''), /secret|token|private|provider/);
});

test('records only allowlisted validation reasons and preserves rejection', async () => {
  for (const [message, reason] of [
    ['Managed inventory stale', 'inventory-stale'],
    ['Managed binding withdrawn', 'binding-withdrawn'],
    ['arbitrary secret', 'check-rejected'],
  ]) {
    const entries = [];
    await assert.rejects(
      withManagedDiagnostics(
        'gateway',
        () => {
          throw new Error(message);
        },
        (entry) => entries.push(entry)
      )
    );
    assert.equal(JSON.parse(entries[0]).reason, reason);
    assert.doesNotMatch(entries[0], /arbitrary secret/);
  }
});

test('does not change successful results or emit successful probe logs', async () => {
  const entries = [];
  assert.equal(
    await withManagedDiagnostics(
      'inventory',
      async () => 42,
      (entry) => entries.push(entry)
    ),
    42
  );
  assert.deepEqual(entries, []);
});
