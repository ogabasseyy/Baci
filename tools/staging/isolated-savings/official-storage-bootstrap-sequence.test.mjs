import assert from 'node:assert/strict';
import test from 'node:test';
import { storageBootstrapSequence } from './official-storage-bootstrap-sequence.mjs';

test('locks down before reporting success or verifying schema', async () => {
  const calls = [];
  const actions = Object.fromEntries(['prepare', 'migrate', 'lockdown', 'stop', 'verify'].map((name) => [name, async () => { calls.push(name); }]));
  await storageBootstrapSequence(actions);
  assert.deepEqual(calls, ['prepare', 'migrate', 'lockdown', 'stop', 'verify']);
});

test('attempts lockdown and stop on preparation or migration failure, never verifies success', async () => {
  for (const failed of ['prepare', 'migrate', 'lockdown', 'stop']) {
    const calls = [];
    const actions = Object.fromEntries(['prepare', 'migrate', 'lockdown', 'stop', 'verify'].map((name) => [name, async () => {
      calls.push(name);
      if (name === failed) throw new Error('sensitive provider or SQL details');
    }]));
    await assert.rejects(storageBootstrapSequence(actions), /^Error: Bootstrap failed; verify initializer lockdown through the admin channel$/);
    assert.ok(calls.includes('lockdown'));
    assert.ok(calls.includes('stop'));
    assert.equal(calls.includes('verify'), false);
  }
});
