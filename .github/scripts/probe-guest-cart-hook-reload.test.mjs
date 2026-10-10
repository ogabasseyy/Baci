import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACK,
  NOT_LOADED,
  baseEnv,
  runProbe,
  startStub,
} from './probe-guest-cart-hook-reload-harness.mjs';

describe('probe-guest-cart-hook-reload', () => {
  for (const applied of ['1', 1]) {
    it(`skips fast when isolate is recorded (applied=${JSON.stringify(applied)})`, async () => {
      const stub = await startStub({
        mgmt: () => [200, [{ applied }]],
        canary: () => [200, ACK],
      });
      try {
        const result = await runProbe(baseEnv(stub.port));
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /already recorded; skipping/);
        assert.equal(stub.hits.canary, 0);
      } finally {
        stub.server.close();
      }
    });
  }

  it('acknowledges after a unanimous window of canary acks', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: (_body, hit) => {
        if (hit < 3) return [404, NOT_LOADED];
        // A 42501 with any other message is not the ack.
        if (hit === 3) return [403, { code: '42501', message: 'boom' }];
        return [403, ACK];
      },
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, {
          GUEST_CART_HOOK_PROBE_DEADLINE_S: '30',
          GUEST_CART_HOOK_PROBE_UNANIMITY_S: '2',
        })
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /acknowledged fleet-wide: 2s unanimous/);
      assert.ok(stub.hits.canary >= 4);
      assert.equal(stub.canaryHeaders().apikey, 'test-anon-key');
      // Both listener payloads: a replica that missed the
      // restore-time schema reload can never be healed by
      // config-only re-notifies.
      assert.deepEqual(stub.notifies, [
        "NOTIFY pgrst, 'reload config'",
        "NOTIFY pgrst, 'reload schema'",
      ]);
    } finally {
      stub.server.close();
    }
  });

  it('resets the unanimity clock on a stale answer', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: (_body, hit) => {
        if (hit === 4) return [404, NOT_LOADED];
        return [403, ACK];
      },
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, {
          GUEST_CART_HOOK_PROBE_DEADLINE_S: '30',
          GUEST_CART_HOOK_PROBE_UNANIMITY_S: '5',
        })
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /unanimity clock reset/);
      assert.match(result.stdout, /acknowledged fleet-wide/);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed when acks never reach unanimity', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: (_body, hit) => (hit % 2 === 0 ? [404, NOT_LOADED] : [403, ACK]),
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, {
          GUEST_CART_HOOK_PROBE_DEADLINE_S: '3',
          GUEST_CART_HOOK_PROBE_UNANIMITY_S: '30',
        })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never reached 30s unanimous/);
      assert.match(result.stderr, /isolate grant is NOT applied/);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed when the hook never loads', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: () => [404, NOT_LOADED],
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, { GUEST_CART_HOOK_PROBE_DEADLINE_S: '2' })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never served the GUEST CART hook reload canary/);
      assert.match(result.stderr, /isolate grant is NOT applied/);
      assert.ok(stub.hits.canary >= 1);
    } finally {
      stub.server.close();
    }
  });

  it('treats the unshadowed canary value as not-loaded', async () => {
    // Schema fresh but hook stale: the real canary RPC executes and
    // answers its bare constant (200 JSON string) instead of the
    // hook's 42501 denial. That middle state must never ack.
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: () => [200, 'guest-cart-hook-canary-alive'],
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, { GUEST_CART_HOOK_PROBE_DEADLINE_S: '2' })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never served the GUEST CART hook reload canary/);
      assert.match(result.stderr, /isolate grant is NOT applied/);
      assert.ok(stub.hits.canary >= 1);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed when PostgREST is unreachable', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: () => [200, ACK],
    });
    try {
      const closedPort = stub.port + 10000 > 65535 ? 9 : stub.port + 10000;
      const result = await runProbe(
        baseEnv(stub.port, {
          NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${closedPort}`,
          GUEST_CART_HOOK_PROBE_DEADLINE_S: '2',
        })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never served the GUEST CART hook reload canary/);
      assert.equal(stub.hits.canary, 0);
    } finally {
      stub.server.close();
    }
  });
});
