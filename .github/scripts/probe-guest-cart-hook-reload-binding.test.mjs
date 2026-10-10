import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ACK,
  PROBE,
  baseEnv,
  runProbe,
  startStub,
} from './probe-guest-cart-hook-reload-harness.mjs';

describe('probe-guest-cart-hook-reload-binding', () => {
  it('fails closed when the isolate check errors', async () => {
    const stub = await startStub({
      mgmt: () => [500, { message: 'mgmt down' }],
      canary: () => [200, ACK],
    });
    try {
      const result = await runProbe(baseEnv(stub.port));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /could not check the isolate migration/);
      assert.equal(stub.hits.canary, 0);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed on a malformed isolate response', async () => {
    const stub = await startStub({
      mgmt: () => [200, { applied: '0' }],
      canary: () => [200, ACK],
    });
    try {
      const result = await runProbe(baseEnv(stub.port));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unreadable isolate-migration response/);
    } finally {
      stub.server.close();
    }
  });

  it('pins the fleet-convergence defaults against silent weakening', () => {
    const script = readFileSync(PROBE, 'utf8');
    assert.match(script, /GUEST_CART_HOOK_PROBE_DEADLINE_S:-900}/);
    assert.match(script, /GUEST_CART_HOOK_PROBE_INTERVAL_S:-2}/);
    assert.match(script, /GUEST_CART_HOOK_PROBE_UNANIMITY_S:-300}/);
    assert.match(script, /GUEST_CART_HOOK_PROBE_RENOTIFY_S:-60}/);
  });

  it('refuses a supabase.co URL for a different project', async () => {
    // Fails before any network: a stale URL must never authorize the
    // grant with another project's acks.
    const result = await runProbe(
      baseEnv(1, {
        SUPABASE_PROJECT_REF: 'test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co',
      })
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match project ref/);
  });

  it('refuses a non-supabase URL without the escape hatch', async () => {
    const result = await runProbe(
      baseEnv(1, {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        GUEST_CART_HOOK_PROBE_ALLOW_UNBOUND_URL: '',
      })
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a supabase\.co project URL/);
  });

  it('accepts a bound supabase.co URL when isolate is recorded', async () => {
    // The binding passes without touching the data URL: the recorded
    // isolate short-circuits through the (stubbed) Management API.
    const stub = await startStub({
      mgmt: () => [200, [{ applied: 1 }]],
      canary: () => [200, ACK],
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, {
          SUPABASE_PROJECT_REF: 'test',
          NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
          GUEST_CART_HOOK_PROBE_ALLOW_UNBOUND_URL: '',
        })
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /already recorded; skipping/);
      assert.equal(stub.hits.canary, 0);
    } finally {
      stub.server.close();
    }
  });
});
