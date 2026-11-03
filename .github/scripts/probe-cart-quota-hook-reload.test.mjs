import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACK, NOT_LOADED, baseEnv, runProbe, startStub } from './probe-cart-quota-hook-reload-harness.mjs';

test('waits for a unanimous quota hook acknowledgement before the grant', async () => {
  const stub = await startStub({
    mgmt: () => [200, [{ applied: '0' }]],
    canary: (_body, hit) => hit < 2 ? [404, NOT_LOADED] : [403, ACK],
  });
  try {
    const result = await runProbe(baseEnv(stub.port, {
      CART_QUOTA_HOOK_PROBE_DEADLINE_S: '10',
      CART_QUOTA_HOOK_PROBE_UNANIMITY_S: '1',
    }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /observed routing/);
    assert.match(result.stdout, /sticky routing/);
    assert.ok(stub.hits.canary >= 2);
    assert.deepEqual(stub.notifies, [
      "NOTIFY pgrst, 'reload config'",
      "NOTIFY pgrst, 'reload schema'",
    ]);
  } finally {
    stub.server.close();
  }
});

test('fails closed when the new hook never loads', async () => {
  const stub = await startStub({
    mgmt: () => [200, [{ applied: '0' }]],
    canary: () => [404, NOT_LOADED],
  });
  try {
    const result = await runProbe(baseEnv(stub.port, {
      CART_QUOTA_HOOK_PROBE_DEADLINE_S: '2',
    }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /grant is NOT applied/);
  } finally {
    stub.server.close();
  }
});

test('does not re-run the canary after the grant migration is recorded', async () => {
  const stub = await startStub({
    mgmt: () => [200, [{ applied: '1' }]],
    canary: () => [403, ACK],
  });
  try {
    const result = await runProbe(baseEnv(stub.port));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(stub.hits.canary, 0);
  } finally {
    stub.server.close();
  }
});
