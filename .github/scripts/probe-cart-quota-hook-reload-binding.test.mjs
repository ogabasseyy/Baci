import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACK,
  NOT_LOADED,
  baseEnv,
  runProbe,
  startStub,
} from './probe-cart-quota-hook-reload-harness.mjs';

test('refuses a Supabase URL belonging to another project', async () => {
  const result = await runProbe(
    baseEnv(1, {
      SUPABASE_PROJECT_REF: 'test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co',
    })
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match project ref/);
});

test('refuses a non-Supabase URL without the explicit local escape hatch', async () => {
  const result = await runProbe(
    baseEnv(1, { CART_QUOTA_HOOK_PROBE_ALLOW_UNBOUND_URL: '' })
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a supabase\.co project URL/);
});

test('accepts a URL bound to the migrated project', async () => {
  const stub = await startStub({
    mgmt: () => [200, [{ applied: '1' }]],
    canary: () => [403, ACK],
  });
  try {
    const result = await runProbe(
      baseEnv(stub.port, {
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        CART_QUOTA_HOOK_PROBE_ALLOW_UNBOUND_URL: '',
      })
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already recorded; skipping/);
    assert.equal(stub.hits.canary, 0);
  } finally {
    stub.server.close();
  }
});

test('starts a fresh unanimity window after a non-ack', async () => {
  const stub = await startStub({
    mgmt: () => [200, [{ applied: '0' }]],
    canary: (_body, hit) => hit === 2 ? [404, NOT_LOADED] : [403, ACK],
  });
  try {
    const result = await runProbe(
      baseEnv(stub.port, {
        CART_QUOTA_HOOK_PROBE_INTERVAL_S: '1',
        CART_QUOTA_HOOK_PROBE_UNANIMITY_S: '2',
        CART_QUOTA_HOOK_PROBE_DEADLINE_S: '15',
      })
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /unanimity clock reset/);
    assert.ok(stub.hits.canary >= 4, 'a single post-reset ack must not succeed');
  } finally {
    stub.server.close();
  }
});
