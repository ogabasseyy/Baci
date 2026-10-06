import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateManagedGateway,
  startManagedGateway,
} from './managed-gateway.mjs';
import { routingFixture } from './private-routing.test-support.mjs';

function harness() {
  const input = routingFixture();
  const { host, containers, networks, restRoutes } = input.receipt;
  const binding = {
    version: 1,
    identity: { host, containers, networks, restRoutes },
    reviewedAt: input.receipt.verifiedAt,
    leaseNotBefore: input.receipt.verifiedAt,
    leaseExpiresAt: new Date(input.now + 3600000).toISOString(),
  };
  const controller = new AbortController();
  const calls = [];
  let elapsed = 0;
  const actions = {
    now: () => input.now + elapsed,
    monotonicNow: () => elapsed,
    binding: () => structuredClone(binding),
    inventory: () => ({
      ...structuredClone(input.inventory),
      observedAt: new Date(input.now + elapsed).toISOString(),
    }),
    prepare: () => {
      calls.push('prepare');
    },
    start: () => {
      calls.push('start');
      return { alive: () => true, exited: new Promise(() => undefined) };
    },
    pause: () => controller.abort(),
    stop: () => {
      calls.push('stop');
    },
    cleanup: () => {
      calls.push('cleanup');
    },
  };
  return {
    input,
    binding,
    controller,
    actions,
    calls,
    advance: (amount) => {
      elapsed += amount;
    },
  };
}

test('managed config listens only on fixed Unix socket and emits no reusable TCP listener', () => {
  const state = harness();
  const { config } = generateManagedGateway(
    state.binding,
    state.input.inventory,
    state.input.now
  );
  assert.match(
    config,
    /listen unix:\/run\/baci-savings-gateway\/ingress.sock;/
  );
  assert.doesNotMatch(config, /listen (?:127|0\.0|\[|[0-9])/);
  assert.match(config, /master_process off;/);
});

test('runs beyond startup evidence expiry without modifying or renewing original receipt', async () => {
  const state = harness();
  const original = structuredClone(state.input);
  let polls = 0;
  state.actions.pause = () => {
    if (polls++ === 0) state.advance(600000);
    else state.controller.abort();
  };
  await startManagedGateway(
    state.binding,
    state.input,
    state.actions,
    state.controller.signal
  );
  assert.deepEqual(state.input, original);
  assert.deepEqual(state.calls, ['prepare', 'start', 'stop', 'cleanup']);
});

test('each start rejects stale evidence even within a valid operator lease', async () => {
  const state = harness();
  state.advance(300001);
  await assert.rejects(
    startManagedGateway(
      state.binding,
      state.input,
      state.actions,
      state.controller.signal
    )
  );
  assert.equal(state.calls.includes('start'), false);
});

test('rejects mismatched independently reviewed binding and out-of-bounds leases before startup', async () => {
  for (const change of [
    (state) => {
      state.binding.identity.containers.auth.id = 'a'.repeat(64);
    },
    (state) => {
      state.binding.leaseExpiresAt = new Date(
        state.input.now + 86400001
      ).toISOString();
    },
    (state) => {
      state.binding.leaseExpiresAt = new Date(state.input.now).toISOString();
    },
    (state) => {
      state.binding.leaseNotBefore = new Date(
        state.input.now + 1
      ).toISOString();
    },
    (state) => {
      state.binding.unreviewed = true;
    },
  ]) {
    const state = harness();
    state.binding = structuredClone(state.binding);
    change(state);
    await assert.rejects(
      startManagedGateway(
        state.binding,
        state.input,
        state.actions,
        state.controller.signal
      )
    );
    assert.equal(state.calls.includes('start'), false);
  }
});

test('withdraws on identity change, stale poll, binding renewal, inspection failure or lease expiry without restart', async () => {
  for (const change of [
    (state) => {
      state.input.inventory.containers[0].State.Running = false;
    },
    (state) => {
      state.input.inventory.containers[0].Id = 'a'.repeat(64);
    },
    (state) => {
      state.actions.inventory = () => state.input.inventory;
      state.advance(6000);
    },
    (state) => {
      state.binding.leaseExpiresAt = new Date(
        state.input.now + 7200000
      ).toISOString();
    },
    (state) => {
      state.actions.inventory = () => {
        throw new Error('failed');
      };
    },
    (state) => state.advance(3600000),
    (state) => {
      state.actions.monotonicNow = () => 3600000;
    },
    (state) => {
      state.actions.now = () => state.input.now - 1;
    },
  ]) {
    const state = harness();
    state.actions.pause = () => change(state);
    await assert.rejects(
      startManagedGateway(
        state.binding,
        state.input,
        state.actions,
        state.controller.signal
      )
    );
    assert.deepEqual(state.calls, ['prepare', 'start', 'stop', 'cleanup']);
  }
});

test('inventory drift during parsing prevents child startup', async () => {
  const state = harness();
  state.actions.prepare = () => {
    state.input.inventory.containers[1].State.Health.Status = 'unhealthy';
  };
  await assert.rejects(
    startManagedGateway(
      state.binding,
      state.input,
      state.actions,
      state.controller.signal
    )
  );
  assert.equal(state.calls.includes('start'), false);
});
